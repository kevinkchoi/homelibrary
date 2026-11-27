"""[새책 추천] 목록을 담아 둘 테이블

화면을 열 때마다 알라딘을 여러 번 부르고 Claude로 거르면 느리고 비용도 든다. 하루 한 벌만
만들어 두고 재사용하기 위해 캐시를 테이블에 둔다. (메모리는 재배포 때 날아가고, 파일은
`storage/images`의 고아 파일 스윕에 지워질 수 있어 둘 다 못 쓴다.)

⚠️ 컨테이너가 `alembic upgrade head && uvicorn`으로 뜬다 — 이 마이그레이션이 실패하면
**앱이 아예 안 뜬다.** 그래서 만드는 것만 하고 데이터 변환은 하지 않는다.

Revision ID: 0008
Revises: 0007
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "recommendations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("author", sa.String(length=255), nullable=True),
        sa.Column("publisher", sa.String(length=255), nullable=True),
        sa.Column("pub_date", sa.String(length=20), nullable=True),
        sa.Column("isbn", sa.String(length=20), nullable=True),
        sa.Column("category", sa.String(length=300), nullable=True),
        sa.Column("cover_url", sa.String(length=500), nullable=True),
        sa.Column("link", sa.String(length=500), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("matched_on", sa.String(length=300), nullable=True),
        sa.Column("rank", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_recommendations_generated_at", "recommendations", ["generated_at"])
    op.create_index("ix_recommendations_isbn", "recommendations", ["isbn"])


def downgrade() -> None:
    op.drop_index("ix_recommendations_isbn", table_name="recommendations")
    op.drop_index("ix_recommendations_generated_at", table_name="recommendations")
    op.drop_table("recommendations")
