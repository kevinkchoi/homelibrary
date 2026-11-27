"""add is_admin to users, make books.owner_id nullable with ON DELETE SET NULL

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.alter_column("books", "owner_id", nullable=True)
    op.drop_constraint("books_owner_id_fkey", "books", type_="foreignkey")
    op.create_foreign_key(
        "books_owner_id_fkey", "books", "users", ["owner_id"], ["id"], ondelete="SET NULL"
    )


def downgrade() -> None:
    op.drop_constraint("books_owner_id_fkey", "books", type_="foreignkey")
    op.create_foreign_key("books_owner_id_fkey", "books", "users", ["owner_id"], ["id"])
    op.alter_column("books", "owner_id", nullable=False)

    op.drop_column("users", "is_admin")
