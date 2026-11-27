import logging
from collections import Counter
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import and_, asc, case, desc, func, or_
from sqlalchemy.orm import Session

from app import library_scope
from app.auth.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models.book import Book
from app.models.duplicate_ack import DuplicateAcknowledgement
from app.models.user import User
from app.schemas.book import (
    BookListResponse,
    BookMetadata,
    BookOut,
    BulkDeleteRequest,
    BulkShelfRequest,
    BulkUpdateResult,
    CategoryCount,
    CategoryRenameRequest,
    CoverCandidate,
    CoverCandidateList,
    CoverRepairResult,
    DuplicateAckRequest,
    DuplicateAckResult,
    DuplicateCheckResult,
    DuplicateGroup,
    DuplicateGroupList,
    ImageSweepResult,
    IsbnLookup,
    ShelfCount,
    UnusedImageReport,
)
from app.services import (
    booklookup_service,
    category_service,
    maintenance_service,
    translit_service,
)
from app.services.image_service import (
    UnsupportedImageError,
    delete_image,
    image_exists,
    is_probably_cover,
    is_temp_image_path,
    promote_temp_image,
    purge_old_temp_images,
    sanitize_image_path,
    save_image_bytes,
    save_temp_image_bytes,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/books", tags=["books"])

SORTABLE_FIELDS = {
    "title": Book.title,
    "author": Book.author,
    "publisher": Book.publisher,
    "pub_year": Book.pub_year,
    "category": Book.category,  # 실제로는 _sort_column()이 '첫 키워드'로 바꿔 준다
    "shelf_location": Book.shelf_location,
    "created_at": Book.created_at,
}


def _first_category_column(db: Session):
    """카테고리 문자열에서 **첫 키워드만** 뽑아내는 SQL 식.

    카테고리가 `"소설, 프랑스"`가 될 수 있으므로 문자열 전체로 정렬하면 두 번째 키워드가
    순서에 끼어든다. 사용자가 기대하는 건 첫 번째 것 기준 정렬이다.
    운영은 Postgres, 테스트는 SQLite라 양쪽 식을 모두 둔다.
    """
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        return func.trim(func.split_part(Book.category, ",", 1))
    # SQLite: 첫 콤마 앞까지. 콤마가 없으면(instr=0 → -1 → NULL) 문자열 전체 길이를 쓴다.
    comma = func.instr(Book.category, ",")
    cut = func.coalesce(func.nullif(comma - 1, -1), func.length(Book.category))
    return func.trim(func.substr(Book.category, 1, cut))


def _sort_column(sort_by: str, db: Session):
    if sort_by == "category":
        return _first_category_column(db)
    return SORTABLE_FIELDS.get(sort_by, Book.created_at)


@router.get("", response_model=BookListResponse)
def list_books(
    sort_by: str = "created_at",
    order: Literal["asc", "desc"] = "desc",
    title: str | None = None,
    author: str | None = None,
    publisher: str | None = None,
    category: str | None = None,
    shelf: list[str] | None = Query(None),
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = library_scope.books(db, current_user)

    # 책꽂이는 **여러 곳을 한꺼번에** 고를 수 있다(`?shelf=서재&shelf=사무실`). 값이 여럿이면
    # OR로 묶는다 — "이 두 칸 중 어디엔가 있는 책"을 보려는 것이지 교집합이 아니다.
    #
    # ⚠️ **빈 문자열 하나가 "미지정"을 뜻한다**(`?shelf=`). 책꽂이가 비어 있는 책은
    #    `IS NULL`이라 이름으로는 절대 걸리지 않으므로 따로 표현할 길이 필요했다.
    #    별도 파라미터(`include_unset` 같은 것)를 두지 않은 이유는, 화면에서 "미지정"도
    #    다른 책꽂이와 **똑같은 칩 하나**로 다루기 때문이다.
    if shelf:
        wants_unset = any(v.strip() == "" for v in shelf)
        names = [v for v in shelf if v.strip() != ""]
        conds = []
        if names:
            conds.append(Book.shelf_location.in_(names))
        if wants_unset:
            conds.append(or_(Book.shelf_location.is_(None), func.btrim(Book.shelf_location) == ""))
        if conds:
            query = query.filter(or_(*conds))

    # 필터 칸도 띄어쓰기를 무시한다("작은정원"으로 "작은 정원"를 거를 수 있게).
    # 칸 하나가 컬럼 하나만 보므로 통합검색처럼 조건을 따로 OR로 더할 필요가 없다 —
    # 양쪽에서 공백을 지운 비교는 원래 비교의 **상위집합**이다(원래 걸리던 건 그대로 걸린다).
    for column, value in (
        (Book.title, title),
        (Book.author, author),
        (Book.publisher, publisher),
        (Book.category, category),
    ):
        if not value:
            continue
        term = _loose_term(value)
        if not term:
            continue  # 공백만 넣은 경우 — 거르지 않는다
        query = query.filter(_loose_column(column).ilike(f"%{term}%"))

    total = query.count()

    column = _sort_column(sort_by, db)
    # 같은 값이 여러 권일 때 순서가 매번 달라지면 페이지를 넘길 때 책이 빠지거나 겹친다.
    # 카테고리 정렬은 첫 키워드만 보므로 동점이 특히 많아 tie-break가 꼭 필요하다.
    query = query.order_by(asc(column) if order == "asc" else desc(column), Book.id.asc())

    items = query.offset(skip).limit(limit).all()
    return BookListResponse(items=items, total=total)


# 통합검색이 훑는 컬럼들 (alembic 0004의 TRGM_COLUMNS와 같은 목록)
SEARCH_COLUMNS = [Book.title, Book.author, Book.publisher, Book.translator, Book.isbn]


def _loose_column(column):
    """비교용으로 다듬은 컬럼 식. **공백을 없애고, ISBN은 하이픈도 없앤다.**

    한글은 띄어쓰기가 사람마다 다르고("살 때"/"살때"), ISBN은 같은 번호를 하이픈을 넣어
    적기도 빼고 적기도 한다("978-89-...". "97889..."). 양쪽을 같은 모양으로 만들어 비교한다.
    """
    expr = func.replace(column, " ", "")
    if column.key == "isbn":
        expr = func.replace(expr, "-", "")
    return expr


def _loose_term(value: str, *, isbn: bool = False) -> str:
    """검색어도 컬럼과 **같은 규칙으로** 다듬는다. 양쪽을 똑같이 만들지 않으면 소용이 없다."""
    collapsed = "".join(value.split())
    return collapsed.replace("-", "") if isbn else collapsed


def _keyword_conditions(q: str) -> list:
    """검색어를 공백으로 나눠, 각 토큰이 어느 필드에든 걸리는 조건 목록을 만든다.

    호출부에서 **AND**로 묶어 쓴다(토큰마다 필드 OR, 토큰 사이는 AND).
    검색어 전체를 한 덩어리 LIKE로 찾으면 "홍길동 여행"처럼 저자와 제목이 섞인 검색어가 아무것도
    못 찾는다. 토큰별 AND로 바꾸면 토큰들이 서로 다른 필드에 걸려도 찾아지고, 토큰이 늘어날수록
    결과가 좁아져 원하는 책에 빨리 도달한다.
    """
    conditions = []
    for token in q.split():
        like = f"%{token}%"
        conditions.append(or_(*[column.ilike(like) for column in SEARCH_COLUMNS]))
    return conditions


def _spaceless_condition(q: str):
    """**띄어쓰기를 모두 지우고** 통째로 비교하는 조건. 없으면 None.

    한글은 띄어쓰기가 사람마다 달라서("살 때" / "살때") 그대로 두면 한쪽이 안 찾힌다.
    토큰 AND만으로는 **한쪽 방향만** 해결된다:

    - "살 때"로 찾기 → 토큰 "살"과 "때"가 둘 다 "살때" 안에 있으므로 **이미 찾혔다**
    - "살때"로 찾기 → "살 때"에는 "살때"라는 연속된 글자가 없어 **못 찾았다** ← 이걸 고친다

    그래서 토큰 조건을 **대체하지 않고 OR로 더한다**. 대체하면 "홍길동 여행"처럼
    저자와 제목에 나뉘어 걸리는 검색어가 도리어 안 찾힌다(위 함수의 설명 참고).

    ISBN은 여기서 **하이픈까지** 무시된다 — `978-89-...`와 `97889...`는 같은 번호다.

    `replace(컬럼, ' ', '')`는 인덱스를 못 타지만(0004의 trgm 인덱스 포함), 장서가
    수천 권 수준이라 전부 훑어도 체감되지 않는다. 느려지면 그때 별도 컬럼을 두면 된다.
    """
    parts = []
    for column in SEARCH_COLUMNS:
        term = _loose_term(q, isbn=column.key == "isbn")
        if not term:
            continue  # 예: 하이픈만 입력하면 ISBN 쪽은 빈 문자열이 되어 아무 의미가 없다
        parts.append(_loose_column(column).ilike(f"%{term}%"))
    return or_(*parts) if parts else None


@router.get("/search", response_model=BookListResponse)
def search_books(
    q: str,
    sort_by: str = "title",
    order: Literal["asc", "desc"] = "asc",
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """제목·저자·출판사·번역자·ISBN 통합검색.

    **글자로 찾은 결과**와 **소리로 찾은 저자**를 합치되, 순서를 나눠 준다.

    1. 검색어를 **통째로**(띄어쓰기만 무시) 찾는다. `"살 때"`는 `"살때"`가 이어져 있는 책만.
    2. 그렇게 해서 **한 권도 없을 때만** 단어를 나눠(토큰 AND) 다시 찾고 `relaxed=True`.
    3. 검색어에 로마자가 있으면 **저자 이름을 소리로도** 맞춰 **덧붙인다**
       (`Robert` → `로버트`). 위에서 찾은 것이 있어도 덧붙인다. `sounds_like=True`.

    **왜 1·2단계를 나누는가**: 예전에는 늘 단어를 나눠 찾아서, `"살 때"`로 검색하면
    '살'과 '때'가 **따로 떨어져 있는** 책까지 걸렸다. 그렇다고 나누는 기능을 없앨 수도 없다 —
    `"홍길동 여행"`처럼 저자와 제목에 나뉘어 걸리는 검색은 나눠야만 된다.

    **왜 3단계는 "없을 때만"이 아닌가**: 처음엔 그렇게 만들었는데 `Robert`가
    `로버트`를 못 찾았다. 서재에 `Robert Smith`처럼 **로마자로 적힌 저자가 두 명 있어서**
    1단계가 성공해 버리고 3단계까지 가지 않았던 것이다. 한 책은 로마자로, 다른 책은 한글로
    적혀 있는 것이 정상이므로 **항상 합쳐서** 보여주고, 글자로 찾은 것을 앞에 둔다.

    전체 건수(`total`)를 함께 돌려준다 — 예전에는 100건에서 말없이 잘려서, 실제로는 더 많은데도
    "검색결과 100건"으로 보였다. 이제 프론트가 페이지네이션으로 전부 훑을 수 있다.
    """
    conditions = _keyword_conditions(q)
    phrase = _spaceless_condition(q)
    if not conditions or phrase is None:
        return BookListResponse(items=[], total=0)

    # 1단계: 검색어를 **통째로**(띄어쓰기만 무시하고) 찾는다.
    literal_ids = [row[0] for row in library_scope.books(db, current_user, Book.id).filter(phrase).all()]
    relaxed = False

    # 2단계: 통째로는 하나도 없을 때만 단어를 나눠 다시 찾는다.
    if not literal_ids and len(conditions) > 1:
        literal_ids = [
            row[0]
            for row in library_scope.books(db, current_user, Book.id).filter(and_(*conditions)).all()
        ]
        relaxed = bool(literal_ids)

    # 3단계: 로마자가 섞인 검색어면 저자 이름을 소리로도 맞춰 **덧붙인다**.
    exact_ids: list[int] = []
    near_ids: list[int] = []
    if any(c.isascii() and c.isalpha() for c in q):
        exact_ids, near_ids = _sounding_like(db, current_user, q)

    # 우선순위대로 합친다: 글자로 찾은 것 → 소리가 정확히 같은 것 → 소리가 비슷한 것.
    # 찾던 책이 뒤쪽 페이지에 묻히면 기능이 있으나 마나다.
    tier_of: dict[int, int] = {}
    for tier, ids in enumerate((literal_ids, exact_ids, near_ids)):
        for book_id in ids:
            tier_of.setdefault(book_id, tier)
    if not tier_of:
        return BookListResponse(items=[], total=0)

    sounds_like = any(tier > 0 for tier in tier_of.values())
    query = library_scope.books(db, current_user).filter(Book.id.in_(list(tier_of)))
    total = query.count()

    column = _first_category_column(db) if sort_by == "category" else SORTABLE_FIELDS.get(
        sort_by, Book.title
    )
    ordering = [asc(column) if order == "asc" else desc(column), Book.id.asc()]
    if sounds_like and literal_ids:
        # 글자로 찾은 것과 소리로 찾은 것이 섞였을 때만 등급을 나눈다.
        # (소리로만 찾은 경우에도 '정확히 같은 것'을 앞에 둔다)
        ordering.insert(0, case((Book.id.in_(literal_ids), 0), else_=1))
    if exact_ids and near_ids:
        ordering.insert(
            1 if (sounds_like and literal_ids) else 0,
            case((Book.id.in_(exact_ids), 0), else_=1),
        )
    query = query.order_by(*ordering)

    items = query.offset(skip).limit(limit).all()
    return BookListResponse(
        items=items, total=total, relaxed=relaxed, sounds_like=sounds_like
    )


def _sounding_like(db: Session, user: User, q: str) -> tuple[list[int], list[int]]:
    """**저자 이름 또는 제목**이 검색어와 같은 소리인 책의 id들.
    `(확실한 것, 비슷한 것)`으로 나눠 준다.

    비교 규칙은 `services/translit_service.py`에 있다. SQL로는 표현할 수 없어
    (자모를 뜯어 자음 뼈대를 만들어야 한다) 값을 읽어와 파이썬에서 고른다.
    수천 권까지는 다 훑어도 체감되지 않는다.

    **제목까지 보는 이유**: 이름이 저자가 아니라 제목에만 들어 있는 책이 있다 —
    `아인슈타인 씨의 이상한 하루`의 저자는 홍길동다. 대신 제목은 낱말이 많아
    잡음이 쉽게 늘므로 뼈대 길이 기준을 저자보다 높게 잡는다(translit_service.TITLE_MIN_KEY).
    """
    rows = library_scope.books(db, user, Book.id, Book.author, Book.title).all()
    exact: list[int] = []
    near: list[int] = []
    for book_id, author, title in rows:
        # 로마자로 적힌 저자는 글자 그대로 찾으면 된다(1·2단계에서 이미 걸렀다).
        # 여기서까지 소리로 맞추면 잡음만 는다.
        quality = (
            translit_service.match_quality(q, author)
            if translit_service.has_hangul(author)
            else None
        )
        if quality != translit_service.EXACT:
            title_quality = translit_service.title_match_quality(q, title)
            if title_quality is not None and (quality is None or title_quality < quality):
                quality = title_quality
        if quality == translit_service.EXACT:
            exact.append(book_id)
        elif quality is not None:
            near.append(book_id)
    return exact, near


# 주의: 이 라우트는 반드시 "/{book_id}"보다 **먼저** 선언돼야 한다.
# 그렇지 않으면 "cover-candidates"가 book_id로 해석돼 422가 난다.
@router.get("/cover-candidates", response_model=CoverCandidateList)
def cover_candidates(
    title: str = Query(..., description="표지를 찾을 책 제목"),
    author: str | None = Query(None),
    limit: int = Query(6, ge=1, le=8),
    current_user: User = Depends(get_current_user),
):
    """제목/저자로 인터넷에서 표지 이미지 후보를 찾아 내려받고, 미리보기용 임시 경로로 돌려준다.

    이미 등록된 책의 표지가 없거나 마음에 들지 않을 때 골라 바꾸기 위한 용도.
    책 ID가 아니라 제목/저자를 받는 이유: 수정 화면에서 사용자가 제목을 고쳐 넣은 직후에도
    (아직 저장 전이라도) 그 값으로 검색할 수 있어야 하기 때문.
    """
    title = title.strip()
    author = (author or "").strip()
    if not title and not author:
        return CoverCandidateList(candidates=[])

    # 이전에 검색만 하고 고르지 않은 후보 이미지 정리 (별도 스케줄러 없이 여기서 처리)
    purge_old_temp_images()

    found = booklookup_service.search_cover_candidates(title, author, limit=limit)

    # 가장 관련도 높은 결과(첫 후보)의 서지 정보를 함께 돌려준다 — 프론트가 폼의 빈 칸을 채운다.
    # 첫 후보만 쓰는 이유: 여러 후보를 섞으면 다른 판(edition)의 정보가 뒤섞일 수 있어서.
    metadata = None
    if found:
        top = found[0]
        metadata = BookMetadata(
            title=top.get("title"),
            author=top.get("author"),
            translator=top.get("translator"),
            publisher=top.get("publisher"),
            pub_year=top.get("pub_year"),
            category=top.get("category"),
            isbn=top.get("isbn"),
        )

    candidates: list[CoverCandidate] = []
    for item in found:
        image_bytes = booklookup_service.download_first_available(
            item.get("cover_urls") or [], validator=is_probably_cover
        )
        if not image_bytes:
            logger.warning("표지 후보 내려받기 실패: %s", item.get("cover_urls"))
            continue
        try:
            image_path = save_temp_image_bytes(image_bytes)
        except UnsupportedImageError:
            logger.warning("표지 후보 이미지를 읽을 수 없음: %s", item.get("cover_url"))
            continue
        candidates.append(
            CoverCandidate(
                image_path=image_path,
                source=item.get("source"),
                title=item.get("title"),
                author=item.get("author"),
                translator=item.get("translator"),
                publisher=item.get("publisher"),
                pub_year=item.get("pub_year"),
                category=item.get("category"),
                isbn=item.get("isbn"),
            )
        )

    return CoverCandidateList(candidates=candidates, metadata=metadata)


# 주의: 이 라우트도 "/{book_id}"보다 **먼저** 선언돼야 한다(안 그러면 book_id로 해석돼 422).
@router.get("/lookup-isbn", response_model=IsbnLookup)
def lookup_isbn(
    isbn: str = Query(..., description="조회할 책의 ISBN(10 또는 13자리)"),
    current_user: User = Depends(get_current_user),
):
    """ISBN으로 책 정보와 표지를 조회한다. 새책 추가 시 ISBN만 입력하면 나머지를 채우는 용도."""
    normalized = booklookup_service.normalize_isbn(isbn)
    if not booklookup_service.is_valid_isbn(normalized):
        raise HTTPException(status_code=400, detail="올바른 ISBN이 아닙니다. 번호를 다시 확인해주세요.")

    purge_old_temp_images()  # 고르지 않고 쌓인 임시 표지 정리

    result = booklookup_service.lookup_by_isbn(normalized)
    if not result:
        return IsbnLookup(found=False)

    image_path = None
    image_bytes = booklookup_service.download_first_available(
        booklookup_service.all_cover_urls(result), validator=is_probably_cover
    )
    if image_bytes:
        try:
            image_path = save_temp_image_bytes(image_bytes)
        except UnsupportedImageError:
            image_path = None

    return IsbnLookup(
        found=True,
        title=result.get("title"),
        author=result.get("author"),
        translator=result.get("translator"),
        publisher=result.get("publisher"),
        pub_year=result.get("pub_year"),
        category=result.get("category"),
        isbn=result.get("isbn") or (normalized if len(normalized) == 13 else None),
        cover_image_path=image_path,
    )


# 주의: 이 라우트도 "/{book_id}"보다 **먼저** 선언돼야 한다(안 그러면 book_id로 해석돼 422).
@router.get("/check-duplicate", response_model=DuplicateCheckResult)
def check_duplicate(
    isbn: str | None = Query(None, description="확인할 ISBN(10 또는 13자리)"),
    title: str | None = Query(None, description="확인할 제목"),
    author: str | None = Query(None, description="제목이 같은 책이 여러 권일 때 같은 저자를 위로 올리는 용도"),
    exclude_id: int | None = Query(None, description="수정 중인 책 자신은 중복에서 제외"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """이미 등록된 같은 책이 있는지 확인한다. 이 앱을 만든 이유가 중복 구매 방지이므로,
    등록 단계에서 "집에 이미 있다"를 알려주는 것이 핵심 기능이다.

    ISBN은 10↔13 표현이 달라도 같은 책으로 잡고, 제목은 공백/대소문자 차이를 무시해 대조한다
    (같은 책을 "홍길동전"과 "홍길동 전"으로 넣어둔 경우를 놓치지 않기 위해).
    """

    def base_query():
        query = library_scope.books(db, current_user)
        if exclude_id is not None:
            query = query.filter(Book.id != exclude_id)
        return query

    isbn_matches: list[Book] = []
    forms = booklookup_service.isbn_equivalents(isbn)
    if forms:
        # 저장된 ISBN에 하이픈/공백이 섞여 있을 수 있어 DB 쪽에서도 벗겨내고 비교한다
        stored = func.replace(func.replace(func.upper(Book.isbn), "-", ""), " ", "")
        isbn_matches = base_query().filter(stored.in_(sorted(forms))).order_by(Book.title.asc()).all()

    title_matches: list[Book] = []
    normalized_title = "".join((title or "").split()).lower()
    if normalized_title:
        stored_title = func.lower(func.replace(Book.title, " ", ""))
        query = base_query().filter(stored_title == normalized_title)
        if isbn_matches:
            # ISBN으로 이미 잡힌 책은 확실한 중복 쪽에만 두고 여기선 뺀다(같은 책이 두 번 보이지 않게)
            query = query.filter(Book.id.notin_([b.id for b in isbn_matches]))
        title_matches = query.order_by(Book.title.asc()).limit(20).all()
        # 같은 제목이 여러 권이면 저자까지 같은 책을 먼저 보여준다(동명이서 구분에 도움)
        normalized_author = "".join((author or "").split()).lower()
        if normalized_author:
            title_matches.sort(
                key=lambda b: "".join((b.author or "").split()).lower() != normalized_author
            )

    # 사용자가 "다른 책"이라고 확인해 둔 묶음은 경고하지 않는다.
    # 서재 점검에서만 빼고 등록 경고는 그대로 두면, 같은 책을 한 권 더 살 때마다 또 물어보게 된다
    # (집에 일부러 여러 권 두는 책이 있으므로 그게 맞지 않다).
    acknowledged = _acknowledged_keys(db, current_user)
    if isbn_matches:
        key = _isbn_group_key(isbn_matches[0].isbn)
        if key and ("isbn", key) in acknowledged:
            isbn_matches = []
    if title_matches:
        key = _normalized_title_key(title)
        if key and ("title", key) in acknowledged:
            title_matches = []

    return DuplicateCheckResult(isbn_matches=isbn_matches, title_matches=title_matches)


def _normalized_title_key(title: str | None) -> str:
    """제목을 비교용으로 정규화 — 공백 제거 + 소문자.
    "홍길동전"과 "홍길동 전"을 같은 책으로 보기 위한 것으로, check-duplicate와 같은 규칙이다."""
    return "".join((title or "").split()).lower()


def _acknowledged_keys(db: Session, user: User) -> set[tuple[str, str]]:
    """사용자가 "다른 책"이라고 확인해 둔 묶음들 {(reason, key)}.

    이게 있어야 **일부러 여러 권 두는 책**이나 제목만 같은 다른 책을 매번 중복으로
    띄우지 않는다. 경고가 자주 틀리면 사람은 경고를 안 보게 된다.
    """
    rows = library_scope.scope(
        db.query(DuplicateAcknowledgement.reason, DuplicateAcknowledgement.key),
        user,
        DuplicateAcknowledgement.library_id,
    ).all()
    return {(r[0], r[1]) for r in rows}


def _isbn_group_key(isbn: str | None) -> str | None:
    """ISBN을 묶음 기준값으로 정규화한다. 10자리로 저장된 책과 13자리로 저장된 책이
    같은 묶음에 들어가도록, 동등 표현 중 **가장 긴 것(=13자리)** 을 대표값으로 삼는다."""
    forms = booklookup_service.isbn_equivalents(isbn)
    return max(forms, key=len) if forms else None


# 주의: 이 라우트도 "/{book_id}"보다 **먼저** 선언돼야 한다(안 그러면 book_id로 해석돼 422).
@router.get("/duplicates", response_model=DuplicateGroupList)
def list_duplicates(
    include_acknowledged: bool = Query(
        False, description="'다른 책'으로 표시해 둔 묶음까지 함께 보기"
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """**이미 등록된** 중복 책을 찾아 묶음으로 돌려준다.

    등록 단계에서 막아주는 check-duplicate와 목적이 다르다 — 그 기능이 생기기 전에 이미
    들어간 중복(실서버에서 같은 책 3권 등)을 사후에 찾아 정리하기 위한 것.

    전체를 파이썬에서 묶는 이유: ISBN 10↔13 동등성 판단을 SQL로 표현하면 복잡해지는데,
    개인 도서관 규모(수천 권)에서는 전량을 한 번 읽어 묶는 편이 단순하고 충분히 빠르다.
    """
    books = library_scope.books(db, current_user).order_by(Book.id).all()

    isbn_groups: dict[str, list[Book]] = {}
    title_groups: dict[str, list[Book]] = {}
    for book in books:
        key = _isbn_group_key(book.isbn)
        if key:
            isbn_groups.setdefault(key, []).append(book)
        title_key = _normalized_title_key(book.title)
        if title_key:
            title_groups.setdefault(title_key, []).append(book)

    groups: list[DuplicateGroup] = []
    isbn_id_sets: list[set[int]] = []
    for key, items in isbn_groups.items():
        if len(items) < 2:
            continue
        isbn_id_sets.append({b.id for b in items})
        groups.append(DuplicateGroup(reason="isbn", key=key, books=items))

    for key, items in title_groups.items():
        if len(items) < 2:
            continue
        ids = {b.id for b in items}
        # ISBN 묶음이 이미 같은 책들을 담고 있다면 같은 내용을 두 번 보여주지 않는다
        if any(ids <= isbn_ids for isbn_ids in isbn_id_sets):
            continue
        groups.append(DuplicateGroup(reason="title", key=key, books=items))

    # 사용자가 "다른 책"이라고 확인해 둔 묶음은 빼고 보여준다.
    # (집에 일부러 여러 권 두는 책, 제목만 같은 다른 책 — 매번 띄우면 경고가 무의미해진다)
    acknowledged = _acknowledged_keys(db, current_user)
    acknowledged_count = sum(1 for g in groups if (g.reason, g.key) in acknowledged)
    if not include_acknowledged:
        groups = [g for g in groups if (g.reason, g.key) not in acknowledged]

    # 확실한 중복(ISBN)을 위로, 그다음 권수가 많은 순 — 정리 효과가 큰 것부터 보이게
    groups.sort(key=lambda g: (g.reason != "isbn", -len(g.books), g.books[0].title))
    redundant = sum(len(g.books) - 1 for g in groups)
    return DuplicateGroupList(
        groups=groups, redundant_count=redundant, acknowledged_count=acknowledged_count
    )


def _save_acknowledgements(db: Session, user: User, pairs: list[tuple[str, str]]) -> int:
    """(reason, key) 묶음들을 '다른 책'으로 표시한다. 이미 표시된 것은 건너뛴다."""
    existing = _acknowledged_keys(db, user)
    lib = library_scope.library_id_for(user)
    added = 0
    for reason, key in pairs:
        if (reason, key) in existing:
            continue
        db.add(DuplicateAcknowledgement(reason=reason, key=key, owner_id=user.id, library_id=lib))
        existing.add((reason, key))
        added += 1
    if added:
        db.commit()
    return added


# 주의: 이 라우트도 "/{book_id}"보다 **먼저** 선언돼야 한다.
@router.post("/duplicates/acknowledge", response_model=DuplicateAckResult)
def acknowledge_duplicate(
    payload: DuplicateAckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """이 묶음은 중복이 아니라고 표시한다. 앞으로 서재 점검과 등록 경고에서 제외된다."""
    library_scope.ensure_can_edit(current_user)
    added = _save_acknowledgements(db, current_user, [(payload.reason, payload.key)])
    return DuplicateAckResult(acknowledged=added)


# 주의: 이 라우트도 "/{book_id}"보다 **먼저** 선언돼야 한다.
@router.post("/duplicates/acknowledge-all", response_model=DuplicateAckResult)
def acknowledge_all_duplicates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """지금 중복으로 잡힌 묶음을 **전부** '다른 책'으로 표시한다.

    집에 원래 같은 책이 여러 권 있는 경우, 한 묶음씩 누르는 것보다 이게 편하다.
    되돌리려면 [다시 보기]에서 묶음별로 해제하면 된다.
    """
    library_scope.ensure_can_edit(current_user)
    current = list_duplicates(include_acknowledged=False, db=db, current_user=current_user)
    added = _save_acknowledgements(db, current_user, [(g.reason, g.key) for g in current.groups])
    return DuplicateAckResult(acknowledged=added)


# 주의: 이 라우트도 "/{book_id}"보다 **먼저** 선언돼야 한다.
@router.post("/duplicates/unacknowledge", response_model=DuplicateAckResult)
def unacknowledge_duplicate(
    payload: DuplicateAckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """'다른 책' 표시를 되돌려 다시 중복 검사 대상으로 만든다."""
    library_scope.ensure_can_edit(current_user)
    removed = (
        library_scope.scope(
            db.query(DuplicateAcknowledgement), current_user, DuplicateAcknowledgement.library_id
        )
        .filter(
            DuplicateAcknowledgement.reason == payload.reason,
            DuplicateAcknowledgement.key == payload.key,
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return DuplicateAckResult(acknowledged=-removed)


# 주의: 이 라우트도 "/{book_id}"보다 **먼저** 선언돼야 한다.
@router.get("/broken-covers", response_model=BookListResponse)
def list_broken_covers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """DB에는 표지 경로가 있는데 **파일이 실제로 없는** 책을 찾는다.
    화면에는 깨진 이미지로 보이므로 사용자가 원인을 알기 어렵다."""
    books = (
        library_scope.books(db, current_user)
        .filter(Book.cover_image_path.isnot(None))
        # 같은 제목(같은 책 여러 권)끼리 순서가 매번 달라지지 않게 id로 한 번 더 정렬
        .order_by(Book.title.asc(), Book.id.asc())
        .all()
    )
    missing = [b for b in books if not image_exists(b.cover_image_path)]
    return BookListResponse(items=missing, total=len(missing))


# 주의: 이 라우트도 "/{book_id}"보다 **먼저** 선언돼야 한다.
@router.post("/repair-covers", response_model=CoverRepairResult)
def repair_broken_covers(
    limit: int = Query(50, ge=1, le=200, description="한 번에 복구할 최대 권수"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """표지 파일이 사라진 책을 고친다: 인터넷에서 표지를 다시 찾아 붙이고,
    못 찾으면 경로를 지워 '표지 없음'으로 정상화한다(깨진 이미지가 뜨지 않도록).

    한 권마다 외부 API를 호출하므로 `limit`으로 한 번의 요청 시간을 제한한다.
    """
    library_scope.ensure_can_edit(current_user)
    books = library_scope.books(db, current_user).filter(Book.cover_image_path.isnot(None)).all()
    broken = [b for b in books if not image_exists(b.cover_image_path)][:limit]

    refetched = 0
    cleared = 0
    for book in broken:
        found = None
        try:
            found = _auto_cover_lookup(book.title, book.author)
        except Exception:  # 외부 API 실패가 나머지 책 복구를 막지 않도록
            logger.warning("표지 재조회 실패: id=%s %s", book.id, book.title)
        if found:
            book.cover_image_path = found
            refetched += 1
        else:
            book.cover_image_path = None  # 깨진 경로를 남겨두면 계속 깨진 이미지가 보인다
            cleared += 1

    db.commit()
    return CoverRepairResult(checked=len(broken), refetched=refetched, cleared=cleared)


# 주의: 이 라우트도 "/{book_id}"보다 **먼저** 선언돼야 한다.
@router.get("/unused-images", response_model=UnusedImageReport)
def unused_images(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """어느 책도 쓰지 않는 표지 이미지 현황. 지우지 않고 보기만 한다.

    정리는 앱 시작 시 자동으로도 돌지만, **삭제는 되돌릴 수 없으므로** 화면에서 현황을
    확인할 수 있게 해 둔다(자동으로 뭐가 지워지고 있는지 사용자가 알 수 있어야 한다).
    """
    _require_admin_if_personal(current_user)
    return UnusedImageReport(**maintenance_service.unused_image_report(db))


# 주의: 이 라우트도 "/{book_id}"보다 **먼저** 선언돼야 한다.
@router.post("/purge-unused-images", response_model=ImageSweepResult)
def purge_unused_images(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """사용되지 않는 이미지를 지금 정리한다(앱 시작 시 자동 실행되는 것과 같은 작업)."""
    _require_admin_if_personal(current_user)
    return ImageSweepResult(**maintenance_service.sweep_unused_images(db))


# 주의: 이 라우트도 "/{book_id}"보다 **먼저** 선언돼야 한다.
# 주의: 이 라우트는 "/{book_id}"보다 **먼저** 선언돼야 한다. 뒤에 두면 `/api/books/shelves`가
# book_id="shelves"로 해석되어 422가 난다.
@router.get("/shelves", response_model=list[ShelfCount])
def list_shelves(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """책꽂이별 권수. 많은 순으로. 화면의 **책꽂이 다중 선택 필터**가 이 목록을 쓴다.

    카테고리와 달리 책꽂이는 한 권에 하나뿐이라 SQL의 GROUP BY로 바로 셀 수 있다.
    책꽂이가 비어 있는 책은 `name=None`으로 한 줄 넣는다 — 화면에서 "미지정"도 다른
    책꽂이와 똑같이 골라 거를 수 있어야 "아직 안 꽂은 책"을 찾아낼 수 있다.
    """
    rows = (
        library_scope.books(
            db,
            current_user,
            func.nullif(func.btrim(func.coalesce(Book.shelf_location, "")), "").label("name"),
            func.count(Book.id).label("count"),
        )
        .group_by("name")
        .all()
    )
    out = [ShelfCount(name=name, count=count) for name, count in rows]
    # 권수 많은 것부터. 미지정(None)은 이름이 없으므로 맨 뒤로 보낸다.
    out.sort(key=lambda r: (-r.count, r.name or "\uffff"))
    return out


@router.get("/categories", response_model=list[CategoryCount])
def list_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """카테고리별 권수. 많은 순으로.

    카테고리가 서점마다 제각각이라(알라딘의 '프랑스소설' vs Google Books의 'Fiction')
    수백 종으로 불어난다. 정리하려면 먼저 **무엇이 몇 권인지** 보여야 한다.
    """
    # 한 권에 `"소설, 프랑스"`처럼 여러 개가 들어 있으므로 SQL의 GROUP BY로는 셀 수 없다
    # ("소설, 프랑스"와 "소설, 고전"이 서로 다른 그룹이 되어 버린다). 키워드로 쪼개 센다.
    # 수백~수천 권이면 파이썬에서 세도 충분히 빠르고, DB 종류를 타지 않는다.
    counts: Counter[str] = Counter()
    blank = 0
    for (value,) in library_scope.books(db, current_user, Book.category).all():
        names = category_service.split_categories(value)
        if not names:
            blank += 1
            continue
        counts.update(names)

    rows: list[tuple[str | None, int]] = list(counts.items())
    if blank:
        rows.append((None, blank))  # 분류가 없는 책도 한 줄로 보여 한꺼번에 채울 수 있게
    rows.sort(key=lambda row: (-row[1], row[0] or ""))
    return [CategoryCount(name=name, count=count) for name, count in rows]


# 주의: 이 라우트도 "/{book_id}"보다 **먼저** 선언돼야 한다.
@router.post("/categories/rename", response_model=BulkUpdateResult)
def rename_category(
    payload: CategoryRenameRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """카테고리 이름을 바꾼다. 이미 있는 이름으로 바꾸면 자연스럽게 합쳐진다.

    한 권에 여러 키워드가 들어 있으므로 **그 키워드 하나만** 바꾸고 나머지는 남긴다
    (`"소설, 영미소설"`에서 영미소설→소설이면 `"소설"` 하나로 합쳐진다).
    그래서 SQL 한 방이 아니라 해당하는 책을 읽어 고쳐 쓴다.
    """
    library_scope.ensure_can_edit(current_user)
    to_name = category_service.normalize(payload.to_name)

    if payload.from_name is None:
        # 비어 있는 것끼리 묶어 한꺼번에 분류를 넣을 수 있게 한다
        books = (
            library_scope.books(db, current_user)
            .filter((Book.category.is_(None)) | (Book.category == ""))
            .all()
        )
        for book in books:
            book.category = to_name
        db.commit()
        return BulkUpdateResult(updated=len(books))

    # LIKE로 후보를 좁힌 뒤("역사소설"도 걸리지만) 키워드 단위로 정확히 다시 거른다
    candidates = (
        library_scope.books(db, current_user)
        .filter(Book.category.ilike(f"%{payload.from_name}%"))
        .all()
    )
    updated = 0
    for book in candidates:
        if not category_service.has_keyword(book.category, payload.from_name):
            continue
        book.category = category_service.replace_keyword(
            book.category, payload.from_name, to_name
        )
        updated += 1
    db.commit()
    return BulkUpdateResult(updated=updated)


# 주의: 이 라우트도 "/{book_id}"보다 **먼저** 선언돼야 한다.
@router.post("/bulk-shelf", response_model=BulkUpdateResult)
def bulk_set_shelf(
    payload: BulkShelfRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """고른 책들의 책꽂이 위치를 한꺼번에 지정한다.

    책장 앞에서 "이 칸에 있는 책들"을 골라 한 번에 넣는 용도. 한 권씩 열어 고치면
    845권을 도저히 채울 수 없다.
    """
    library_scope.ensure_can_edit(current_user)
    if not payload.ids:
        return BulkUpdateResult(updated=0)
    shelf = (payload.shelf_location or "").strip() or None
    updated = (
        library_scope.books(db, current_user)
        .filter(Book.id.in_(payload.ids))
        .update({Book.shelf_location: shelf}, synchronize_session=False)
    )
    db.commit()
    return BulkUpdateResult(updated=updated)


def _own_book_or_404(db: Session, user: User, book_id: int) -> Book:
    """번호로 책 한 권. personal 모드에서 **남의 책이면 없는 책과 똑같이 404** —
    403을 주면 "그 번호의 책이 있다"는 사실이 새어 나간다."""
    book = library_scope.books(db, user).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(status_code=404, detail="책을 찾을 수 없습니다.")
    return book


def _require_admin_if_personal(user: User) -> None:
    """표지 파일 정리는 **모든 사용자의 파일**을 보는 작업이라 personal 모드에서는 운영자만."""
    if settings.personal_mode and not user.is_admin:
        raise HTTPException(status_code=403, detail="관리자만 할 수 있는 작업입니다.")


@router.get("/{book_id}", response_model=BookOut)
def get_book(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _own_book_or_404(db, current_user, book_id)


def _normalized_isbn(raw: str | None) -> str | None:
    """ISBN은 **숫자만 남겨** 저장한다.

    하이픈 위치는 적는 사람마다 다르다(`978-89-8752-329-3` / `9788-98752-3293`).
    그대로 저장하면 같은 번호가 여러 모양으로 쌓인다. 실제 서재의 ISBN 603개는
    전부 숫자만이라(바코드·API로 들어와서) 손으로 넣은 것만 모양이 달라지는 셈이다.

    **ISBN 형태가 아니면 건드리지 않는다** — "미상-확인필요"처럼 사용자가 적어 둔 메모를
    숫자만 남기고 뭉개 버리면 안 된다.

    조회·중복확인·검색은 이미 각자 하이픈을 벗겨 비교하므로 지금 당장 깨지는 곳은 없다.
    저장 모양을 맞춰 두는 것은 **앞으로 ISBN을 쓰는 코드가 매번 정규화를 기억하지 않아도**
    되게 하려는 것이다.
    """
    if not raw:
        return raw
    normalized = booklookup_service.normalize_isbn(raw)
    return normalized if booklookup_service.is_valid_isbn(normalized) else raw


def _book_form_fields(
    title: str = Form(...),
    author: str = Form(...),
    publisher: str = Form(...),
    pub_year: int | None = Form(None),
    shelf_location: str | None = Form(None),
    category: str | None = Form(None),
    isbn: str | None = Form(None),
    translator: str | None = Form(None),
    original_publisher: str | None = Form(None),
    original_pub_year: int | None = Form(None),
    comment: str | None = Form(None),
) -> dict:
    return {
        "title": title,
        "author": author,
        "publisher": publisher,
        "pub_year": pub_year,
        "shelf_location": shelf_location,
        # 화면에서 콤마로 적어 넣으므로 공백·빈 조각·중복을 여기서 한 번에 정리한다.
        # 새책 추가와 수정이 모두 이 함수를 거친다.
        "category": category_service.normalize(category),
        "isbn": _normalized_isbn(isbn),
        "translator": translator,
        "original_publisher": original_publisher,
        "original_pub_year": original_pub_year,
        "comment": comment,
    }


def _save_cover_upload(cover_image: UploadFile) -> str:
    """업로드된 표지 이미지를 저장. HEIC 등도 JPEG로 변환되며, 읽을 수 없으면 400."""
    try:
        return save_image_bytes(cover_image.file.read())
    except UnsupportedImageError:
        raise HTTPException(
            status_code=400, detail="지원하지 않는 이미지 형식입니다. JPEG/PNG/HEIC 파일을 올려주세요."
        )


def _resolve_selected_cover_path(db: Session, user: User, raw_path: str | None) -> str | None:
    """클라이언트가 고른 표지 경로를 검증한다. 표지 검색으로 만든 임시 이미지(`tmp/...`)라면
    정식 저장소로 옮겨 영구 보관한다(옮기지 않으면 purge에 지워진다)."""
    if not raw_path:
        return None

    path = sanitize_image_path(raw_path)
    if not path:
        raise HTTPException(status_code=400, detail="잘못된 이미지 경로입니다.")

    if is_temp_image_path(path):
        promoted = promote_temp_image(path)
        if not promoted:
            raise HTTPException(
                status_code=400, detail="선택한 표지 이미지가 만료되었습니다. 표지를 다시 검색해주세요."
            )
        return promoted

    # 임시가 아닌 정식 경로는 **이미 내 책이 쓰고 있는 표지**일 때만 받는다.
    # 아무 파일명이나 받으면 남의 표지를 내 책에 붙일 수 있고, 내 책을 지울 때 그 파일이 함께 지워진다
    # (personal 모드에서 남의 표지를 지우는 길이 된다). 파일명이 uuid라 추측은 어렵지만 막아 둔다.
    owned = library_scope.books(db, user, Book.id).filter(Book.cover_image_path == path).first()
    if not owned:
        raise HTTPException(status_code=400, detail="잘못된 이미지 경로입니다.")
    return path


def _auto_cover_lookup(title: str, author: str) -> str | None:
    """제목/저자로 알라딘·Google Books에서 깨끗한 표지를 찾아 저장하고 파일명을 반환.
    못 찾으면 None (사용자가 직접 올린 이미지를 덮어쓰지 않기 위해, 이미 표지가 있는 경우엔 호출하지 않음)."""
    query = " ".join(part for part in [title, author] if part)
    if not query:
        return None
    looked_up = booklookup_service.lookup_book(query)
    if not looked_up or not looked_up.get("cover_url"):
        return None
    cover_bytes = booklookup_service.download_cover_image(looked_up["cover_url"])
    return save_image_bytes(cover_bytes) if cover_bytes else None


@router.post("", response_model=BookOut, status_code=201)
def create_book(
    fields: dict = Depends(_book_form_fields),
    cover_image: UploadFile | None = File(None),
    cover_image_path: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    library_scope.ensure_can_edit(current_user)
    # 파일이 직접 첨부되면 그것을 저장, 스캔/표지검색 단계에서 이미 저장된 경로(cover_image_path)가
    # 있으면 재사용, 둘 다 없으면(직접 입력으로 새책을 추가하는 경우) 인터넷에서 표지를 자동으로 찾아본다
    if cover_image is not None and cover_image.filename:
        cover_image_path = _save_cover_upload(cover_image)
    elif cover_image_path:
        cover_image_path = _resolve_selected_cover_path(db, current_user, cover_image_path)
    else:
        cover_image_path = _auto_cover_lookup(fields["title"], fields["author"])

    book = Book(
        owner_id=current_user.id,
        library_id=current_user.library_id,
        cover_image_path=cover_image_path,
        **fields,
    )
    db.add(book)
    db.commit()
    db.refresh(book)
    return book


@router.put("/{book_id}", response_model=BookOut)
def update_book(
    book_id: int,
    fields: dict = Depends(_book_form_fields),
    cover_image: UploadFile | None = File(None),
    cover_image_path: str | None = Form(None),
    remove_image: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    library_scope.ensure_can_edit(current_user)
    book = _own_book_or_404(db, current_user, book_id)

    for key, value in fields.items():
        setattr(book, key, value)

    if cover_image is not None and cover_image.filename:
        delete_image(book.cover_image_path)
        book.cover_image_path = _save_cover_upload(cover_image)
    elif remove_image:
        delete_image(book.cover_image_path)
        book.cover_image_path = None
    elif cover_image_path and cover_image_path != book.cover_image_path:
        # 표지 검색으로 고른 후보는 tmp/ 에 있으므로 여기서 정식 저장소로 옮겨진다.
        # 화면에서 표지를 그대로 둔 경우엔 기존 경로가 그대로 올라와 이 분기를 타지 않는다.
        previous_path = book.cover_image_path
        book.cover_image_path = _resolve_selected_cover_path(db, current_user, cover_image_path)
        delete_image(previous_path)  # 새 표지를 설정한 뒤에 지워야 중간에 실패해도 표지가 남는다
    elif not book.cover_image_path:
        # 표지가 아직 없는 책이라면, 내용을 수정하는 김에 인터넷에서 자동으로 찾아본다
        book.cover_image_path = _auto_cover_lookup(book.title, book.author)

    db.commit()
    db.refresh(book)
    return book


@router.delete("/bulk", status_code=204)
def bulk_delete_books(
    payload: BulkDeleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    library_scope.ensure_can_edit(current_user)
    books = library_scope.books(db, current_user).filter(Book.id.in_(payload.ids)).all()
    for book in books:
        delete_image(book.cover_image_path)
        db.delete(book)
    db.commit()


@router.delete("/{book_id}", status_code=204)
def delete_book(
    book_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    library_scope.ensure_can_edit(current_user)
    book = _own_book_or_404(db, current_user, book_id)
    delete_image(book.cover_image_path)
    db.delete(book)
    db.commit()
