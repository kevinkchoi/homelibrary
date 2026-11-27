"""도서관 공유(personal 모드) + 도움말 환영 표시 + 의견(피드백)

- libraries 표: 가입자마다 도서관 하나, 주인이 가족·친구를 멤버로 넣어 함께 본다
- users.library_id / library_role(owner·manager·editor·viewer) / welcome_seen_at
- books·duplicate_acknowledgements·recommendations.library_id — 0009의 owner_id 대신 **도서관**으로 가른다
- '다른 책' 유일 제약 (owner_id, reason, key) → (library_id, reason, key)
- feedback 표

**기존 데이터 옮기기**: 사용자마다 "<아이디>의 도서관"을 하나씩 만들고 그 사람을 주인으로, 그 사람이 넣은 책·
'다른 책' 표시·추천을 그 도서관으로 옮긴다. 모드와 상관없이 같은 일을 한다 — family 모드(가족 공용 서버)는
library_id를 보지 않으므로 **동작이 바뀌지 않는다**(library_scope). 등록자가 지워진 책(owner_id NULL)은
library_id도 NULL로 남는다(family에서만 생기고, family는 보지 않는다).

⚠️ 컨테이너가 `alembic upgrade head && uvicorn`으로 뜬다 — 실패하면 앱이 아예 안 뜬다. 운영에 넣기 전 backup.sh.

Revision ID: 0010
Revises: 0009
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "libraries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=True),
        sa.Column("invite_code", sa.String(length=40), nullable=True),
        sa.Column("invite_role", sa.String(length=10), nullable=False, server_default="editor"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], name="fk_libraries_owner", ondelete="SET NULL"),
        sa.UniqueConstraint("invite_code", name="uq_libraries_invite_code"),
    )

    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("library_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("library_role", sa.String(length=10), nullable=False, server_default="owner"))
        batch.add_column(sa.Column("welcome_seen_at", sa.DateTime(timezone=True), nullable=True))
        batch.create_foreign_key("fk_users_library", "libraries", ["library_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_users_library_id", "users", ["library_id"])

    for table in ("books", "duplicate_acknowledgements", "recommendations"):
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("library_id", sa.Integer(), nullable=True))
            batch.create_foreign_key(f"fk_{table}_library", "libraries", ["library_id"], ["id"], ondelete="CASCADE")
        op.create_index(f"ix_{table}_library_id", table, ["library_id"])

    # ── 기존 데이터: 사용자마다 도서관 하나 ────────────────────────────────
    conn = op.get_bind()
    users = conn.execute(sa.text("SELECT id, username, created_at FROM users ORDER BY id")).fetchall()
    for uid, username, created_at in users:
        lib_id = conn.execute(
            sa.text(
                "INSERT INTO libraries (name, owner_user_id, invite_role, created_at) "
                "VALUES (:name, :uid, 'editor', :created) RETURNING id"
            ),
            {"name": f"{username}의 도서관", "uid": uid, "created": created_at},
        ).scalar()
        conn.execute(
            sa.text("UPDATE users SET library_id = :lib, library_role = 'owner' WHERE id = :uid"),
            {"lib": lib_id, "uid": uid},
        )
    for table in ("books", "duplicate_acknowledgements", "recommendations"):
        conn.execute(
            sa.text(
                f"UPDATE {table} SET library_id = (SELECT u.library_id FROM users u WHERE u.id = {table}.owner_id) "
                "WHERE owner_id IS NOT NULL"
            )
        )

    with op.batch_alter_table("duplicate_acknowledgements") as batch:
        batch.drop_constraint("uq_duplicate_ack_owner_reason_key", type_="unique")
        batch.create_unique_constraint("uq_duplicate_ack_library_reason_key", ["library_id", "reason", "key"])

    op.create_table(
        "feedback",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("category", sa.String(length=10), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="new"),
        sa.Column("admin_reply", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_feedback_user", ondelete="SET NULL"),
    )
    op.create_index("ix_feedback_user_id", "feedback", ["user_id"])
    op.create_index("ix_feedback_created_at", "feedback", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_feedback_created_at", table_name="feedback")
    op.drop_index("ix_feedback_user_id", table_name="feedback")
    op.drop_table("feedback")
    with op.batch_alter_table("duplicate_acknowledgements") as batch:
        batch.drop_constraint("uq_duplicate_ack_library_reason_key", type_="unique")
        batch.create_unique_constraint("uq_duplicate_ack_owner_reason_key", ["owner_id", "reason", "key"])
    for table in ("recommendations", "duplicate_acknowledgements", "books"):
        op.drop_index(f"ix_{table}_library_id", table_name=table)
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"fk_{table}_library", type_="foreignkey")
            batch.drop_column("library_id")
    op.drop_index("ix_users_library_id", table_name="users")
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("fk_users_library", type_="foreignkey")
        batch.drop_column("welcome_seen_at")
        batch.drop_column("library_role")
        batch.drop_column("library_id")
    op.drop_table("libraries")
