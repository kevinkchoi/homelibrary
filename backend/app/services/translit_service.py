import re

"""외국 저자 이름을 로마자로 쳐도 한글 표기를 찾아내기 위한 음역 비교.

`"Laurent"` → 서재에는 `"로랑 뒤퐁"`처럼 한글로 들어 있다. 글자로는 전혀 겹치지 않으므로
**소리**로 비교해야 한다. 방법은 양쪽을 같은 모양의 **자음 뼈대**로 바꾸는 것이다.

    로랑    → r o r a ng → R R N
    Laurent → l(a)(u)r(e)n t → R R N D   → 앞부분이 같다 → 같은 이름으로 본다
    도이치   → d o (i) ch i  → D CH
    Deutsche → d (eu) tsch (e) → D CH    → 똑같다

모음은 버린다. 한글 음역에서 가장 많이 흔들리는 것이 모음이기 때문이다
(Laurent → 로랑/로랭, Deutsche → 도이치/도이체).
자음도 한국어가 구분하지 않는 것끼리 묶는다(L/R, B/V/P/F, D/T, G/K/C).

**이 비교는 통합검색의 마지막 단계에서만 쓴다.** 글자 그대로 찾아 한 권도 없을 때만
동작하므로, 조금 헐거워서 엉뚱한 게 걸려도 "결과 없음"보다는 낫다.
"""

# --- 한글 자모 → 로마자 ---------------------------------------------------
# 표준 로마자 표기법이 아니라 **비교용**이다. 원래 소리로 되돌리는 것이 목적이라
# ㄹ은 R로, 받침 ㅇ은 N으로 두는 식으로 단순화했다.
_INITIALS = "g k n d t r m b p s s . j j ch k t p h".split()
# 받침 ㅇ을 'ng'가 아니라 'n'으로 두는 이유: 'ng'는 G를 하나 더 만들어
# `로랑`(RNG)과 `Laurent`(RND)가 어긋난다. 외국 이름 음역에서 받침 ㅇ은 n/ng 둘 다 받는다.
_FINALS = (
    ". k k k n n n t l k m l l l p l m p p t t n t t k t p t".split()
)

_HANGUL_BASE = 0xAC00
_HANGUL_LAST = 0xD7A3

# 한국어가 구분하지 않는 소리끼리 한 글자로 묶는다
_CLASS = {
    "l": "R", "r": "R",
    "b": "B", "v": "B", "p": "B", "f": "B",
    "d": "D", "t": "D",
    "g": "G", "k": "G", "c": "G", "q": "G",
    "m": "M",
    "n": "N",
    "s": "S", "z": "J", "j": "J",
    "h": "H",
}


def _romanize_hangul(text: str) -> str:
    """한글을 비교용 로마자로. 한글이 아닌 글자는 그대로 둔다."""
    out = []
    for ch in text:
        code = ord(ch)
        if _HANGUL_BASE <= code <= _HANGUL_LAST:
            index = code - _HANGUL_BASE
            initial = index // (21 * 28)
            final = index % 28
            out.append(_INITIALS[initial].replace(".", ""))
            out.append("a")  # 모음 자리(어차피 뒤에서 버린다) — 자음이 붙어버리지 않게
            out.append(_FINALS[final].replace(".", ""))
        else:
            out.append(ch)
    return "".join(out)


# 라틴 문자에서 먼저 묶어야 하는 덩어리. 순서가 중요하다(긴 것부터).
_DIGRAPHS = [
    ("tzsch", "ch"), ("tsch", "ch"), ("sch", "s"), ("tch", "ch"), ("tz", "ch"),
    ("ch", "ch"), ("sh", "s"), ("ph", "f"),
    ("ck", "k"), ("qu", "k"), ("x", "ks"), ("w", ""), ("y", ""),
]

# 소리가 갈리는 덩어리. 한 가지로 정할 수 없어 **두 가지를 다 만들어** 본다.
# `Thomas` → 토마스(ㅌ), `Thoreau` → 소로(ㅅ). 같은 th인데 표기가 다르다.
_AMBIGUOUS = [("th", ("t", "s"))]

