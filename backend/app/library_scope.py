"""누구의 책을 볼 것인가, 무엇을 할 수 있는가 — 운영 형태(family / personal)에 따라 한 곳에서 정한다.

**family**(가족 공용 서버): 모든 계정이 같은 서재를 본다. 여기 함수들은 아무것도 거르지 않고 권한도 막지 않는다
→ 이 파일이 생기기 전과 **동작이 똑같다.**

**personal**(개인 서재 서버, 예: homelibrary.kr): 사람마다 **도서관**에 속하고(0010), 같은 도서관의 멤버끼리 책을
함께 본다. 책을 읽는 **모든** 쿼리가 `books()`나 `scope()`를 거쳐야 한다. 하나라도 `db.query(Book)`을 그대로 쓰면
다른 도서관의 책이 보이거나 — 더 나쁘게는 번호(`/api/books/123`)만 바꿔 남의 책을 고치거나 지울 수 있다.

권한(personal 모드): 주인(owner)·공동 관리자(manager)는 멤버 관리, 편집(editor)까지는 책 편집, 보기만(viewer)은 읽기만.

⚠️ 새 엔드포인트를 만들 때 `db.query(Book…)`를 직접 쓰지 말 것. 책을 바꾸는 엔드포인트는 `ensure_can_edit()`.
   고친 뒤에는 `python3 tools/check_isolation.py <주소> <초대코드>`로 실제 API를 여러 사용자로 불러 확인한다.
"""

from fastapi import HTTPException, status
from sqlalchemy.orm import Query, Session

from app.config import settings
from app.models.book import Book
from app.models.library import CAN_EDIT, CAN_MANAGE
from app.models.user import User


def library_id_for(user: User) -> int | None:
    """이 사용자의 데이터를 가르는 값(도서관 id). family 모드에서는 None(= 가르지 않는다).

    personal 모드인데 도서관이 없는 계정(있어서는 안 된다)은 -1로 — 아무것도 보이지 않게 한다.
    """
    if not settings.personal_mode:
        return None
    return user.library_id if user.library_id is not None else -1


def scope(query: Query, user: User, column=Book.library_id) -> Query:
    """이미 만든 쿼리를 이 사용자의 도서관 몫으로 좁힌다. family 모드에서는 그대로 돌려준다."""
    lib = library_id_for(user)
    return query if lib is None else query.filter(column == lib)


def books(db: Session, user: User, *entities) -> Query:
    """`db.query(Book)`(또는 `db.query(Book.id, …)`) 대신 쓴다."""
    return scope(db.query(*(entities or (Book,))), user)


def can_edit(user: User) -> bool:
    return (not settings.personal_mode) or user.library_role in CAN_EDIT


def can_manage(user: User) -> bool:
    return settings.personal_mode and user.library_role in CAN_MANAGE


def ensure_can_edit(user: User) -> None:
    """책을 넣거나 고치거나 지우는 엔드포인트 맨 앞에서 부른다. '보기만' 멤버는 403."""
    if not can_edit(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="이 도서관에서 '보기만' 권한입니다. 책을 넣거나 고치려면 도서관 주인에게 권한을 요청하세요.",
        )


def ensure_can_manage(user: User) -> None:
    if not settings.personal_mode:
        raise HTTPException(status_code=404, detail="이 서버에는 도서관 멤버 관리가 없습니다.")
    if not can_manage(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="도서관 주인이나 공동 관리자만 할 수 있습니다.")
