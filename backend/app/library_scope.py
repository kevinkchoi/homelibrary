"""누구의 책을 볼 것인가 — 운영 형태(family / personal)에 따라 한 곳에서 정한다.

**family**(가족 공용): 모든 계정이 같은 서재를 본다. 여기 함수들은
아무것도 거르지 않는다 → 이 파일이 생기기 전과 **동작이 똑같다.**

**personal**(개인 서재, homelibrary.kr): 각자 자기 책만. 책을 읽는 **모든** 쿼리가 `books()`나
`scope()`를 거쳐야 한다. 하나라도 `db.query(Book)`을 그대로 쓰면 남의 책이 보이거나 — 더 나쁘게는
번호(`/api/books/123`)만 바꿔 남의 책을 고치거나 지울 수 있다.

⚠️ 새 엔드포인트를 만들 때 `db.query(Book…)`를 직접 쓰지 말 것. 고친 뒤에는
   `python3 tools/check_isolation.py <주소> <초대코드>`로 실제 API를 두 사용자로 불러 확인한다.
"""

from sqlalchemy.orm import Query, Session

from app.config import settings
from app.models.book import Book
from app.models.user import User


def owner_id_for(user: User) -> int | None:
    """이 사용자의 데이터를 가르는 값. family 모드에서는 None(= 가르지 않는다)."""
    return user.id if settings.personal_mode else None


def scope(query: Query, user: User, column=Book.owner_id) -> Query:
    """이미 만든 쿼리를 이 사용자 몫으로 좁힌다. family 모드에서는 그대로 돌려준다."""
    owner = owner_id_for(user)
    return query if owner is None else query.filter(column == owner)


def books(db: Session, user: User, *entities) -> Query:
    """`db.query(Book)`(또는 `db.query(Book.id, …)`) 대신 쓴다."""
    return scope(db.query(*(entities or (Book,))), user)
