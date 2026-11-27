"""[내 설정] — 로그인한 사람 자신의 것만 다룬다.

- Claude API 키 (personal 모드, homelibrary.kr): 표지 사진 인식·새책 추천을 켜는 열쇠
- 비밀번호 바꾸기: 메일 발송 기능이 없어 "비밀번호 찾기"가 없다. 대신 로그인한 상태에서 바꿀 수 있게.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import hash_password, verify_password
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.schemas.user import AiKeyIn, AiKeyStatus, PasswordChange
from app.services import user_keys

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/me", tags=["me"])


def _status(user: User) -> AiKeyStatus:
    if settings.personal_mode:
        last4 = user_keys.last4(user)
        return AiKeyStatus(
            available=bool(last4), source="user" if last4 else None, last4=last4, user_key_allowed=True
        )
    has_server = bool(settings.anthropic_api_key)
    return AiKeyStatus(available=has_server, source="server" if has_server else None)


@router.get("/ai-key", response_model=AiKeyStatus)
def get_ai_key(current_user: User = Depends(get_current_user)):
    return _status(current_user)


@router.put("/ai-key", response_model=AiKeyStatus)
def put_ai_key(
    payload: AiKeyIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """자기 키를 저장한다. 저장 전에 Claude에 실제로 물어 동작하는 키인지 확인한다."""
    if not settings.personal_mode:
        raise HTTPException(status_code=400, detail="이 서버는 서버에 설정된 키를 씁니다.")
    value = payload.api_key.strip()
    if not user_keys.looks_like_anthropic_key(value):
        raise HTTPException(
            status_code=400,
            detail="Claude API 키 형식이 아닙니다. console.anthropic.com에서 만든 'sk-ant-'로 시작하는 키를 넣어 주세요.",
        )
    try:
        user_keys.verify_key(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    current_user.anthropic_api_key_enc = user_keys.encrypt(value)
    db.commit()
    logger.info("사용자 Claude 키 저장: user_id=%s", current_user.id)  # 키 값은 찍지 않는다
    return _status(current_user)


@router.delete("/ai-key", response_model=AiKeyStatus)
def delete_ai_key(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.anthropic_api_key_enc = None
    db.commit()
    return _status(current_user)


@router.put("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: PasswordChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="지금 비밀번호가 맞지 않습니다.")
    current_user.password_hash = hash_password(payload.new_password)
    db.commit()
