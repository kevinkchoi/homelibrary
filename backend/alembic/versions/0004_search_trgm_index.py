"""add pg_trgm GIN indexes for substring search on books

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-02

통합검색은 `ILIKE '%키워드%'`로 도는데, 앞이 열린 패턴이라 기존 b-tree 인덱스
(`title`/`author`/`publisher`의 `index=True`)를 **전혀 타지 못하고 매번 전체 스캔**한다.
pg_trgm GIN 인덱스는 이런 양쪽 열린 LIKE/ILIKE를 인덱스로 처리할 수 있어, 책이 늘어나도
검색이 느려지지 않는다. 한글에도 그대로 적용된다(3글자 이상 토큰에서 인덱스가 쓰임).

기존 b-tree 인덱스는 그대로 둔다 — 목록 화면의 `ORDER BY title` 같은 정렬에는 그쪽이 쓰인다.

⚠️ **이 마이그레이션은 실패해도 앱을 멈추지 않도록 만들어져 있다.** `CREATE EXTENSION`은
superuser 권한이 필요한데, 컨테이너는 `alembic upgrade head && uvicorn ...`으로 뜨기 때문에
여기서 예외가 나면 **API가 아예 부팅하지 못한다**. 인덱스는 순수 성능 최적화이고 검색은
인덱스 없이도 (느리게) 동작하므로, 권한/확장이 없으면 조용히 건너뛴다.
또 실패한 문장은 트랜잭션을 오염시켜 뒤 문장까지 죽이므로, try/except가 아니라
**미리 조건을 확인(pre-flight)** 하는 방식을 쓴다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# 통합검색이 훑는 컬럼들 (books.py의 _keyword_conditions와 같은 목록)
TRGM_COLUMNS = ["title", "author", "publisher", "translator", "isbn"]


def _trgm_usable(conn) -> bool:
    """pg_trgm을 지금 쓸 수 있는지 확인한다(이미 설치됨 or 설치 가능 + 권한 있음)."""
    if conn.dialect.name != "postgresql":
        return False  # sqlite 등으로 테스트할 때는 조용히 건너뛴다
    installed = conn.execute(
        sa.text("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")
    ).scalar()
    if installed:
        return True
    available = conn.execute(
        sa.text("SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm'")
    ).scalar()
    is_superuser = conn.execute(
        sa.text("SELECT usesuper FROM pg_user WHERE usename = current_user")
    ).scalar()
    if not (available and is_superuser):
        return False
    conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    return True


def upgrade() -> None:
    conn = op.get_bind()
    if not _trgm_usable(conn):
        print("[0004] pg_trgm을 쓸 수 없어 검색 인덱스 생성을 건너뜁니다(검색은 정상 동작).")
        return
    for column in TRGM_COLUMNS:
        conn.execute(
            sa.text(
                f"CREATE INDEX IF NOT EXISTS ix_books_{column}_trgm "
                f"ON books USING gin ({column} gin_trgm_ops)"
            )
        )


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return
    for column in TRGM_COLUMNS:
        conn.execute(sa.text(f"DROP INDEX IF EXISTS ix_books_{column}_trgm"))
    # pg_trgm 확장 자체는 다른 곳에서 쓸 수 있으므로 남겨둔다
