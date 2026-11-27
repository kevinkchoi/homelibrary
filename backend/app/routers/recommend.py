import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.schemas.recommendation import RecommendationList, RecommendationOut
from app.config import settings
from app.services import recommend_service, user_keys

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])


def _require_ai(user: User) -> None:
    """personal 모드에서는 **자기 Claude 키가 있어야** 추천을 쓴다(사용자 결정, 2026-11-27).
    키 없이 돌리면 알라딘 호출이 전부 운영자 키 한도에 쌓이고, 이유 없는 신간 목록이 될 뿐이다."""
    if settings.personal_mode and not user_keys.ai_key_for(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="새책 추천은 [내 설정]에 Claude API 키를 넣어야 쓸 수 있습니다.",
        )


def _payload(db: Session, user: User) -> RecommendationList:
    items = recommend_service.list_current(db, user)
    return RecommendationList(
        items=[RecommendationOut.model_validate(r) for r in items],
        generated_at=recommend_service.generated_at(db, user),
        # 이유가 하나라도 붙어 있으면 Claude 선별이 돈 것이다.
        curated=any(r.reason for r in items),
    )


@router.get("", response_model=RecommendationList)
def get_recommendations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """저장된 추천 목록을 준다. 하루가 지났거나 비어 있으면 그 자리에서 새로 만든다.

    새로 만드는 데 몇 초 걸리지만, 그건 **하루에 한 번**뿐이다. 나머지 열람은 DB만 읽는다.
    """
    _require_ai(current_user)
    if recommend_service.is_stale(db, current_user):
        try:
            recommend_service.refresh(db, current_user)
        except Exception:
            # 갱신에 실패해도 **옛 목록이라도 보여 준다.** 빈 화면보다 낫다.
            logger.exception("새책 추천 자동 갱신 실패 — 이전 목록을 그대로 보여준다")
            db.rollback()
    return _payload(db, current_user)


@router.post("/refresh", response_model=RecommendationList)
def refresh_recommendations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """[지금 갱신] 단추. 캐시를 무시하고 다시 만든다."""
    _require_ai(current_user)
    try:
        recommend_service.refresh(db, current_user)
    except Exception as exc:
        logger.exception("새책 추천 갱신 실패")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"추천 목록을 새로 만들지 못했습니다: {exc}",
        ) from exc
    return _payload(db, current_user)
