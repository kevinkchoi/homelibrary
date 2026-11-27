"""[도움말 → 의견 보내기] — 사용자가 운영자에게 코멘트·기능 제안을 보낸다.

보낸 사람은 [내가 보낸 의견]에서 운영자의 답과 처리 상태를 본다. 운영자 쪽은 routers/admin.py.
의견 내용은 **운영자에게 전달되는 것**이 목적이므로 운영자가 읽는다(화면에도 그렇게 안내한다).
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models.feedback import CATEGORIES, Feedback
from app.models.user import User
from app.schemas.admin import FeedbackIn, FeedbackOut
from app.services import notify

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

CATEGORY_LABEL = {"bug": "버그", "idea": "기능 제안", "praise": "칭찬", "other": "기타"}
# 두 서버(가족용 family · 공개용 personal)가 **같은 텔레그램 방**으로 보내므로 어디서 온 의견인지 붙인다(2026-11-27).
# 새 환경변수를 두지 않고 모드로 가른다 — 한 모드에 서버가 하나씩이라 충분하다.
SITE_LABEL = {"family": "가족 서버", "personal": "공개 서비스"}
DAILY_LIMIT = 20  # 한 사람이 하루에 보낼 수 있는 수 — 실수로 여러 번 누르거나 장난으로 쏟아지는 것을 막는다


@router.post("", response_model=FeedbackOut, status_code=201)
def send_feedback(
    payload: FeedbackIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="종류를 다시 골라 주세요.")
    since = datetime.now(timezone.utc) - timedelta(days=1)
    recent = db.query(Feedback).filter(Feedback.user_id == current_user.id, Feedback.created_at >= since).count()
    if recent >= DAILY_LIMIT:
        raise HTTPException(status_code=429, detail="오늘은 의견을 충분히 보내셨습니다. 내일 다시 보내 주세요.")
    item = Feedback(
        user_id=current_user.id,
        username=current_user.username,
        category=payload.category,
        body=payload.body.strip(),
        status="new",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    # 응답을 기다리게 하지 않도록 뒤에서 보낸다
    background.add_task(
        notify.send_telegram,
        alert_text(item),
    )
    return item


def alert_text(item: Feedback) -> str:
    site = SITE_LABEL.get(settings.library_mode.strip().lower(), settings.library_mode)
    return (
        f"📚 Home Library({site}) 새 의견 [{CATEGORY_LABEL.get(item.category, item.category)}] — {item.username}\n\n"
        f"{item.body[:1500]}"
    )


@router.get("/mine", response_model=list[FeedbackOut])
def my_feedback(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return (
        db.query(Feedback)
        .filter(Feedback.user_id == current_user.id)
        .order_by(Feedback.created_at.desc())
        .limit(100)
        .all()
    )
