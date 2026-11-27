"""[새책 추천] — 우리 서재의 결에 맞는 신간을 골라 온다.

두 단계다.

1. **후보 수집(알라딘)** — 서재에서 많이 가진 분야를 알라딘 카테고리로 바꿔, 그 분야의
   `주목할 만한 신간`과 `베스트셀러`를 모은다. 이미 가진 책은 여기서 걸러낸다.
2. **선별(Claude)** — 후보 목록과 "우리 서재가 어떤 책들인지"를 함께 주고, 결이 맞는 것만
   고르게 한다. **왜 추천하는지 한 줄**을 함께 받는다 — 이유가 없으면 그냥 신간 목록과 다를
   바가 없고, 사용자가 판단할 근거가 없다.

교보문고는 쓰지 않는다. 공개 API가 없고, 목록을 긁어오는 것은 이용약관 문제가 있다.
구글북스는 한국 신간 목록이 비어 있다시피 해서 이 용도로는 쓸모가 없다.

⚠️ 외부 API와 LLM을 부르므로 **한 벌 만드는 데 수 초가 걸린다.** 그래서 결과를
`recommendations` 테이블에 캐시하고 하루에 한 번만 다시 만든다(`router`가 판단).
"""

import json
import logging
import re
from datetime import date, datetime, timedelta, timezone

import anthropic
import httpx
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.services import user_keys
from app import library_scope
from app.models.book import Book
from app.models.user import User
from app.models.recommendation import Recommendation
from app.services import booklookup_service

logger = logging.getLogger(__name__)

ALADIN_LIST_ENDPOINT = "https://www.aladin.co.kr/ttb/api/ItemList.aspx"
MODEL = "claude-sonnet-5"

# 신간으로 볼 기간. "지난 3개월"이 기준이고, 앞쪽으로 7일을 열어 둔 것은 알라딘이
# **이번 주 출간 예정**을 신간 목록에 함께 실어 주기 때문이다. 그걸 버리면 가장 새로운
# 책들이 통째로 빠진다. 화면에 출간일을 그대로 보여 주므로 오해할 일은 없다.
NEW_WITHIN_DAYS = 90
FUTURE_SLACK_DAYS = 7

# Claude에 넘길 후보 상한과 최종 추천 권수.
CANDIDATE_LIMIT = 120
RESULT_LIMIT = 24

# 서재 카테고리 키워드 → 알라딘 CategoryId.
# **2026-09-27에 실제 API로 하나씩 확인한 값이다**(응답의 categoryName으로 대조).
# 추측으로 적으면 엉뚱한 분야의 신간이 올라온다.
ALADIN_CATEGORIES = {
    1: ("소설/시/희곡", ("소설", "시", "희곡", "문학")),
    170: ("경제경영", ("경제경영", "경제", "경영", "재테크")),
    336: ("자기계발", ("자기계발", "마음수련", "명상")),
    656: ("인문학", ("인문", "철학", "인류학", "글쓰기", "언어")),
    798: ("사회과학", ("사회", "정치", "법", "미래학")),
    74: ("역사", ("역사",)),
    987: ("과학", ("과학", "우주", "천문", "수학", "생물")),
    55889: ("에세이", ("에세이",)),
    1237: ("종교/역학", ("종교", "불교", "기독교")),
    517: ("예술/대중문화", ("예술", "미술", "음악", "영화", "건축")),
    1196: ("여행", ("여행",)),
    351: ("컴퓨터/모바일", ("컴퓨터", "프로그래밍", "IT", "인공지능")),
}


# ──────────────────────────────────────────────────────────────────────────
# 서재 프로필
# ──────────────────────────────────────────────────────────────────────────

def _norm(text: str | None) -> str:
    """비교용으로 다듬는다 — 공백·문장부호를 없애고 소문자로."""
    if not text:
        return ""
    return re.sub(r"[\s\W_]+", "", text).lower()


