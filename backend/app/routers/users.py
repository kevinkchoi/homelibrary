from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.deps import require_admin
from app.auth.security import hash_password
from app.config import settings
from app.database import get_db
from app.models.book import Book
from app.models.library import Library
from app.models.user import User
from app.services import library_service
from app.routers.auth import ensure_account_available
from app.schemas.user import UserAdminUpdate, UserOut, UserPasswordReset, UserRegister

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    users = db.query(User).order_by(User.created_at.asc()).all()
    if settings.personal_mode:
        # 개인 서재 서버의 운영자는 사용자의 **개인정보를 볼 수 없다**(사용자 요구, 2026-11-27) — 이메일을 비운다.
        # 운영에 필요한 것(아이디·도서관·역할·가입일)만. 도서관별 현황은 /api/admin/libraries.
        return [UserOut.model_validate(u).model_copy(update={"email": None}) for u in users]
    return users


@router.post("", response_model=UserOut, status_code=201)
def create_user(payload: UserRegister, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """관리자가 가족 계정을 만든다. 공개 가입은 닫혀 있다(auth.register 참고).

    가입과 달리 **토큰을 돌려주지 않는다** — 돌려주면 화면이 새 계정으로 로그인이 바뀐다.

    개인 서재(personal) 서버에서는 쓰지 않는다: 새 사람은 사이트 초대 코드로 가입해 자기 도서관을 만들고,
    도서관 멤버는 그 도서관의 주인이 [우리 도서관]에서 만든다(POST /api/library/members).
    """
    if settings.personal_mode:
        raise HTTPException(
            status_code=400,
            detail="개인 서재 서버에서는 초대 코드로 가입하거나, 도서관 주인이 [우리 도서관]에서 멤버를 만듭니다.",
        )
    ensure_account_available(db, payload)
    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        is_admin=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _ensure_not_last_admin(db: Session, excluding_user_id: int) -> None:
    remaining = db.query(User).filter(User.is_admin.is_(True), User.id != excluding_user_id).count()
    if remaining == 0:
        raise HTTPException(status_code=400, detail="마지막 남은 관리자입니다. 다른 관리자를 먼저 지정해주세요.")


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="자기 자신의 계정은 삭제할 수 없습니다.")

    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    if target.is_admin:
        _ensure_not_last_admin(db, excluding_user_id=user_id)

    if settings.personal_mode:
        # 개인 서재: 도서관 **주인**을 지우면 그 도서관 전체(멤버·책·표지)를 지운다 — 주인 없는 도서관을 남기지 않는다.
        # 멤버만 지우면 그 사람 계정만 지우고 책은 도서관에 남는다(library_service).
        lib = db.get(Library, target.library_id) if target.library_id else None
        if lib is not None and lib.owner_user_id == target.id:
            library_service.delete_library(db, lib)
        else:
            library_service.remove_member(db, target)
        db.commit()
        return
    # 계정은 삭제하되, 그 사람이 등록한 책은 가족 공용 목록에 그대로 남김
    db.query(Book).filter(Book.owner_id == user_id).update({Book.owner_id: None})
    db.delete(target)
    db.commit()


@router.put("/{user_id}/admin", response_model=UserOut)
def set_admin(
    user_id: int,
    payload: UserAdminUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    if target.id == admin.id and not payload.is_admin:
        _ensure_not_last_admin(db, excluding_user_id=user_id)

    target.is_admin = payload.is_admin
    db.commit()
    db.refresh(target)
    return target


@router.put("/{user_id}/password", status_code=204)
def reset_password(
    user_id: int,
    payload: UserPasswordReset,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """관리자가 가족의 비밀번호를 새로 정해 준다.

    왜: 공개 가입이 닫혔고(2026-10-11) 안드로이드 앱이 공개 주소로 바뀌면서 **다시 로그인**해야
    하는데, 비밀번호를 잊으면 되찾을 길이 없었다(이메일 발송 기능 없음). 계정을 지우고 새로
    만드는 방법은 그 사람이 등록한 책의 주인 표시를 잃는다.
    이미 발급된 토큰은 무효화하지 않는다(JWT에 비밀번호 버전이 없다) — 만료 시까지 유효.
    """
    if settings.personal_mode:
        # 운영자가 남의 비밀번호를 바꿀 수 있으면 그 계정으로 들어가 책 목록을 볼 수 있다 — "운영자가 사용자 데이터를
        # 빼갈 수 없게"(사용자 요구, 2026-11-27)와 어긋난다. 멤버의 비밀번호는 **그 도서관의 주인**이 재설정한다.
        raise HTTPException(
            status_code=403,
            detail="개인 서재 서버에서는 운영자가 비밀번호를 바꿀 수 없습니다. 도서관 주인이 [우리 도서관]에서 재설정합니다.",
        )
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    target.password_hash = hash_password(payload.password)
    db.commit()
