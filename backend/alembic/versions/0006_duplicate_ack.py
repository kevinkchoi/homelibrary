"""add duplicate_acknowledgements table

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-26

집에 같은 책을 일부러 여러 권 두거나(선물용·판본 수집), 제목만 같고 실제로는 다른 책인
경우가 있다. 그런 묶음까지 매번 "중복"이라고 띄우면 경고 자체가 무의미해진다.
사용자가 "이건 다른 책"이라고 확인한 묶음을 기억해 두기 위한 표.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "duplicate_acknowledgements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=10), nullable=False),
        sa.Column("key", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        # 같은 묶음을 두 번 확인해도 한 줄만 남도록
        sa.UniqueConstraint("reason", "key", name="uq_duplicate_ack_reason_key"),
    )


def downgrade() -> None:
    op.drop_table("duplicate_acknowledgements")
