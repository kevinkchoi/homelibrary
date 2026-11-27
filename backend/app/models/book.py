from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(primary_key=True)

    title: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    author: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    publisher: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    pub_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    shelf_location: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # 여러 키워드를 콤마로 이어 담는다("소설, 프랑스, 고전") → services/category_service.py.
    # 100자로는 몇 개만 붙여도 모자라고, Postgres는 넘치면 잘라내지 않고 오류를 낸다.
    category: Mapped[str | None] = mapped_column(String(300), nullable=True, index=True)
    isbn: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)

    # 번역서 정보
    translator: Mapped[str | None] = mapped_column(String(255), nullable=True)
    original_publisher: Mapped[str | None] = mapped_column(String(255), nullable=True)
    original_pub_year: Mapped[int | None] = mapped_column(Integer, nullable=True)

    cover_image_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # 계정이 삭제돼도 책은 남아야 하므로 nullable + ON DELETE SET NULL
    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    owner = relationship("User", back_populates="books")