# 모음 뒤에 오는 r은 한글 음역에서 **사라진다**:
#   Robert → 로버트(r 없음),  Carter → 카터,  Arthur → 아서
# 모음 앞의 r은 남는다(Laurent → 로랑). 그래서 "모음 뒤 + 자음이나 끝" 인 r만 지운 변형을
# 하나 더 만들어 둘 다 비교한다.
_CODA_R = re.compile(r"(?<=[aeiouy])r(?=[^aeiouy]|$)")

_VOWELS = "aeiou"


def phonetic_keys(text: str) -> set[str]:
    """이름 한 덩어리의 자음 뼈대들. 소리가 갈리는 글자가 있으면 여러 개가 나온다."""
    romans = {_romanize_hangul(text).lower()}
    for src, options in _AMBIGUOUS:
        expanded = set()
        for r in romans:
            for opt in options:
                expanded.add(r.replace(src, opt))
        romans = expanded
    # 한글에서 온 로마자는 초성마다 모음을 끼워 넣으므로 여기에 걸리지 않는다
    # (`로랑` → "rarang"). 즉 이 변형은 사실상 검색어(로마자) 쪽에만 생긴다.
    romans |= {_CODA_R.sub("", r) for r in romans}
    return {_key_of(r) for r in romans}


def phonetic_key(text: str) -> str:
    """대표 뼈대 하나(설명·디버깅용). 실제 비교는 `phonetic_keys`를 쓴다."""
    return sorted(phonetic_keys(text))[0]


def _key_of(roman: str) -> str:
    for src, dst in _DIGRAPHS:
        roman = roman.replace(src, dst)

    # **모음으로 시작하는 이름**은 그 사실 자체를 한 글자로 남긴다.
    # 안 그러면 `아서`가 자음 `S` 하나로 줄어 너무 짧아지고(한 글자 뼈대는 아무 이름에나
    # 걸려서 버린다), `Arthur`와 맞춰 볼 기회조차 없다. 둘 다 `VS`가 되어 맞는다.
    # 낱말 **첫머리에서만** 붙인다 — `가즈오`의 '오'까지 세면 `Kazuo`와 어긋난다.
    # 덤으로, 모음으로 시작하는 이름과 자음으로 시작하는 이름이 더는 섞이지 않는다.
    key = ["V"] if roman[:1] in _VOWELS else []
    i = 0
    while i < len(roman):
        if roman.startswith("ch", i):
            key.append("C")  # ㅊ 계열은 따로 둔다(s/j와 섞으면 너무 헐거워진다)
            i += 2
            continue
        cls = _CLASS.get(roman[i])
        if cls:
            key.append(cls)
        i += 1

    # 같은 소리가 겹쳐 나오면 하나로 (Hoffmann → HBMN, 호프만 → HBMN)
    squashed = []
    for c in key:
        if not squashed or squashed[-1] != c:
            squashed.append(c)
    return "".join(squashed)


def _parts(name: str) -> list[str]:
    """이름을 낱개로 나눈다. 가운뎃점·콤마도 구분자로 본다(`헨리 데이비드 소로`)."""
    cleaned = name.replace("·", " ").replace(",", " ").replace(".", " ")
    for mark in "-–—()[]<>《》「」『』:;/\\!?\"'":
        cleaned = cleaned.replace(mark, " ")
    return [p for p in cleaned.split() if p]


# 제목 안의 낱말을 맞출 때 요구하는 최소 뼈대 길이.
# 저자(2)보다 높게 잡는다 — 제목에는 낱말이 훨씬 많아 짧은 뼈대로는 아무 책이나 걸린다.
# `아인슈타인`은 VNSDN(5글자)이라 넉넉히 넘는다.
TITLE_MIN_KEY = 4


