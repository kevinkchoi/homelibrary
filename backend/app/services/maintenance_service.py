"""사용되지 않는 표지 이미지 정리.

`image_service`는 저장소만 다루는 계층이라 DB를 모른다. 이 모듈이 "DB가 실제로 참조하는 표지"를
조회해 그쪽에 넘겨주는 다리 역할을 한다.

정리 대상은 두 종류다:
  - `tmp/` 임시 이미지 — 표지 후보/스캔 사진 중 채택되지 않은 것 (기본 6시간 후)
  - 영구 저장소의 고아 파일 — 어느 책도 참조하지 않는 표지 (기본 24시간 후)

두 번째는 **안전망**이다. 정상 경로에서는 이제 고아가 생기지 않아야 하지만(스캔 이미지는 `tmp/`로
가고, 나머지는 저장 즉시 책에 연결된다), 저장 도중 실패 같은 예외 상황까지 막지는 못하므로
주기적으로 훑어서 치운다.
"""
import logging

from sqlalchemy.orm import Session

from app.models.book import Book
from app.services import image_service

logger = logging.getLogger(__name__)


def referenced_cover_paths(db: Session) -> set[str]:
    """DB가 실제로 참조하고 있는 표지 경로 집합."""
    rows = (
        db.query(Book.cover_image_path)
        .filter(Book.cover_image_path.isnot(None))
        .all()
    )
    return {row[0] for row in rows if row[0]}


def unused_image_report(db: Session, min_age_seconds: int | None = None) -> dict:
    """지우지 않고 **현황만** 돌려준다(정리 전에 무엇이 지워질지 확인하는 용도)."""
    referenced = referenced_cover_paths(db)
    kwargs = {} if min_age_seconds is None else {"min_age_seconds": min_age_seconds}
    orphans = image_service.find_orphan_images(referenced, **kwargs)
    return {
        "orphan_count": len(orphans),
        "orphan_bytes": image_service.orphan_images_size(orphans),
        "referenced_count": len(referenced),
        "sample": sorted(orphans)[:10],
    }


def sweep_unused_images(db: Session, min_age_seconds: int | None = None) -> dict:
    """임시 이미지와 고아 이미지를 실제로 정리하고 결과를 반환."""
    temp_removed = image_service.purge_old_temp_images()

    referenced = referenced_cover_paths(db)
    kwargs = {} if min_age_seconds is None else {"min_age_seconds": min_age_seconds}
    orphan_removed = image_service.delete_orphan_images(referenced, **kwargs)

    return {"temp_removed": temp_removed, "orphan_removed": orphan_removed}
