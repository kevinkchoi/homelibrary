"""카테고리 컬럼을 넓힌다(여러 키워드를 콤마로 이어 담기 위해)

카테고리를 `"소설, 프랑스, 고전"`처럼 여러 개 붙일 수 있게 되면서 기존 VARCHAR(100)으로는
모자란다. Postgres는 길이를 넘기면 자르지 않고 **오류를 낸다** — 책 저장이 실패한다.

데이터 변환은 없다. 기존 값은 그대로 "키워드 1개짜리 목록"으로 해석된다.

Revision ID: 0007
Revises: 0006
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.alter_column(
        "books",
        "category",
        existing_type=sa.String(length=100),
        type_=sa.String(length=300),
        existing_nullable=True,
    )


def downgrade() -> None:
    # 되돌리기 전에 길이를 넘는 값을 잘라 둔다. 안 그러면 ALTER가 실패한다.
    op.execute("UPDATE books SET category = left(category, 100) WHERE length(category) > 100")
    op.alter_column(
        "books",
        "category",
        existing_type=sa.String(length=300),
        type_=sa.String(length=100),
        existing_nullable=True,
    )
