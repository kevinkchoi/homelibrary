import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import SessionLocal
from app.routers import admin, auth, books, feedback, import_export, library, me, recommend, scan, users
from app.services import maintenance_service

# 앱 로그를 실제로 보이게 한다. 이게 없으면 루트 로거 기본 레벨(WARNING) 때문에 `logger.info(...)`가
# 전부 걸러져, **파일을 지우는 자동 정리가 아무 흔적도 남기지 않는다.** 배포 후 문제를 볼 때
# `docker compose logs homelibrary-api`가 1차 수단이라 여기서 INFO를 켜 둔다.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
# httpx는 외부 API를 부를 때마다 요청 한 줄씩 남겨서(표지 조회가 잦다) 로그가 묻힌다 — 경고만 남긴다.
logging.getLogger("httpx").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱이 뜰 때 사용되지 않는 표지 이미지를 한 번 정리한다.

    별도 스케줄러(cron/celery)를 두지 않는 이유: 개인용 홈서버라 배포·재시작이 곧 정기 점검
    시점이고, 평소에는 스캔 요청마다 `purge_old_temp_images()`가 임시 파일을 치우기 때문이다.

    ⚠️ 여기서 예외가 나도 앱은 반드시 떠야 한다. 이미지 정리는 부가 작업인데 이것 때문에
    서비스 전체가 죽으면 본말전도다(마이그레이션 0004에서도 같은 이유로 실패를 허용했다).
    """
    try:
        with SessionLocal() as db:
            result = maintenance_service.sweep_unused_images(db)
        if result["temp_removed"] or result["orphan_removed"]:
            logger.info(
                "시작 시 이미지 정리: 임시 %d개, 미사용 %d개 삭제",
                result["temp_removed"],
                result["orphan_removed"],
            )
    except Exception:
        logger.exception("시작 시 이미지 정리 실패 — 앱 기동은 계속합니다")

    yield


app = FastAPI(title="Home Library API", lifespan=lifespan)

app.include_router(auth.router)
app.include_router(books.router)
app.include_router(import_export.router)
app.include_router(scan.router)
app.include_router(users.router)
app.include_router(recommend.router)
app.include_router(me.router)
app.include_router(library.router)
app.include_router(feedback.router)
app.include_router(admin.router)

app.mount("/api/images", StaticFiles(directory=settings.images_dir, check_dir=False), name="images")


@app.get("/api/health")
def health():
    return {"status": "ok"}
