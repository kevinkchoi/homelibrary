"""카테고리 문자열 다루기.

책 한 권에 카테고리를 여러 개 붙일 수 있다. 저장은 컬럼 하나에 **콤마로 이어 붙인
문자열**(`"소설, 프랑스, 고전"`)로 한다. 별도 테이블로 빼지 않은 이유:

- 사용자가 화면에서도 엑셀에서도 **콤마로 직접 적는다**. 표를 나누면 엑셀 왕복 편집이 깨진다.
- 기존 845권의 값이 그대로 "키워드 1개짜리 목록"이 되어 마이그레이션이 필요 없다.
"""

SEPARATOR = ", "


def split_categories(value: str | None) -> list[str]:
    """`"소설, 프랑스"` → `["소설", "프랑스"]`. 빈 조각과 중복은 버리고 순서는 지킨다.

    중복 판정은 대소문자 무시("Fiction"과 "fiction"을 두 번 넣지 않는다).
    """
    if not value:
        return []
    names: list[str] = []
    seen: set[str] = set()
    for part in value.split(","):
        name = part.strip()
        if not name:
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        names.append(name)
    return names


def normalize(value: str | None) -> str | None:
    """저장 직전에 부르는 정리 함수. 공백/빈 조각/중복을 없애고 `", "`로 이어 붙인다.

    이걸 거치지 않으면 `"소설,소설 , "` 같은 값이 그대로 들어가 목록과 권수가 어지러워진다.
    """
    joined = SEPARATOR.join(split_categories(value))
    return joined or None


def first_category(value: str | None) -> str | None:
    """정렬 기준이 되는 첫 번째 카테고리."""
    names = split_categories(value)
    return names[0] if names else None


def replace_keyword(value: str | None, from_name: str, to_name: str | None) -> str | None:
    """목록 안의 키워드 하나만 바꾼다(`to_name`이 비면 뺀다).

    `"소설, 영미소설"`에서 영미소설→소설로 바꾸면 `"소설, 소설"`이 아니라 `"소설"`이 된다
    — `normalize`가 중복을 없애기 때문이다. 카테고리 '합치기'가 이 동작에 기대고 있다.
    """
    target = from_name.casefold()
    names = []
    for name in split_categories(value):
        if name.casefold() == target:
            if to_name:
                names.append(to_name)
        else:
            names.append(name)
    return normalize(SEPARATOR.join(names))


def has_keyword(value: str | None, name: str) -> bool:
    """목록에 그 키워드가 **통째로** 들어 있는지. `"역사소설"`은 `"소설"`을 품지 않는다."""
    target = name.casefold()
    return any(n.casefold() == target for n in split_categories(value))
