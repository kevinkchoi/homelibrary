from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    # personal 모드에서는 선택 입력이라 비어 있을 수 있다(0009). family 모드 가입·추가는 계속 필수.
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # 사용자가 [내 설정]에 넣은 **자기 Claude API 키**를 Fernet으로 암호화한 값(0009).
    # personal 모드에서 표지 사진 인식·새책 추천은 이 키로만 돈다(운영자 키를 쓰지 않는다).
    # 평문은 저장하지도, 화면에 돌려주지도 않는다 — 끝 4자리만 보여 준다(services/user_keys.py).
    anthropic_api_key_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # 책은 가족/구성원 전체가 공유하는 자원이므로, 계정을 삭제해도 책은 남기고
    # owner_id만 NULL로 바뀜 (cascade delete 아님 — Book.owner_id의 ondelete="SET NULL" 참고)
    books = relationship("Book", back_populates="owner")
