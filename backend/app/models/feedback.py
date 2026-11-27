from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

CATEGORIES = ("bug", "idea", "praise", "other")  # 버그 / 기능 제안 / 칭찬 / 기타
STATUSES = ("new", "reviewing", "done", "declined")  # 접수 / 검토 중 / 반영 / 보류


class Feedback(Base):
    """사용자가 [도움말 → 의견 보내기]로 운영자에게 보낸 코멘트·기능 제안.

    운영자는 모아 보고 상태·답을 남기며, 보낸 사람은 [내가 보낸 의견]에서 그 답을 본다.
    계정이 지워져도 의견은 남긴다(보낸 사람 표시는 username 사본으로).
    """

    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    username: Mapped[str] = mapped_column(String(50), nullable=False)
    category: Mapped[str] = mapped_column(String(10), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="new")
    admin_reply: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