def library_profile(db: Session, user: User) -> dict:
    """서재가 어떤 책들인지 요약한다 — 카테고리 분포 + 대표 책 표본."""
    rows = library_scope.books(db, user, Book.category).filter(Book.category.isnot(None)).all()
    counts: dict[str, int] = {}
    for (raw,) in rows:
        for kw in (raw or "").split(","):
            kw = kw.strip()
            if kw:
                counts[kw] = counts.get(kw, 0) + 1
    top = sorted(counts.items(), key=lambda kv: -kv[1])[:30]

    # 표본은 **최근에 넣은 책** 위주로 본다. 서재 전체보다 "요즘 관심사"를 더 잘 드러낸다.
    sample = (
        library_scope.books(db, user, Book.title, Book.author, Book.category)
        .order_by(Book.created_at.desc())
        .limit(40)
        .all()
    )
    return {
        "total": library_scope.books(db, user, func.count(Book.id)).scalar() or 0,
        "top_categories": top,
        "sample": [
            {"title": t, "author": a, "category": c} for t, a, c in sample
        ],
    }


def _category_weights(profile: dict) -> list[tuple[int, str, int]]:
    """서재 분포를 알라딘 카테고리별 가중치로 바꾼다. [(cid, 이름, 권수)] 내림차순."""
    weights: dict[int, int] = {}
    for kw, n in profile["top_categories"]:
        low = kw.lower()
        for cid, (_name, needles) in ALADIN_CATEGORIES.items():
            if any(needle.lower() in low for needle in needles):
                weights[cid] = weights.get(cid, 0) + n
                break
    out = [(cid, ALADIN_CATEGORIES[cid][0], n) for cid, n in weights.items()]
    out.sort(key=lambda x: -x[2])
    return out


# ──────────────────────────────────────────────────────────────────────────
# 후보 수집 (알라딘)
# ──────────────────────────────────────────────────────────────────────────

def _within_window(pub_date: str | None) -> bool:
    if not pub_date:
        return False
    try:
        d = datetime.strptime(pub_date.strip()[:10], "%Y-%m-%d").date()
    except ValueError:
        return False
    today = date.today()
    return (today - timedelta(days=NEW_WITHIN_DAYS)) <= d <= (today + timedelta(days=FUTURE_SLACK_DAYS))


