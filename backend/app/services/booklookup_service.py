import re
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from app.config import settings

ALADIN_ENDPOINT = "https://www.aladin.co.kr/ttb/api/ItemSearch.aspx"
ALADIN_LOOKUP_ENDPOINT = "https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx"
GOOGLE_BOOKS_ENDPOINT = "https://www.googleapis.com/books/v1/volumes"
# 카카오(다음) 책 검색. 네이버 책 검색 API가 2026-07-31 종료되어 국내서 보강 소스로 이걸 쓴다.
KAKAO_BOOK_ENDPOINT = "https://dapi.kakao.com/v3/search/book"
# Google 프로그래머블 검색(이미지). 책 카탈로그에 표지가 없는 책(해외 원서 등)을 위한 웹 이미지 검색.
GOOGLE_CSE_ENDPOINT = "https://www.googleapis.com/customsearch/v1"

# 교보문고는 검색 API를 공개하지 않고 검색 결과 페이지도 JS로 그려서 파싱이 불가능하다.
# 다만 **ISBN13으로 표지 이미지 URL을 조립하는 것은 가능**하다(2026-08-18 실측: 확인한 5권 모두 200).
# 그래서 교보는 "검색 소스"가 아니라 "알라딘/구글이 찾아준 책의 다른 표지 버전"으로만 쓴다.
KYOBO_COVER_TEMPLATES = [
    "https://contents.kyobobook.co.kr/sih/fit-in/800x0/pdt/{isbn}.jpg",
    "https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/{isbn}.jpg",
]

# 표지 후보 검색의 1차/2차 통과 기준 (검색어 단어 중 결과 제목·저자에 들어있는 비율)
_STRICT_MATCH_RATIO = 0.5
_LOOSE_MATCH_RATIO = 0.01  # 사실상 "한 단어라도 겹치면"

_HANGUL_RE = re.compile(r"[가-힣]")
# 제목을 부제/원제 단위로 자르는 구분자. 붙여쓴 하이픈(예: "e-북")은 자르지 않도록 앞뒤 공백을 요구한다.
_TITLE_SPLIT_RE = re.compile(r"\s*[:：|/]\s*|\s+[-–—]\s+|[\[\]()（）]")


def _parse_aladin_author(raw: str | None) -> tuple[str | None, str | None]:
    """알라딘 author 필드 예: '홍길동 (지은이), 김철수 (옮긴이)' → (저자, 번역자)"""
    if not raw:
        return None, None
    authors: list[str] = []
    translators: list[str] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        name = re.sub(r"\(.*?\)", "", part).strip()
        if not name:
            continue
        if "옮긴이" in part or "옮김" in part or "역자" in part:
            translators.append(name)
        else:
            authors.append(name)
    return (", ".join(authors) or None, ", ".join(translators) or None)


def _year_from_date(date_str: str | None) -> int | None:
    if date_str and date_str[:4].isdigit():
        return int(date_str[:4])
    return None


def _tokens(text: str | None) -> set[str]:
    if not text:
        return set()
    return {t for t in re.sub(r"[^\w]+", " ", text.lower()).split() if len(t) > 1}


def _match_ratio(query: str, result: dict) -> float:
    """검색어 단어 중 몇 %가 결과의 제목/저자에 들어있는지. 1.0이면 검색어가 전부 들어있음.
    (통과/탈락 판정용 — 결과에 군더더기 단어가 많아도 검색어를 다 포함하면 1.0)"""
    query_tokens = _tokens(query)
    if not query_tokens:
        return 1.0
    result_tokens = _tokens(result.get("title")) | _tokens(result.get("author"))
    return len(query_tokens & result_tokens) / len(query_tokens)


def _closeness(query: str, result: dict) -> float:
    """검색어와 결과가 얼마나 '똑 닮았는지'(Jaccard). 정렬용.

    `_match_ratio`와 달리 **결과 쪽의 군더더기 단어도 벌점**을 준다. 그래서 정확히 같은 판
    ("Les formes élémentaires de la vie religieuse")이, 제목이 겹치지만 사실 다른 책
    ("...cent ans après", "...un siècle après")보다 위로 정렬된다."""
    query_tokens = _tokens(query)
    result_tokens = _tokens(result.get("title")) | _tokens(result.get("author"))
    if not query_tokens or not result_tokens:
        return 0.0
    union = query_tokens | result_tokens
    return len(query_tokens & result_tokens) / len(union)


