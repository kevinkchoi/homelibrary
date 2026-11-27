"""개인 서재(personal 모드, homelibrary.kr)를 위한 칸들

- duplicate_acknowledgements.owner_id, recommendations.owner_id — 사람마다 따로 기억/추천
- duplicate_acknowledgements 유일 제약: (reason, key) → (owner_id, reason, key)
  (안 바꾸면 두 사람이 같은 책을 "다른 책"으로 표시할 때 두 번째가 실패한다)
- users.anthropic_api_key_enc — 사용자가 넣은 Claude 키(암호화)
- users.email NULL 허용 — personal 모드 가입에서는 선택 입력

family 모드의 기존 행은 owner_id가 NULL로 남고, 코드도 family 모드에서는
owner를 보지 않으므로 **동작이 바뀌지 않는다.**

⚠️ 컨테이너가 `alembic upgrade head && uvicorn`으로 뜬다 — 실패하면 앱이 아예 안 뜬다.
칸을 더하고 제약을 바꾸기만 하고 데이터는 건드리지 않는다. 운영 서버에 넣기 전 backup.sh 먼저.

Revision ID: 0009
Revises: 0008
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    with op.batch_alter_table("duplicate_acknowledgements") as batch:
        batch.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_duplicate_ack_owner", "users", ["owner_id"], ["id"], ondelete="CASCADE"
        )
        batch.drop_constraint("uq_duplicate_ack_reason_key", type_="unique")
        batch.create_unique_constraint(
            "uq_duplicate_ack_owner_reason_key", ["owner_id", "reason", "key"]
        )
    op.create_index("ix_duplicate_acknowledgements_owner_id", "duplicate_acknowledgements", ["owner_id"])

    with op.batch_alter_table("recommendations") as batch:
        batch.add_column(sa.Column("owner_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_recommendations_owner", "users", ["owner_id"], ["id"], ondelete="CASCADE"
        )
    op.create_index("ix_recommendations_owner_id", "recommendations", ["owner_id"])

    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("anthropic_api_key_enc", sa.Text(), nullable=True))
        batch.alter_column("email", existing_type=sa.String(length=255), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.alter_column("email", existing_type=sa.String(length=255), nullable=False)
        batch.drop_column("anthropic_api_key_enc")

    op.drop_index("ix_recommendations_owner_id", table_name="recommendations")
    with op.batch_alter_table("recommendations") as batch:
        batch.drop_constraint("fk_recommendations_owner", type_="foreignkey")
        batch.drop_column("owner_id")

    op.drop_index("ix_duplicate_acknowledgements_owner_id", table_name="duplicate_acknowledgements")
    with op.batch_alter_table("duplicate_acknowledgements") as batch:
        batch.drop_constraint("uq_duplicate_ack_owner_reason_key", type_="unique")
        batch.create_unique_constraint("uq_duplicate_ack_reason_key", ["reason", "key"])
        batch.drop_constraint("fk_duplicate_ack_owner", type_="foreignkey")
        batch.drop_column("owner_id")