def title_match_quality(query: str, title: str | None) -> int | None:
    """검색어가 제목 속 **외국 고유명사의 한글 표기**와 같은 소리인지.

    `einstein` → `아인슈타인 씨의 이상한 하루`. 저자가 아니라 제목에만 이름이 들어 있는 책이 있다
    (`아인슈타인 씨의 이상한 하루`의 저자는 홍길동다).

    조사가 붙어도 된다: `아인슈타인의`는 ㅇ이라 자음이 안 붙어 그대로 VNSDN,
    `아인슈타인도`는 D가 붙어 VNSDND가 되는데 끝소리 하나 차이라 걸린다.
    """
    if not title or not query:
        return None
    best = None
    for token in _parts(query):
        token_keys = {k for k in phonetic_keys(token) if len(k) >= TITLE_MIN_KEY}
        if not token_keys:
            continue
        for part in _parts(title):
            if not has_hangul(part):
                continue  # 로마자 낱말은 글자 그대로 찾으면 된다
            for key in phonetic_keys(part):
                if len(key) < TITLE_MIN_KEY:
                    continue
                for token_key in token_keys:
                    if key == token_key:
                        return EXACT
                    if abs(len(key) - len(token_key)) <= 1 and (
                        key.startswith(token_key) or token_key.startswith(key)
                    ):
                        best = NEAR
    return best


def name_keys(name: str) -> set[str]:
    """이름의 각 낱개에 대한 자음 뼈대 모음. 2글자 미만은 너무 헐거워 버린다."""
    keys = set()
    for part in _parts(name):
        keys |= phonetic_keys(part)
    return {k for k in keys if len(k) >= 2}


# 맞은 정도. 작을수록 확실하다.
EXACT = 0  # 뼈대가 똑같다 (`Orwell` VR = `오웰` VR)
NEAR = 1  # 끝소리 하나 차이 (`Laurent` RND ~ `로랑` RN)


def token_match_quality(token: str, name: str) -> int | None:
    """검색어 한 낱말이 이 이름의 어느 낱개와 같은 소리인지. 아니면 None.

    **앞부분만 같아도 맞다고 본다**: 한글 음역은 끝소리를 자주 흘린다
    (`Laurent` → `로랑`, 끝의 t가 사라진다). 다만 끝소리 **하나** 차이까지만 본다 —
    두 글자 이상 허용하면 아무 이름이나 걸린다.
    """
    token_keys = {k for k in phonetic_keys(token) if len(k) >= 2}
    if not token_keys:
        return None
    best = None
    for key in name_keys(name):
        for token_key in token_keys:
            if key == token_key:
                return EXACT
            if abs(len(key) - len(token_key)) <= 1 and (
                key.startswith(token_key) or token_key.startswith(key)
            ):
                best = NEAR
    return best


def match_quality(query: str, name: str | None) -> int | None:
    """검색어(로마자)가 이 저자 이름(한글 표기)과 얼마나 확실히 같은 사람인지.

    검색어에 낱말이 여럿이면 **하나라도** 걸리면 맞다고 본다
    (`"Laurent Dupont"`으로 쳤는데 서재에는 성만 다르게 적혀 있을 수 있다).
    가장 확실하게 걸린 쪽을 돌려준다.
    """
    if not name or not query:
        return None
    best = None
    for token in _parts(query):
        q = token_match_quality(token, name)
        if q == EXACT:
            return EXACT
        if q is not None:
            best = q
    return best


def matches(query: str, name: str | None) -> bool:
    return match_quality(query, name) is not None


def has_hangul(text: str | None) -> bool:
    """한글이 한 글자라도 들어 있는지.

    **소리 맞추기는 한글로 적힌 저자에게만 쓴다.** 로마자로 저장된 저자
    (`John A. Smith`)는 글자 그대로 찾으면 되므로 여기까지 올 일이 없고,
    소리로까지 맞추면 `Arthur`가 `Edward`에 걸리는 식으로 잡음만 는다(실제로 그랬다).
    """
    return any(_HANGUL_BASE <= ord(ch) <= _HANGUL_LAST for ch in (text or ""))
