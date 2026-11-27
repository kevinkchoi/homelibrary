import hmac

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.security import create_access_token, hash_password, verify_password
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.services import library_service
from app.schemas.user import PublicConfig, Token, UserOut, UserRegister

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _find_user_by_username(db: Session, username: str) -> User | None:
    """아이디를 **대소문자 구분 없이** 찾는다.

    왜: 휴대폰 키보드가 첫 글자를 자동으로 대문자로 만들어(`alice` → `Alice`) 휴대폰에서만
    로그인이 실패하는 일이 실제로 있었다. 프론트에서 `autoCapitalize="none"`으로도 막지만,
    클라이언트를 못 믿어도 되도록 서버에서도 대소문자를 무시한다.

    `order_by(User.id)`: 만에 하나 대소문자만 다른 계정이 함께 존재하더라도 **항상 같은 계정**이
    선택되도록(비결정적으로 오락가락하지 않도록) 한다. 애초에 그런 상태가 되지 않게
    가입 검사와 DB 유니크 인덱스(마이그레이션 0005)로 막아 둔다.
    """
    normalized = (username or "").strip().lower()
    if not normalized:
        return None
    return (
        db.query(User)
        .filter(func.lower(User.username) == normalized)
        .order_by(User.id)
        .first()
    )


def ensure_account_available(db: Session, payload: UserRegister) -> None:
    """아이디·이메일이 이미 쓰이고 있으면 400. 가입과 관리자 계정 추가가 같은 기준을 쓴다."""
    # ⚠️ 로그인을 대소문자 무시로 바꿨으므로 **가입 검사도 반드시 같은 기준**이어야 한다.
    # 아니면 `alice`가 있는데 `Alice`로 가입이 되고, 그 뒤 로그인이 어느 계정인지 모호해진다.
    if _find_user_by_username(db, payload.username):
        raise HTTPException(status_code=400, detail="이미 사용 중인 사용자 이름입니다.")
    if not payload.email:
        if not settings.personal_mode:
            # family 모드는 예전처럼 이메일 필수
            raise HTTPException(status_code=400, detail="이메일을 입력해주세요.")
        return
    if db.query(User).filter(func.lower(User.email) == payload.email.strip().lower()).first():
        raise HTTPException(status_code=400, detail="이미 사용 중인 이메일입니다.")


def _invite_ok(code: str | None) -> bool:
    expected = settings.signup_invite_code.strip()
    if not expected:
        return False  # 코드를 정해 두지 않았으면 가입은 닫혀 있다
    # 시간 차로 코드를 알아내지 못하게 상수 시간 비교
    return hmac.compare_digest((code or "").strip().encode(), expected.encode())


@router.get("/config", response_model=PublicConfig)
def public_config():
    """로그인 전 화면이 알아야 하는 것: 어떤 운영 형태인지, 가입을 받는지.
    (초대 코드 값 자체는 당연히 주지 않는다)"""
    signup = settings.personal_mode and bool(settings.signup_invite_code.strip())
    return PublicConfig(
        library_mode="personal" if settings.personal_mode else "family",
        signup_enabled=signup,
        signup_requires_invite=signup,
    )


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(payload: UserRegister, db: Session = Depends(get_db)):
    """가입.

    - 계정이 **하나도 없으면** 누구든 첫 계정을 만들 수 있고 관리자(운영자)가 된다.
    - **family 모드**: 그 뒤로는 닫혀 있다(2026-10-11). 가족 계정은 관리자가 만든다.
    - **personal 모드**(homelibrary.kr): **초대 코드**가 맞아야 가입된다(사용자 결정, 2026-11-27). 이메일은 선택.
      - **사이트 초대 코드**(.env의 SIGNUP_INVITE_CODE) → **새 도서관**이 생기고 그 주인이 된다
      - **도서관 초대 코드**(`lib-xxxx-xxxx`, 도서관 주인이 [우리 도서관]에서 만든다) → **그 도서관의 멤버**가 된다.
        역할은 주인이 코드를 만들 때 정해 둔 것(편집/보기만/공동 관리자)

    로그인·가입은 nginx에서 접속자별 분당 10회로 제한된다(frontend/nginx.conf) — 코드 대입을 막는다.
    """
    is_first_user = db.query(User).count() == 0
    join_library = None
    if not is_first_user:
        if not settings.personal_mode:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="회원가입은 닫혀 있습니다. 관리자에게 계정을 요청해주세요.",
            )
        join_library = library_service.find_by_invite_code(db, payload.invite_code)
        if join_library is None and not _invite_ok(payload.invite_code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="초대 코드가 맞지 않습니다.",
            )
    ensure_account_available(db, payload)

    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        is_admin=is_first_user,
    )
    db.add(user)
    db.flush()
    if join_library is not None:
        user.library_id = join_library.id
        user.library_role = join_library.invite_role
    else:
        # 첫 계정(모드 무관)이거나 사이트 초대 코드로 가입 → 자기 도서관의 주인
        library_service.create_library_for(db, user)
    db.commit()
    db.refresh(user)

    token = create_access_token(subject=user.username)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = _find_user_by_username(db, form_data.username)
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다.",
        )
    token = create_access_token(subject=user.username)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
