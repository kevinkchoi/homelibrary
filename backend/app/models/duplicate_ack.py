from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DuplicateAcknowledgement(Base):
    """"이 책들은 중복이 아니다"라고 사용자가 확인해 둔 기록.

    집에 **일부러 같은 책을 여러 권 두거나**(선물용, 판본 수집 등), 제목만 같고 실제로는
    다른 책인 경우가 있다. 그런 묶음을 매번 "중복"이라고 띄우면 경고가 무의미해진다.
    그래서 한 번 확인한 묶음은 기억해 두고 다시 묻지 않는다.

    책 id가 아니라 **묶음 기준값(key)** 을 저장하는 이유: 나중에 같은 책을 한 권 더
    추가하더라도 같은 묶음이므로 다시 묻지 않아야 하기 때문이다.
    """

    __tablename__ = "duplicate_acknowledgements"
    # personal 모드에서는 사람마다 따로 기억해야 하므로 owner까지 묶어 유일하다(0009).
    # family 모드는 owner가 NULL이고, 중복 저장은 _save_acknowledgements가 미리 걸러 준다.
    __table_args__ = (
        UniqueConstraint("library_id", "reason", "key", name="uq_duplicate_ack_library_reason_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # personal 모드(homelibrary.kr)의 주인. family 모드는 NULL(가족 공용).
    owner_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    # 0010부터는 사람이 아니라 **도서관** 단위로 가른다(멤버끼리 '다른 책' 표시·추천을 함께 본다).
    # owner_id는 0009의 흔적으로 남는다(쓰지 않음).
    library_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("libraries.id", ondelete="CASCADE"), nullable=True, index=True
    )

    # "isbn" = 같은 ISBN 묶음 / "title" = 같은 제목 묶음 (books.py의 DuplicateGroup.reason과 동일)
    reason: Mapped[str] = mapped_column(String(10), nullable=False)
    # 정규화된 ISBN-13 또는 정규화된 제목
    key: Mapped[str] = mapped_column(String(500), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
