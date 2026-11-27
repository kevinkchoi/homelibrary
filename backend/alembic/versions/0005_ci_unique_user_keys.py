"""case-insensitive unique indexes on users.username / users.email

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-26

로그인을 대소문자 무시로 바꿨다(`alice`와 `Alice`를 같은 계정으로 본다). 그러면 **같은 이름이
대소문자만 달리해 두 개 존재하면 안 된다** — 어느 계정으로 로그인되는지 모호해지기 때문이다.

가입 라우터에서도 대소문자 무시로 검사하지만, 그것만으로는 부족하다:
  - 검사와 INSERT 사이에 다른 요청이 끼어들 수 있다(TOCTOU)
  - 나중에 다른 경로(스크립트, 관리 도구)로 사용자를 만들면 검사를 건너뛴다
그래서 DB에 유니크 인덱스를 걸어 **구조적으로 불가능하게** 만든다.

⚠️ 이 마이그레이션은 앱 기동을 막지 않도록 만들어져 있다. 컨테이너는
`alembic upgrade head && uvicorn`으로 뜨므로, 여기서 예외가 나면 **가족 전체가 앱을 못 쓴다.**
이미 대소문자 중복 데이터가 있으면 인덱스를 만들 수 없는데, 그때는 앱을 죽이는 대신
경고를 남기고 건너뛴다(가입 라우터의 검사는 그대로 동작한다). 마이그레이션 0004와 같은 판단.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEXES = {
    "ix_users_username_lower": "username",
    "ix_users_email_lower": "email",
}


def _duplicates(conn, column: str) -> list:
    """대소문자만 다른 중복이 이미 있는지 확인한다(있으면 인덱스를 만들 수 없다)."""
    rows = conn.execute(
        sa.text(
            f"SELECT lower({column}) AS key, count(*) AS n "
            f"FROM users GROUP BY 1 HAVING count(*) > 1"
        )
    ).fetchall()
    return [(r[0], r[1]) for r in rows]


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return  # sqlite로 로컬 검증할 때는 건너뛴다

    for index_name, column in INDEXES.items():
        dups = _duplicates(conn, column)
        if dups:
            print(
                f"[0005] {column}에 대소문자 중복이 있어 유니크 인덱스를 건너뜁니다: {dups}. "
                f"중복을 정리한 뒤 다시 마이그레이션하세요(앱은 정상 동작합니다)."
            )
            continue
        conn.execute(
            sa.text(f"CREATE UNIQUE INDEX IF NOT EXISTS {index_name} ON users (lower({column}))")
        )


def downgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.name != "postgresql":
        return
    for index_name in INDEXES:
        conn.execute(sa.text(f"DROP INDEX IF EXISTS {index_name}"))
