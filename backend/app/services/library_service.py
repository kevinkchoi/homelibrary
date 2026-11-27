"""도서관 만들기·멤버 넣고 빼기·도서관 지우기 (personal 모드).

책·표지까지 함께 지우는 일이 여기 모여 있다 — 지우는 길이 여러 곳에 흩어지면 표지 파일만 남거나
다른 도서관 것을 건드리는 실수가 생긴다.
"""

import secrets

from sqlalchemy.orm import Session

from app.models.book import Book
from app.models.library import ROLE_OWNER, Library
from app.models.user import User
from app.services.image_service import delete_image

# 도서관 초대 코드: 사이트 초대 코드와 섞이지 않게 'lib-'로 시작, 폰에서 치기 쉽게 헷갈리는 글자(0/o, 1/l/i) 없이
_CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"


def new_invite_code() -> str:
    part = lambda: "".join(secrets.choice(_CODE_CHARS) for _ in range(4))  # noqa: E731
    return f"lib-{part()}-{part()}"


def create_library_for(db: Session, user: User, name: str | None = None) -> Library:
    """user를 주인으로 하는 새 도서관을 만들고 user를 그 도서관에 넣는다(커밋은 부르는 쪽이)."""
    lib = Library(name=(name or f"{user.username}의 도서관")[:100], owner_user_id=user.id)
    db.add(lib)
    db.flush()
    user.library_id = lib.id
    user.library_role = ROLE_OWNER
    return lib


def find_by_invite_code(db: Session, code: str | None) -> Library | None:
    code = (code or "").strip().lower()
    if not code.startswith("lib-"):
        return None
    return db.query(Library).filter(Library.invite_code == code).first()


def remove_member(db: Session, member: User) -> None:
    """멤버 계정을 지운다. 그 사람이 넣은 책은 **도서관에 남긴다**(도서관 전체의 책이므로) — 등록자 표시만 비운다."""
    db.query(Book).filter(Book.owner_id == member.id).update({Book.owner_id: None}, synchronize_session=False)
    db.delete(member)


def delete_library(db: Session, lib: Library) -> dict:
    """도서관 전체를 지운다: 모든 멤버 계정, 책, 표지 파일. '다른 책' 표시·추천은 FK CASCADE로 함께 지워진다.

    운영자가 말썽 사용자의 도서관을 지울 때, 그리고 복구 전에 같은 도서관을 비울 때 쓴다.
    """
    books = db.query(Book).filter(Book.library_id == lib.id).all()
    for book in books:
        delete_image(book.cover_image_path)
        db.delete(book)
    members = db.query(User).filter(User.library_id == lib.id).all()
    lib.owner_user_id = None
    db.flush()
    for m in members:
        db.delete(m)
    db.flush()
    db.delete(lib)
    return {"books": len(books), "members": len(members)}