def _looks_relevant(query: str, result: dict) -> bool:
    """알라딘 검색은 매우 느슨해서 전혀 무관한 결과도 곧잘 반환함.
    쿼리와 결과 제목/저자 사이에 최소한의 단어 겹침이 있는지 확인."""
    return _match_ratio(query, result) > 0


def _aladin_cover_urls(cover: str | None) -> list[str]:
    """알라딘 API는 `Cover=big`을 줘도 cover200(짧은 변 200px)을 돌려준다. 같은 경로의
    `cover500`이 2~5배 큰 원본이라 그쪽을 먼저 시도하고, 없는 책을 대비해 원래 URL을 남겨둔다."""
    if not cover:
        return []
    bigger = re.sub(r"/(coversum|cover|cover200)/", "/cover500/", cover)
    return [bigger, cover] if bigger != cover else [cover]


def _google_cover_urls(image_links: dict) -> list[str]:
    """구글 썸네일 URL은 `edge=curl`(책장 말림 효과)이 붙어 있고 zoom 단계에 따라 크기가 다르다.
    말림 효과를 뺀 zoom=0(원본에 가까움) → 원래 URL 순으로 시도한다."""
    cover = (
        image_links.get("extraLarge")
        or image_links.get("large")
        or image_links.get("medium")
        or image_links.get("thumbnail")
    )
    if not cover:
        return []
    cover = cover.replace("http://", "https://")
    plain = cover.replace("&edge=curl", "")
    urls = [plain.replace("zoom=1", "zoom=0"), plain, cover]
    return list(dict.fromkeys(urls))


def _kyobo_cover_urls(isbn: str | None) -> list[str]:
    # 교보문고는 국내 서점이라 한국 발행 도서(ISBN 978-89 / 979-11 접두)만 표지를 갖고 있다.
    # 해외 원서에까지 교보 URL을 만들면 매번 404를 받아 후보 슬롯만 낭비한다.
    if not isbn or not isbn.isdigit() or not (isbn.startswith("97889") or isbn.startswith("97911")):
        return []
    return [tpl.format(isbn=isbn) for tpl in KYOBO_COVER_TEMPLATES]


def _isbn13_to_10(isbn13: str | None) -> str | None:
    """978로 시작하는 ISBN13을 ISBN10으로 변환(Amazon 표지 URL이 ISBN10을 쓴다).
    979 계열은 대응하는 ISBN10이 없어 None."""
    if not isbn13 or len(isbn13) != 13 or not isbn13.startswith("978") or not isbn13.isdigit():
        return None
    core = isbn13[3:12]
    checksum = sum((10 - i) * int(d) for i, d in enumerate(core))
    check = (11 - (checksum % 11)) % 11
    return core + ("X" if check == 10 else str(check))


def _amazon_cover_urls(isbn10: str | None) -> list[str]:
    """Amazon의 ISBN10 기반 표지 이미지 URL. 별도 키가 필요 없고, 알라딘·카카오·Google Books
    카탈로그에 표지가 없는 해외 원서라도 Amazon이 팔면 표지가 나온다.
    ⚠️ 해당 책이 없으면 1x1 플레이스홀더를 200으로 돌려주므로, 내려받은 뒤 반드시
    `image_service.is_probably_cover`로 걸러야 한다(라우터에서 처리)."""
    if not isbn10:
        return []
    return [
        f"https://m.media-amazon.com/images/P/{isbn10}.01._SCLZZZZZZZ_.jpg",
        f"https://m.media-amazon.com/images/P/{isbn10}.jpg",
    ]