def _aladin_list(query_type: str, category_id: int | None, max_results: int = 50) -> list[dict]:
    params = {
        "ttbkey": settings.aladin_ttb_key,
        "QueryType": query_type,
        "MaxResults": max_results,
        "start": 1,
        "SearchTarget": "Book",
        "output": "js",
        "Version": "20131101",
        "Cover": "MidBig",
    }
    if category_id:
        params["CategoryId"] = category_id
    try:
        resp = httpx.get(ALADIN_LIST_ENDPOINT, params=params, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        # 한 분야가 실패해도 나머지로 목록은 만들어진다. 전체를 실패시키지 않는다.
        logger.exception("알라딘 %s (CategoryId=%s) 조회 실패", query_type, category_id)
        return []
    if data.get("errorMessage"):
        logger.warning("알라딘 %s 오류: %s", query_type, data["errorMessage"])
        return []
    return data.get("item", []) or []


SOURCE_LABEL = {"ItemNewSpecial": "주목신간", "ItemNewAll": "신간", "Bestseller": "베스트셀러"}


def collect_candidates(db: Session, user: User, profile: dict) -> list[dict]:
    """서재 분포에 맞춰 분야별로 신간·베스트셀러를 모으고, 이미 가진 책을 걸러낸다."""
    weights = _category_weights(profile)

    owned_isbn = {
        booklookup_service.normalize_isbn(i or "")
        for (i,) in library_scope.books(db, user, Book.isbn).filter(Book.isbn.isnot(None)).all()
    }
    owned_isbn.discard("")
    owned_key = {
        _norm(t) + "|" + _norm(a)
        for t, a in library_scope.books(db, user, Book.title, Book.author).all()
    }
    owned_title = {_norm(t) for (t,) in library_scope.books(db, user, Book.title).all()}

    seen: set[str] = set()
    out: list[dict] = []

    # 분야가 많이 있는 쪽을 먼저 본다 — 후보 상한에 걸리면 뒤쪽이 잘리기 때문이다.
    #
    # ⚠️ **끼워 넣어야 한다.** 처음에는 주목신간을 전부 돌고 나서 베스트셀러를 붙였는데,
    #    후보 상한(120)에 먼저 걸려 **베스트셀러가 한 권도 안 들어왔다**(실측: 출처 분포가
    #    주목신간 24/24). 분야마다 번갈아 넣어야 두 갈래가 모두 후보에 남는다.
    plan: list[tuple[str, int | None]] = []
    for i, (cid, _name, _n) in enumerate(weights[:8]):
        plan.append(("ItemNewSpecial", cid))
        if i < 4:
            plan.append(("Bestseller", cid))
    # 분야를 가리지 않는 한 판도 섞는다 — 서재에 없던 결을 만날 여지를 남긴다.
    plan.append(("ItemNewSpecial", None))

    for query_type, cid in plan:
        for item in _aladin_list(query_type, cid, max_results=30):
            pub_date = (item.get("pubDate") or "").strip()
            if not _within_window(pub_date):
                continue

            isbn = booklookup_service.normalize_isbn(item.get("isbn13") or item.get("isbn") or "")
            title = (item.get("title") or "").strip()
            author_raw = (item.get("author") or "").strip()
            if not title:
                continue

            # 이미 가진 책 제외 — 이 앱의 존재 이유가 중복 구매 방지다.
            if isbn and isbn in owned_isbn:
                continue
            if (_norm(title) + "|" + _norm(author_raw)) in owned_key:
                continue
            if _norm(title) in owned_title:
                continue

            key = isbn or (_norm(title) + "|" + _norm(author_raw))
            if key in seen:
                continue
            seen.add(key)

            out.append({
                "title": title,
                "author": author_raw or None,
                "publisher": (item.get("publisher") or "").strip() or None,
                "pub_date": pub_date or None,
                "isbn": isbn or None,
                "category": (item.get("categoryName") or "").strip() or None,
                "cover_url": (item.get("cover") or "").strip() or None,
                "link": (item.get("link") or "").strip() or None,
                "source": SOURCE_LABEL.get(query_type, query_type),
            })
            if len(out) >= CANDIDATE_LIMIT:
                return out
    return out


# ──────────────────────────────────────────────────────────────────────────
# 선별 (Claude)
# ──────────────────────────────────────────────────────────────────────────

SELECT_PROMPT = """당신은 이 집의 서재를 잘 아는 책 큐레이터입니다.

# 이 집 서재의 성향
전체 {total}권. 많이 가진 분야(권수):
{categories}

최근에 들인 책들(제목 / 저자 / 분류):
{sample}

# 후보 신간 목록
아래는 최근 3개월 사이에 나온 책들입니다. 번호를 그대로 쓰세요.
{candidates}

# 할 일
위 후보 중에서 **이 집 서재의 결과 잘 맞는 책**을 최대 {limit}권 고르세요.

기준:
- 서재가 많이 가진 분야(인문·사회·과학·소설·에세이 등)와 실제로 통하는 책을 우선하세요.
- 학습만화, 어린이·수험서, 실용 문제집, 특정 자격증 교재처럼 서재의 결과 동떨어진 것은 빼세요.
- 분야만 같고 내용이 얄팍한 기획서보다, 서재에 있는 책들과 **이야기가 이어지는** 책을 고르세요.
- 골고루 담되 한 분야가 절반을 넘지 않게 하세요.

각 책에 대해 JSON 객체를 만들고, 배열 하나만 출력하세요. 다른 설명은 쓰지 마세요.

[
  {{
    "index": 후보 번호(정수),
    "score": 서재와의 적합도 0~100 (정수),
    "matched_on": "서재의 어떤 결과 맞는지 쉼표로 2~3개 (예: 인류학, 과학교양)",
    "reason": "왜 이 집에 어울리는지 한국어로 한두 문장. 서재에 있는 책이나 분야를 구체적으로 언급할 것."
  }}
]
"""


def _select_with_claude(profile: dict, candidates: list[dict], api_key: str) -> list[dict]:
    """Claude로 후보를 걸러 이유를 붙인다. 실패하면 빈 목록(=규칙 기반으로 넘어간다)."""
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY 없음 — Claude 선별을 건너뛴다")
        return []

    cats = "\n".join(f"- {kw}: {n}권" for kw, n in profile["top_categories"][:20])
    sample = "\n".join(
        f"- {b['title']} / {b['author']} / {b['category'] or '-'}" for b in profile["sample"][:40]
    )
    cand = "\n".join(
        f"{i}. {c['title']} / {c['author'] or '-'} / {c['publisher'] or '-'}"
        f" / {c['category'] or '-'} / {c['pub_date'] or '-'}"
        for i, c in enumerate(candidates)
    )
    prompt = SELECT_PROMPT.format(
        total=profile["total"], categories=cats, sample=sample,
        candidates=cand, limit=RESULT_LIMIT,
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=MODEL,
            max_tokens=8000,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(
            b.text for b in message.content if getattr(b, "type", None) == "text"
        )
        start, end = text.find("["), text.rfind("]")
        if start == -1 or end == -1:
            raise ValueError("Claude 응답에서 JSON 배열을 찾을 수 없습니다.")
        picked = json.loads(text[start : end + 1])
    except Exception:
        logger.exception("Claude 선별 실패 — 카테고리 순서로 대체한다")
        return []

    out = []
    for p in picked:
        try:
            idx = int(p["index"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (0 <= idx < len(candidates)):
            continue  # 없는 번호를 짚으면 버린다(환각 방어)
        book = dict(candidates[idx])
        book["score"] = float(p.get("score") or 0)
        book["reason"] = (p.get("reason") or "").strip() or None
        book["matched_on"] = (p.get("matched_on") or "").strip()[:300] or None
        out.append(book)
    out.sort(key=lambda b: -(b.get("score") or 0))
    return out[:RESULT_LIMIT]


# ──────────────────────────────────────────────────────────────────────────
# 목록 만들기 / 읽기
# ──────────────────────────────────────────────────────────────────────────

def _mine(db: Session, user: User, *entities):
    """추천 테이블도 personal 모드에서는 도서관마다 따로다(멤버끼리 같은 목록을 본다)."""
    return library_scope.scope(
        db.query(*(entities or (Recommendation,))), user, Recommendation.library_id
    )


def refresh(db: Session, user: User) -> list[Recommendation]:
    """추천 목록을 새로 만들어 **통째로 교체**한다(personal 모드에서는 이 사람 몫만)."""
    profile = library_profile(db, user)
    candidates = collect_candidates(db, user, profile)
    logger.info("새책 추천: 후보 %d권 수집", len(candidates))

    chosen = _select_with_claude(profile, candidates, user_keys.ai_key_for(user))
    if not chosen:
        # Claude가 안 되는 상황(키 없음·장애)에서도 화면이 비지 않게 한다.
        # 이유는 붙일 수 없으니 비워 두고, 화면이 그 사실을 드러낸다.
        chosen = candidates[:RESULT_LIMIT]
        logger.warning("새책 추천: Claude 선별 없이 후보 상위 %d권으로 채운다", len(chosen))

    now = datetime.now(timezone.utc)
    _mine(db, user).delete(synchronize_session=False)
    lib = library_scope.library_id_for(user)
    rows = []
    for i, c in enumerate(chosen):
        rows.append(Recommendation(
            owner_id=user.id,
            library_id=lib,
            generated_at=now,
            title=c["title"][:500],
            author=(c.get("author") or None),
            publisher=(c.get("publisher") or None),
            pub_date=(c.get("pub_date") or None),
            isbn=(c.get("isbn") or None),
            category=(c.get("category") or None),
            cover_url=(c.get("cover_url") or None),
            link=(c.get("link") or None),
            source=(c.get("source") or None),
            reason=c.get("reason"),
            score=c.get("score"),
            matched_on=c.get("matched_on"),
            rank=i,
        ))
    db.add_all(rows)
    db.commit()
    logger.info("새책 추천: %d권 저장", len(rows))
    return list_current(db, user)


def list_current(db: Session, user: User) -> list[Recommendation]:
    return _mine(db, user).order_by(Recommendation.rank.asc()).all()


def generated_at(db: Session, user: User) -> datetime | None:
    return _mine(db, user, func.max(Recommendation.generated_at)).scalar()


def is_stale(db: Session, user: User, max_age_hours: int = 24) -> bool:
    at = generated_at(db, user)
    if at is None:
        return True
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - at) > timedelta(hours=max_age_hours)
