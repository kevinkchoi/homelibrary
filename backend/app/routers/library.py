"""[우리 도서관] — 도서관 정보와 멤버 관리 (personal 모드).

누구나 자기 도서관의 이름·멤버·권수를 본다. 주인과 공동 관리자는 멤버를 만들고(아이디·비밀번호를 직접),
역할을 바꾸고, 비밀번호를 재설정하고, 빼고, **도서관 초대 코드**를 만들거나 끈다.

모든 대상은 **같은 도서관의 사람**으로 한정한다 — 다른 도서관 사람의 번호를 넣으면 없는 사람과 같이 404.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import library_scope
from app.auth.deps import get_current_user
from app.auth.security import hash_password
from app.database import get_db
from app.models.book import Book
from app.models.library import MEMBER_ROLES, ROLE_OWNER, Library
from app.models.user import User
from app.routers.auth import ensure_account_available
from app.schemas.user import (
    InviteCodeRequest,
    LibraryInfo,
    LibraryMember,
    LibraryRename,
    MemberCreate,
    MemberRole,
    UserPasswordReset,
    UserRegister,
)
from app.services import library_service

router = APIRouter(prefix="/api/library", tags=["library"])


def _my_library(db: Session, user: User) -> Library:
    if library_scope.library_id_for(user) is None:
        raise HTTPException(status_code=404, detail="이 서버에는 도서관 공유가 없습니다.")
    lib = db.get(Library, user.library_id) if user.library_id else None
    if lib is None:
        raise HTTPException(status_code=404, detail="속한 도서관이 없습니다. 운영자에게 문의하세요.")
    return lib


def _member_or_404(db: Session, lib: Library, member_id: int) -> User:
    member = db.query(User).filter(User.id == member_id, User.library_id == lib.id).first()
    if member is None:
        raise HTTPException(status_code=404, detail="이 도서관의 멤버가 아닙니다.")
    return member


def _check_role(role: str) -> str:
    if role not in MEMBER_ROLES:
        raise HTTPException(status_code=400, detail="역할은 공동 관리자 / 편집 / 보기만 중에서 고릅니다.")
    return role


def _info(db: Session, lib: Library, me: User) -> LibraryInfo:
    members = db.query(User).filter(User.library_id == lib.id).order_by(User.created_at.asc()).all()
    counts = dict(
        db.query(Book.owner_id, func.count(Book.id))
        .filter(Book.library_id == lib.id)
        .group_by(Book.owner_id)
        .all()
    )
    manage = library_scope.can_manage(me)
    # 주인을 맨 위로
    members.sort(key=lambda u: (u.id != lib.owner_user_id, u.created_at))
    return LibraryInfo(
        id=lib.id,
        name=lib.name,
        my_role=me.library_role,
        can_manage=manage,
        book_count=db.query(func.count(Book.id)).filter(Book.library_id == lib.id).scalar() or 0,
        members=[
            LibraryMember(
                id=u.id,
                username=u.username,
                role=ROLE_OWNER if u.id == lib.owner_user_id else u.library_role,
                created_at=u.created_at,
                book_count=counts.get(u.id, 0),
            )
            for u in members
        ],
        invite_code=lib.invite_code if manage else None,
        invite_role=lib.invite_role if manage else None,
    )


@router.get("", response_model=LibraryInfo)
def get_library(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _info(db, _my_library(db, current_user), current_user)


@router.put("", response_model=LibraryInfo)
def rename_library(
    payload: LibraryRename, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    library_scope.ensure_can_manage(current_user)
    lib = _my_library(db, current_user)
    lib.name = payload.name.strip()
    db.commit()
    return _info(db, lib, current_user)


@router.post("/members", response_model=LibraryInfo, status_code=201)
def create_member(
    payload: MemberCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    """주인·공동 관리자가 가족·친구 계정을 **직접** 만든다(메일·초대 절차 없이). 만든 아이디·비밀번호를 알려 주면 끝."""
    library_scope.ensure_can_manage(current_user)
    lib = _my_library(db, current_user)
    role = _check_role(payload.role)
    ensure_account_available(
        db, UserRegister(username=payload.username, email=payload.email, password=payload.password)
    )
    member = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        is_admin=False,
        library_id=lib.id,
        library_role=role,
    )
    db.add(member)
    db.commit()
    return _info(db, lib, current_user)


@router.put("/members/{member_id}/role", response_model=LibraryInfo)
def set_member_role(
    member_id: int,
    payload: MemberRole,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    library_scope.ensure_can_manage(current_user)
    lib = _my_library(db, current_user)
    member = _member_or_404(db, lib, member_id)
    if member.id == lib.owner_user_id:
        raise HTTPException(status_code=400, detail="도서관 주인의 역할은 바꿀 수 없습니다.")
    member.library_role = _check_role(payload.role)
    db.commit()
    return _info(db, lib, current_user)


@router.put("/members/{member_id}/password", status_code=204)
def reset_member_password(
    member_id: int,
    payload: UserPasswordReset,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """멤버가 비밀번호를 잊었을 때. 주인의 비밀번호는 주인 자신만([내 설정]) 바꾼다."""
    library_scope.ensure_can_manage(current_user)
    lib = _my_library(db, current_user)
    member = _member_or_404(db, lib, member_id)
    if member.id == lib.owner_user_id and member.id != current_user.id:
        raise HTTPException(status_code=403, detail="도서관 주인의 비밀번호는 주인만 바꿀 수 있습니다.")
    member.password_hash = hash_password(payload.password)
    db.commit()


@router.delete("/members/{member_id}", response_model=LibraryInfo)
def remove_member(member_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """멤버를 뺀다(계정이 지워진다). 그 사람이 넣은 책은 도서관에 남는다."""
    library_scope.ensure_can_manage(current_user)
    lib = _my_library(db, current_user)
    member = _member_or_404(db, lib, member_id)
    if member.id == lib.owner_user_id:
        raise HTTPException(status_code=400, detail="도서관 주인은 뺄 수 없습니다.")
    if member.id == current_user.id:
        raise HTTPException(status_code=400, detail="자기 자신은 뺄 수 없습니다.")
    library_service.remove_member(db, member)
    db.commit()
    return _info(db, lib, current_user)


@router.post("/invite-code", response_model=LibraryInfo)
def make_invite_code(
    payload: InviteCodeRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):
    """도서관 초대 코드를 (새로) 만든다. 이전 코드는 더 이상 쓸 수 없다. 이 코드로 가입한 사람이 받을 역할도 정한다."""
    library_scope.ensure_can_manage(current_user)
    lib = _my_library(db, current_user)
    lib.invite_role = _check_role(payload.role)
    lib.invite_code = library_service.new_invite_code()
    db.commit()
    return _info(db, lib, current_user)


@router.delete("/invite-code", response_model=LibraryInfo)
def disable_invite_code(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    library_scope.ensure_can_manage(current_user)
    lib = _my_library(db, current_user)
    lib.invite_code = None
    db.commit()
    return _info(db, lib, current_user)