def _normalize_aladin_item(item: dict) -> dict:
    author, translator = _parse_aladin_author(item.get("author"))
    category = (item.get("categoryName") or "").split(">")[-1].strip() or None
    cover_urls = _aladin_cover_urls(item.get("cover"))

    return {
        "title": item.get("title"),
        "author": author,
        "translator": translator,
        "publisher": item.get("publisher"),
        "pub_year": _year_from_date(item.get("pubDate")),
        "category": category,
        "isbn": (item.get("isbn13") or "").strip() or None,
        "cover_url": cover_urls[0] if cover_urls else None,
        "cover_urls": cover_urls,  # 앞에서부터 받아지는 것을 씀
        "source": "aladin",
    }


def _fetch_aladin(query: str, max_results: int = 5) -> list[dict]:
    if not settings.aladin_ttb_key:
        return []

    params = {
        "ttbkey": settings.aladin_ttb_key,
        "Query": query,
        "QueryType": "Title",
        "MaxResults": max_results,
        "start": 1,
        "SearchTarget": "Book",
        "output": "js",
        "Version": "20131101",
        "Cover": "big",
    }
    try:
        resp = httpx.get(ALADIN_ENDPOINT, params=params, timeout=10, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    return [_normalize_aladin_item(item) for item in (data.get("item") or [])]


def _normalize_google_item(item: dict) -> dict:
    info = item.get("volumeInfo", {})
    cover_urls = _google_cover_urls(info.get("imageLinks") or {})
    categories = info.get("categories") or []

    isbn13 = isbn10 = None
    for ident in info.get("industryIdentifiers") or []:
        value = (ident.get("identifier") or "").strip() or None
        if ident.get("type") == "ISBN_13":
            isbn13 = value
        elif ident.get("type") == "ISBN_10":
            isbn10 = value

    return {
        "title": info.get("title"),
        "author": ", ".join(info.get("authors") or []) or None,
        "translator": None,
        "publisher": info.get("publisher"),
        "pub_year": _year_from_date(info.get("publishedDate")),
        "category": categories[0] if categories else None,
        "isbn": isbn13,
        "isbn10": isbn10,
        "cover_url": cover_urls[0] if cover_urls else None,
        "cover_urls": cover_urls,
        "source": "google_books",
    }


def _fetch_google(query: str, lang_restrict: str | None = None, max_results: int = 10) -> list[dict]:
    params: dict = {"q": query, "maxResults": max_results}
    if lang_restrict:
        params["langRestrict"] = lang_restrict
    if settings.google_books_api_key:
        params["key"] = settings.google_books_api_key

    try:
        resp = httpx.get(GOOGLE_BOOKS_ENDPOINT, params=params, timeout=10, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    return [_normalize_google_item(item) for item in (data.get("items") or [])]


def _kakao_isbn13(isbn_field: str | None) -> str | None:
    """카카오 isbn은 "0000000000 9791199999992"처럼 10자리·13자리가 공백으로 붙어 온다.
    교보 표지 조립에 쓸 13자리를 골라낸다."""
    if not isbn_field:
        return None
    for token in isbn_field.split():
        if len(token) == 13 and token.isdigit():
            return token
    return None


def _kakao_cover_urls(thumbnail: str | None) -> list[str]:
    """카카오 표지 이미지 URL.

    카카오가 주는 `thumbnail`은 `R120x174`로 리사이즈된 120px짜리라 표지로 쓰기엔 너무 작다.
    다만 그 URL의 `fname` 쿼리파라미터에 **리사이즈 전 원본 이미지 URL**이 URL-encode되어 들어있어
    (2026-08-18 실측: 원본 62KB vs 썸네일 16KB), 그 원본을 먼저 시도하고 실패 시 썸네일로 되돌아간다."""
    if not thumbnail:
        return []

    urls: list[str] = []
    try:
        fname = parse_qs(urlparse(thumbnail).query).get("fname")
        if fname:
            urls.append(unquote(fname[0]).replace("http://", "https://"))
    except Exception:
        pass
    urls.append(thumbnail.replace("http://", "https://"))
    return list(dict.fromkeys(urls))


def _normalize_kakao_item(item: dict) -> dict:
    # 카카오는 저자/번역자를 문자열 배열로 준다 (네이버의 캐럿 구분보다 깔끔)
    authors = [a.strip() for a in (item.get("authors") or []) if a.strip()]
    translators = [t.strip() for t in (item.get("translators") or []) if t.strip()]
    cover_urls = _kakao_cover_urls(item.get("thumbnail"))

    return {
        "title": item.get("title"),
        "author": ", ".join(authors) or None,
        "translator": ", ".join(translators) or None,
        "publisher": item.get("publisher"),
        "pub_year": _year_from_date(item.get("datetime")),  # ISO 8601, 앞 4자리가 연도
        "category": None,
        "isbn": _kakao_isbn13(item.get("isbn")),
        "cover_url": cover_urls[0] if cover_urls else None,
        "cover_urls": cover_urls,
        "source": "kakao",
    }


def _fetch_kakao(query: str, max_results: int = 5) -> list[dict]:
    """카카오(다음) 책 검색. REST API 키가 없으면 조용히 건너뛴다(선택 기능)."""
    if not settings.kakao_rest_api_key:
        return []

    headers = {"Authorization": f"KakaoAK {settings.kakao_rest_api_key}"}
    try:
        resp = httpx.get(
            KAKAO_BOOK_ENDPOINT,
            params={"query": query, "size": max_results},
            headers=headers,
            timeout=10,
            follow_redirects=True,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    return [_normalize_kakao_item(item) for item in (data.get("documents") or [])]


def _normalize_web_image_item(item: dict) -> dict:
    """Google 프로그래머블 검색(이미지) 결과 한 개.
    책 카탈로그 결과와 달리 저자/출판사/ISBN이 없고, `title`은 이미지가 실린 웹페이지 제목이다.
    (표지 후보 관련도 판정 `_match_ratio`가 이 title로 쿼리와의 겹침을 본다)"""
    image = item.get("image") or {}
    link = item.get("link")
    thumb = image.get("thumbnailLink")
    cover_urls = [u for u in (link, thumb) if u]

    return {
        "title": item.get("title"),
        "author": None,
        "translator": None,
        "publisher": item.get("displayLink"),  # 이미지 출처 도메인(후보 카드에 참고용으로 표시)
        "pub_year": None,
        "category": None,
        "isbn": None,
        "cover_url": cover_urls[0] if cover_urls else None,
        "cover_urls": cover_urls,
        "source": "web",
    }


def _fetch_web_images(query: str, max_results: int = 5) -> list[dict]:
    """웹 전체에서 표지 이미지를 검색(Google 프로그래머블 검색). 검색엔진 ID가 없으면 건너뛴다.
    책 카탈로그 어디에도 표지가 없는 책(해외 원서 등)을 위한 최후의 보루다."""
    api_key = settings.google_cse_api_key or settings.google_books_api_key
    if not (settings.google_cse_id and api_key):
        return []

    params = {
        "key": api_key,
        "cx": settings.google_cse_id,
        "q": query,
        "searchType": "image",
        "num": max_results,
    }
    try:
        resp = httpx.get(GOOGLE_CSE_ENDPOINT, params=params, timeout=10, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    return [_normalize_web_image_item(item) for item in (data.get("items") or [])]


def search_aladin(query: str) -> dict | None:
    items = _fetch_aladin(query)
    return items[0] if items else None


def search_google_books(query: str, lang_restrict: str | None = None) -> dict | None:
    items = _fetch_google(query, lang_restrict=lang_restrict)
    return items[0] if items else None


def search_kakao(query: str) -> dict | None:
    items = _fetch_kakao(query)
    return items[0] if items else None


def lookup_book(query: str, language: str | None = None) -> dict | None:
    """책 정보를 조회한다.

    표지에서 읽은 언어가 한국어(ko)이거나 판단이 안 되면 국내 서점(알라딘 → 카카오)을 우선
    조회하고, 그 외 언어(예: 프랑스어 fr)로 판단되면 알라딘이 무관한 한국 책을 잘못 매칭하는
    경우가 많아 Google Books를 해당 언어로 먼저 조회한다. 어느 쪽이든 결과가 쿼리와 무관해
    보이면 다음 소스로 넘어간다. (카카오는 키가 설정돼 있을 때만 조회된다)
    """
    is_korean = language is None or language == "ko"

    if is_korean:
        for result in (search_aladin(query), search_kakao(query)):
            if result and result.get("title") and _looks_relevant(query, result):
                return result
        return search_google_books(query)

    # 한국어가 아닌 책(예: 프랑스어) — 해당 언어로 Google Books를 먼저 조회
    result = search_google_books(query, lang_restrict=language)
    if result and result.get("title") and _looks_relevant(query, result):
        return result

    # 혹시 한국에 정식 번역 출간된 책일 수도 있으니 국내 서점도 확인
    for result in (search_aladin(query), search_kakao(query)):
        if result and result.get("title") and _looks_relevant(query, result):
            return result

    # 마지막으로 언어 제한 없이 Google Books 재시도
    return search_google_books(query)


def normalize_isbn(raw: str | None) -> str:
    """입력에서 ISBN 문자만 남긴다(하이픈/공백 제거, X는 대문자로). 10 또는 13자리를 기대."""
    return re.sub(r"[^0-9Xx]", "", raw or "").upper()


def _fetch_aladin_by_isbn(isbn: str) -> list[dict]:
    """알라딘 ItemLookUp(ISBN 정확 조회). 검색(ItemSearch)과 달리 ISBN으로 딱 한 권을 집는다."""
    if not settings.aladin_ttb_key:
        return []
    params = {
        "ttbkey": settings.aladin_ttb_key,
        "itemIdType": "ISBN13" if len(isbn) == 13 else "ISBN",
        "ItemId": isbn,
        "output": "js",
        "Version": "20131101",
        "Cover": "big",
    }
    try:
        resp = httpx.get(ALADIN_LOOKUP_ENDPOINT, params=params, timeout=10, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []
    return [_normalize_aladin_item(item) for item in (data.get("item") or [])]


def _fetch_kakao_by_isbn(isbn: str) -> list[dict]:
    if not settings.kakao_rest_api_key:
        return []
    headers = {"Authorization": f"KakaoAK {settings.kakao_rest_api_key}"}
    try:
        resp = httpx.get(
            KAKAO_BOOK_ENDPOINT,
            params={"query": isbn, "target": "isbn"},
            headers=headers,
            timeout=10,
            follow_redirects=True,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []
    return [_normalize_kakao_item(item) for item in (data.get("documents") or [])]


def _isbn10_to_13(isbn10: str | None) -> str | None:
    """ISBN10 → ISBN13(978 접두 + EAN-13 체크숫자)."""
    if not isbn10 or len(isbn10) != 10:
        return None
    core = "978" + isbn10[:9]
    if not core.isdigit():
        return None
    checksum = sum((1 if i % 2 == 0 else 3) * int(d) for i, d in enumerate(core))
    return core + str((10 - (checksum % 10)) % 10)


def _isbn13_check_ok(s: str) -> bool:
    if len(s) != 13 or not s.isdigit():
        return False
    total = sum((1 if i % 2 == 0 else 3) * int(d) for i, d in enumerate(s[:12]))
    return (10 - (total % 10)) % 10 == int(s[12])


def _isbn10_check_ok(s: str) -> bool:
    if len(s) != 10 or not s[:9].isdigit():
        return False
    total = sum((10 - i) * int(d) for i, d in enumerate(s[:9]))
    check = (11 - (total % 11)) % 11
    return ("X" if check == 10 else str(check)) == s[9].upper()


def is_valid_isbn(raw: str | None) -> bool:
    """ISBN 체크숫자까지 맞는지 검증. 오타난 ISBN은 대부분 체크숫자가 어긋나 여기서 걸러진다
    (알라딘/카카오는 존재하지 않는 ISBN에도 엉뚱한 결과를 echo하므로 입력 단계 검증이 중요)."""
    isbn = normalize_isbn(raw)
    return _isbn13_check_ok(isbn) or _isbn10_check_ok(isbn)


def _isbn_forms(isbn: str) -> set[str]:
    """조회한 ISBN과 동등한 표현(10↔13)을 모두 모은다 — 결과가 어느 형식으로 오든 대조하려고."""
    forms = {isbn}
    if len(isbn) == 13 and isbn.startswith("978"):
        alt = _isbn13_to_10(isbn)
    elif len(isbn) == 10:
        alt = _isbn10_to_13(isbn)
    else:
        alt = None
    if alt:
        forms.add(alt)
    return forms


def isbn_equivalents(raw: str | None) -> set[str]:
    """정규화한 ISBN과 그 10↔13 동등 표현을 모두 돌려준다.

    중복 등록 검사용 공개 헬퍼. 같은 책이 어떤 사람은 ISBN-10, 어떤 사람은 ISBN-13으로
    입력해 두었을 수 있어서, 두 표현을 모두 대조해야 중복을 놓치지 않는다.
    """
    isbn = normalize_isbn(raw)
    return _isbn_forms(isbn) if isbn else set()


def lookup_by_isbn(isbn: str) -> dict | None:
    """ISBN으로 책 한 권의 정보를 조회한다(새책 추가 시 ISBN만 입력하면 나머지를 채우는 용도).

    국내서 정보가 풍부한 알라딘(ItemLookUp)을 먼저, 그다음 카카오, 마지막으로 Google Books(해외
    원서)를 시도한다.

    ⚠️ **결과의 ISBN이 조회한 ISBN과 실제로 일치하는 것만 채택한다.** 알라딘 ItemLookUp과 카카오
    isbn 검색은 존재하지 않는 ISBN에도 정확 조회 대신 **느슨한 검색으로 폴백해 엉뚱한 중고책 등을
    반환**하기 때문(2026-08-20 실측). 이 대조가 없으면 오타난 ISBN으로 완전히 다른 책이 입력된다.
    """
    isbn = normalize_isbn(isbn)
    if not is_valid_isbn(isbn):
        return None
    forms = _isbn_forms(isbn)
    for items in (
        _fetch_aladin_by_isbn(isbn),
        _fetch_kakao_by_isbn(isbn),
        _fetch_google(f"isbn:{isbn}", max_results=3),
    ):
        for result in items:
            if not result.get("title"):
                continue
            candidate_forms = {
                normalize_isbn(result.get("isbn")),
                normalize_isbn(result.get("isbn10")),
            } - {""}
            if candidate_forms & forms:
                # ISBN13이 비어 있으면(일부 소스) 조회한 값으로 보정
                if not result.get("isbn"):
                    result["isbn"] = isbn if len(isbn) == 13 else _isbn10_to_13(isbn)
                return result
    return None


def all_cover_urls(result: dict) -> list[str]:
    """한 책 결과에서 시도해볼 표지 URL 전부(카탈로그 자체 표지 + ISBN 기반 교보/Amazon), 중복 제거."""
    urls = list(result.get("cover_urls") or [])
    for option in _isbn_based_cover_options(result):
        for url in option.get("cover_urls") or []:
            if url not in urls:
                urls.append(url)
    return urls


def _title_variants(title: str) -> list[str]:
    """제목을 검색이 잘 되는 순서로 단계적으로 완화한 목록.

    예: "SAMPLE TITLE: 예시 제목" → ["SAMPLE TITLE: 예시 제목", "예시 제목",
    "SAMPLE TITLE"]. 알라딘·구글 모두 검색어의 모든 단어를 AND로 걸기 때문에, 영문 원제나 부제가
    붙은 제목을 통째로 넣으면 **책이 DB에 있어도 0건**이 나온다(실제 이 책이 그랬음).
    한글 조각을 영문 조각보다 앞에 두는 이유: 국내서는 한글 제목으로 등록돼 있기 때문.
    """
    title = (title or "").strip()
    if not title:
        return []

    segments = [s.strip() for s in _TITLE_SPLIT_RE.split(title) if s and s.strip()]
    korean = [s for s in segments if _HANGUL_RE.search(s)]
    others = [s for s in segments if not _HANGUL_RE.search(s)]

    variants: list[str] = []
    for candidate in [title, *korean, *others]:
        if len(candidate) >= 2 and candidate not in variants:
            variants.append(candidate)
    return variants


def _primary_author(author: str | None) -> str:
    """저자가 여러 명이면 **첫 번째 사람만** 쓴다. 알라딘은 "예시 제목 홍길동, 김철수"처럼
    저자를 둘 이상 붙이면 0건을 돌려주지만(2026-08-18 실측), "홍길동" 한 명만 붙이면 정상 검색된다."""
    if not author:
        return ""
    first = re.split(r"[,;/&·]|\s+외\s*\d*명?\b", author)[0]
    return re.sub(r"\(.*?\)", "", first).strip()


def _query_variants(title: str, author: str | None = None, max_variants: int = 4) -> list[str]:
    """제목 변형 × (저자 포함/미포함) 조합을 검색 시도 순서대로. 앞의 것이 실패할 때만 뒤로 간다."""
    author = _primary_author(author)
    queries: list[str] = []
    for variant in _title_variants(title):
        if author:
            queries.append(f"{variant} {author}")
        queries.append(variant)
    if not queries and author:
        queries.append(author)

    unique: list[str] = []
    for query in queries:
        if query not in unique:
            unique.append(query)
    return unique[:max_variants]


def _search_sources(query: str, language: str | None) -> list[dict]:
    """한 검색어로 모든 소스를 조회. 조회 순서는 `lookup_book()`과 같은 이유로
    한국어(또는 판단 불가)면 국내 서점(알라딘·카카오) 우선, 그 외 언어면 Google Books 우선.
    카카오/웹이미지는 키가 있을 때만 실제 호출되고, 없으면 빈 목록이라 순서에 영향이 없다.

    웹 이미지 검색(_fetch_web_images)은 항상 **맨 뒤**에 둔다: 책 카탈로그의 정식 표지가 우선
    순위를 갖고, 카탈로그에 표지가 아예 없는 책(해외 원서 등)일 때만 이게 실질적으로 쓰이도록."""
    if language is None or language == "ko":
        catalog = _fetch_aladin(query) + _fetch_kakao(query) + _fetch_google(query)
    else:
        catalog = _fetch_google(query, lang_restrict=language) + _fetch_aladin(query) + _fetch_kakao(query)
    return catalog + _fetch_web_images(query)


def _isbn_based_cover_options(result: dict) -> list[dict]:
    """검색으로 찾은 책의 ISBN으로 다른 표지 이미지 후보를 만든다.
    - 교보문고: ISBN13 기반 (국내서 화질 좋음)
    - Amazon: ISBN10 기반 (**카탈로그에 표지가 없는 해외 원서를 구제하는 핵심**)
    같은 책이라도 소스마다 판형·화질이 달라 여러 개를 후보로 준다."""
    options: list[dict] = []

    isbn13 = result.get("isbn")
    kyobo_urls = _kyobo_cover_urls(isbn13)
    if kyobo_urls:
        options.append({**result, "source": "kyobo", "cover_url": kyobo_urls[0], "cover_urls": kyobo_urls})

    isbn10 = result.get("isbn10") or _isbn13_to_10(isbn13)
    amazon_urls = _amazon_cover_urls(isbn10)
    if amazon_urls:
        options.append({**result, "source": "amazon", "cover_url": amazon_urls[0], "cover_urls": amazon_urls})

    return options


def _build_candidates(query: str, results: list[dict], limit: int, min_match_ratio: float) -> list[dict]:
    """검색 결과에서 표지 후보 목록을 만든다.

    카탈로그가 책은 찾았지만 **표지 이미지가 없는 경우**(특히 Google Books의 해외 원서)에도,
    그 책의 ISBN으로 교보/Amazon 표지를 후보에 넣는다 — 이게 없으면 표지 없는 정답 책을 버리고
    표지 있는 엉뚱한 책을 고르게 된다(프랑스어 책 `Études sur le jardin`가 실제 그랬음)."""
    candidates: list[dict] = []
    seen_urls: set[str] = set()
    seen_isbns: set[str] = set()

    # 검색어와 가장 똑 닮은 판을 앞으로. 같은 유사도면 원래(소스) 순서 유지(stable sort).
    # 이렇게 해야 정확히 같은 책이, 제목만 겹치는 다른 책(예: "...cent ans après")보다 먼저 온다.
    results = sorted(results, key=lambda r: _closeness(query, r), reverse=True)

    for result in results:
        if _match_ratio(query, result) < min_match_ratio:
            continue

        options: list[dict] = []
        if result.get("cover_url"):
            options.append(result)  # 카탈로그 자체 표지

        isbn = result.get("isbn")
        if isbn and isbn not in seen_isbns:
            seen_isbns.add(isbn)
            options.extend(_isbn_based_cover_options(result))

        for option in options:
            if not option.get("cover_url") or option["cover_url"] in seen_urls:
                continue
            seen_urls.add(option["cover_url"])
            candidates.append(option)
            if len(candidates) >= limit:
                return candidates

    return candidates


def search_cover_candidates(
    title: str,
    author: str | None = None,
    language: str | None = None,
    limit: int = 3,
) -> list[dict]:
    """표지 이미지를 **여러 개** 찾아 후보 목록으로 돌려준다(이미 등록된 책의 표지를 바꿀 때 사용).

    `lookup_book()`은 "가장 그럴듯한 한 권"만 자동으로 고르지만, 여기서는 사용자가 눈으로 보고
    고를 것이므로 (1) 검색어를 단계적으로 완화해가며 재시도하고 (2) 알라딘·구글·교보 표지를 모두 모은다.

    2단계 통과가 필요한 이유: 처음부터 느슨하게 받으면 첫 검색어에서 **엉뚱한 책**이 걸려
    거기서 멈춰버린다(예: "부제가 긴 책(괄호 속 부제)"의 첫 검색어에서 구글이 "다른 책"을
    돌려주는 바람에, 정답이 나오는 뒤쪽 검색어까지 가지도 못했음). 그래서 먼저 검색어 단어의
    절반 이상이 일치하는 결과만 받아보고, 그래도 아무것도 없을 때만 한 단어라도 겹치면 받는다.
    같은 검색어를 두 번 조회하지 않도록 결과를 캐시하므로 외부 호출은 최대 (검색어 4개 × 소스 수)회.

    ⚠️ 이 완화 재시도를 `lookup_book()`(스캔 자동 채움)에는 적용하지 않았다 — 거기서는 사람이
    확인하지 않고 첫 결과를 그대로 쓰기 때문에, 검색어를 느슨하게 할수록 엉뚱한 책이 자동으로
    입력될 위험이 커진다.
    """
    queries = _query_variants(title, author)
    cache: dict[str, list[dict]] = {}

    for min_match_ratio in (_STRICT_MATCH_RATIO, _LOOSE_MATCH_RATIO):
        for query in queries:
            if query not in cache:
                cache[query] = _search_sources(query, language)
            candidates = _build_candidates(query, cache[query], limit, min_match_ratio)
            if candidates:
                return candidates
    return []


def download_cover_image(url: str) -> bytes | None:
    try:
        resp = httpx.get(url, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        return resp.content
    except Exception:
        return None


def download_first_available(urls: list[str], validator=None) -> bytes | None:
    """고화질 URL부터 순서대로 시도하고 처음 성공한 것을 반환.
    (알라딘 cover500이나 교보 800x0은 없는 책이 있을 수 있어 반드시 fallback이 필요하다)

    validator(bytes)->bool를 주면, 내려받은 데이터가 이를 통과할 때만 채택한다.
    Amazon ISBN 표지는 없는 책이면 1x1 플레이스홀더를 200으로 주므로, 라우터가
    `image_service.is_probably_cover`를 validator로 넘겨 그런 것을 건너뛰게 한다."""
    for url in urls:
        data = download_cover_image(url)
        if data and (validator is None or validator(data)):
            return data
    return None
