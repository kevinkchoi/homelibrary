from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# 도서관 안에서의 역할 (personal 모드, homelibrary.kr) — 2026-11-27 사용자 결정: "멤버마다 주인이 정함"
ROLE_OWNER = "owner"  # 주인: 가입해서 도서관을 만든 사람. 멤버 관리 + 책 편집. 한 도서관에 한 명
ROLE_MANAGER = "manager"  # 공동 관리자: 주인처럼 멤버를 관리하고 책을 편집한다(주인을 바꾸지는 못한다)
ROLE_EDITOR = "editor"  # 편집: 책 추가·수정·삭제
ROLE_VIEWER = "viewer"  # 보기만: 검색·중복 확인만

ROLES = (ROLE_OWNER, ROLE_MANAGER, ROLE_EDITOR, ROLE_VIEWER)
MEMBER_ROLES = (ROLE_MANAGER, ROLE_EDITOR, ROLE_VIEWER)  # 주인이 아닌 사람에게 줄 수 있는 역할
CAN_MANAGE = (ROLE_OWNER, ROLE_MANAGER)
CAN_EDIT = (ROLE_OWNER, ROLE_MANAGER, ROLE_EDITOR)


class Library(Base):
    """도서관 — 책을 함께 보는 사람들의 묶음 (personal 모드에서만 의미가 있다).

    가입하면 자기 도서관이 생기고 그 사람이 **주인**이 된다. 주인은 가족·친구를 멤버로 넣어
    같은 책을 함께 본다 — 직접 아이디를 만들어 주거나, **도서관 초대 코드**를 나눠 주면 그 코드로 가입한
    사람이 이 도서관에 들어온다(사이트 초대 코드로 가입하면 새 도서관이 생긴다).

    family 모드(가족 공용 서버)에서는 모든 계정이 한 서재를 보므로 이 표를 보지 않는다(library_scope).
    """

    __tablename__ = "libraries"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    owner_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL", use_alter=True), nullable=True
    )
    # 도서관 초대 코드 — 비우면 코드로는 못 들어온다. 사이트 초대 코드와 섞이지 않게 'lib-'로 시작한다.
    invite_code: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    # 그 코드로 들어온 사람이 받는 역할(주인이 코드를 만들 때 고른다)
    invite_role: Mapped[str] = mapped_column(String(10), nullable=False, default=ROLE_EDITOR)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
