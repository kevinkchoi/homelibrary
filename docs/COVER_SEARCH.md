# 표지 검색/교체 시스템 (Cover Search) — 상세 참조

이 문서는 **책 표지를 인터넷에서 찾아 붙이는 기능** 전체를 정리한 것이다. 2026-08-18 세션에서
"이미 등록된 책의 표지 교체" 기능을 추가하고, 해외 원서 표지를 찾기 위해 소스를 여러 번 바꾼
과정(네이버 종료 → 카카오 → Google CSE 좌절 → Amazon ISBN)이 모두 여기 담겨 있다.
이 문서를 먼저 읽으면 현재 상태를 바로 파악할 수 있다.

관련 소스 파일:
- 백엔드 조회 로직: `backend/app/services/booklookup_service.py`
- 이미지 저장/검증: `backend/app/services/image_service.py`
- API 라우터: `backend/app/routers/books.py`, `backend/app/routers/scan.py`
- 프론트: `frontend/src/components/CoverPicker.jsx`, `BookForm.jsx`, `BookDetailModal.jsx`, `api/books.js`
- 키 발급 안내: [API_KEYS.md](API_KEYS.md)

---

## 1. 이 기능이 하는 일 (두 개의 진입점)

표지 검색 로직은 두 곳에서 쓰인다:

1. **사진 스캔 자동 채움** (`POST /api/scan/extract` → `lookup_book()`)
   - Claude Vision이 사진에서 제목/저자를 읽으면, 그걸로 책 정보 **한 건**을 자동 조회해 폼을 채운다.
   - 사람이 확인하지 않고 첫 결과를 그대로 쓰므로 **보수적**으로(검색어를 느슨하게 하지 않음) 동작한다.

2. **표지 후보 검색/교체** (`GET /api/books/cover-candidates` → `search_cover_candidates()`) ← 이번에 추가
   - 이미 등록된 책의 표지가 없거나 마음에 안 들 때, 제목/저자로 표지 후보를 **여러 개** 찾아
     사용자가 눈으로 보고 고른다.
   - 사람이 고르므로 **적극적**으로(검색어를 단계적으로 완화, 여러 소스 표지를 모두 수집) 동작한다.

### 사용자 UX (표지 교체)
- 책 클릭 → 상세 모달 → **[🖼 표지 바꾸기]**(또는 [내용 업데이트]) → 수정 폼
- 폼에서 **[🔍 인터넷에서 표지 찾기]** → 화면의 제목/저자로 후보를 받아 "현재 표지"와 나란히 비교
- 후보 클릭 → [업데이트] 저장. [직접 올리기](파일 업로드) / [제거]도 가능
- 스캔 검토 화면, 새책 추가(수동 입력) 화면에서도 동일하게 표지 검색 가능

---

## 2. 표지 소스 현황 (2026-08-18 기준)

| 소스 | 함수 | 키 필요 | 상태 | 용도/특징 |
|---|---|---|---|---|
| 알라딘 | `_fetch_aladin` | `ALADIN_TTB_KEY` | ✅ 사용 중 | 국내서 1순위. `cover500`으로 고화질 시도 |
| 카카오(다음) 책 | `_fetch_kakao` | `KAKAO_REST_API_KEY` | ✅ 사용 중 | 국내서 보강. `thumbnail`의 `fname`에서 원본 이미지 추출 |
| Google Books | `_fetch_google` | `GOOGLE_BOOKS_API_KEY` | ✅ 사용 중 | 해외서 1순위. **표지 없이 ISBN만 주는 경우 많음** |
| 교보문고(표지) | `_kyobo_cover_urls` | 불필요 | ✅ 사용 중 | 위 소스가 찾은 **ISBN13**으로 표지 이미지 조립. 한국 ISBN(978-89/979-11)만 |
| **Amazon(표지)** | `_amazon_cover_urls` | **불필요** | ✅ 사용 중 | **ISBN10으로 표지 조립. 해외 원서 표지의 핵심 해결책** |
| 웹 이미지(Google CSE) | `_fetch_web_images` | `GOOGLE_CSE_ID` | ⚠️ 코드만 유지 | **신규 사용자 사용 불가**(아래 참고). 키 없으면 조용히 건너뜀 |
| 네이버 책 | (제거됨) | — | ❌ 종료 | 2026-07-31 API 종료. 코드에서 완전히 제거 |

### 조회 순서 (`_search_sources`)
- 국내서/판단불가: `알라딘 → 카카오 → Google Books → (웹이미지)`
- 외국어(예: fr): `Google Books → 알라딘 → 카카오 → (웹이미지)`
- 교보·Amazon 표지는 위 소스가 찾은 **ISBN에서 파생**되므로 `_build_candidates` 단계에서 추가된다.

---

## 3. 폐기된 소스 (같은 실수 반복 방지 — 날짜와 이유)

### 네이버 책 검색 API — 2026-07-31 종료
- 앱 등록 화면 "사용 API" 목록에서 **"검색" 항목이 사라짐** = 이 API가 종료됨.
- 쇼핑·책·전문자료 검색이 완전 종료. NAVER API HUB 이관 목록에도 책 검색 없음. **신규 발급 불가.**
- → 카카오로 대체함.

### Google Custom Search JSON API (웹 이미지) — 신규 사용자 종료
- 처음엔 "구글 이미지 검색을 프로그램이 하도록" 이 API를 붙였으나, 사용자가 설정하다 두 번 막힘:
  1. **신규 엔진은 "전체 웹 검색" 불가** (2026-01-20부터). 생성 화면에 옵션 없음 → 사이트 지정만 가능.
  2. **더 근본적으로 API 자체가 신규 사용자 종료.** 같은 키로 Books API는 200인데 Custom Search만
     403 `"This project does not have the access to Custom Search JSON API"` (PERMISSION_DENIED).
     공식: *"The Custom Search JSON API is closed to new customers"* (기존 사용자만 2027-01-01까지).
- → **새 프로젝트에서는 못 씀.** 코드(`_fetch_web_images`)는 남겨뒀지만 키 없으면 건너뛴다.
  사용자 `.env`의 `GOOGLE_CSE_ID`는 무의미하니 지워도 됨.
- 대체: **Amazon ISBN 표지**(아래).

### 교훈
외부 API 상태를 **추측하지 말고** 실제로 확인할 것. 이 세션에서 네이버/구글 둘 다 "예전엔 됐지만
지금은 종료"된 케이스라, 오래된 지식으로 안내했다가 사용자를 헛돌게 했다. 새 소스 붙이기 전
`WebSearch`/`WebFetch`로 현재 상태를 확인하고, 서버에서 `httpx`로 엔드포인트 접근성(예: 키 없이
401/403 확인)을 먼저 검증할 것.

---

## 4. Amazon ISBN 표지 (해외 원서 해결책, 키 불필요) — 핵심

**문제**: 프랑스 책 `Études sur le jardin (Marie Dupont)`가 표지를 못 찾았다.
원인은 Google Books가 **책과 ISBN(9782365190527)은 찾지만 `imageLinks`가 없어서**(표지 없음),
`_build_candidates`가 표지 URL 없는 결과를 버리고 표지 있는 엉뚱한 책을 골랐던 것.

**해결**: 카탈로그가 ISBN은 주므로, 그 ISBN으로 Amazon 표지를 직접 가져온다.
- URL: `https://m.media-amazon.com/images/P/<ISBN10>.01._SCLZZZZZZZ_.jpg` (없으면 `.jpg` fallback)
- ISBN10이 필요. Google Books는 ISBN10을 직접 주기도 하고, 없으면 `_isbn13_to_10()`으로 변환
  (**978 계열만** 변환 가능. 979는 대응 ISBN10 없음).
- **플레이스홀더 주의**: Amazon은 해당 책이 없으면 200 OK로 **1x1 43바이트 이미지**를 준다.
  `image_service.is_probably_cover(data, min_side=60)`로 크기를 검사해 걸러낸다.
  `download_first_available(urls, validator=is_probably_cover)`에 validator를 주입해
  플레이스홀더면 다음 URL로 넘어가게 함(라우터 `books.py`가 validator를 넘긴다).

**성격**: Amazon P/ISBN 이미지 엔드포인트는 공식 상품광고 API가 아니라 표지 이미지 URL을 직접
받는 방식이다. 교보 표지를 ISBN으로 받는 기존 방식과 같은 성격이라, 개인 홈서버 용도로 사용.

**실측 검증(키 없이, 서버에서)**:
```
[Études sur le jardin / Marie Dupont] → amazon 20KB(Dupont판) + amazon 13KB(다른 판)
[쎄트렉아이 러시 / 박성동]  → aladin/kyobo/kakao/google (국내서 회귀 없음)
```

**한계**: 널리 알려진 교양서 제목은 Google Books가 요약/해설서를 먼저 돌려줘 그쪽 표지가 나올 수 있음
(카탈로그 랭킹 문제). 사용자가 후보에서 눈으로 고르는 구조라 치명적이진 않음.

---

## 5. 코드 구조 / 흐름

### 검색어 전략 (`booklookup_service.py`)
- `_title_variants(title)`: 제목을 단계적으로 완화. 예 `"SAMPLE TITLE: 예시 제목"` →
  `["SAMPLE TITLE: 예시 제목", "예시 제목", "SAMPLE TITLE"]`.
  알라딘·구글은 검색어 단어를 AND로 걸어서, 영문 원제/부제를 통째로 넣으면 **책이 있어도 0건**이 남.
- `_primary_author(author)`: 저자 여러 명이면 **첫 사람만**. 알라딘은 저자 2명 이상 붙이면 0건.
- `_query_variants(title, author)`: 제목변형 × (저자 포함/미포함) 조합, 최대 4개.
- 관련도(통과 판정): `_match_ratio(query, result)` = 검색어 단어 중 결과 제목/저자에 겹치는 비율(recall).
  `_STRICT_MATCH_RATIO=0.5`, `_LOOSE_MATCH_RATIO=0.01`.
- 정렬: `_closeness(query, result)` = Jaccard(검색어∩결과 / 합집합). **결과 쪽 군더더기 단어에도 벌점**.
  `_build_candidates`가 이걸로 결과를 내림차순 정렬(stable) → 정확히 같은 판이, 제목만 겹치는 다른 책
  ("...cent ans après" 같은 해설서)보다 위로 온다. Google 결과 수는 `_fetch_google` `max_results=10`.

### 표지 후보 생성 (`search_cover_candidates`)
1. `_query_variants`로 검색어 목록 생성.
2. **2단계 통과**: 먼저 strict(0.5)로 각 검색어를 시도, 아무것도 없으면 loose(0.01) 재시도.
   (처음부터 느슨하면 첫 검색어에서 엉뚱한 책이 걸려 멈춤. 예: "경영자 코칭"의 첫 검색어에서
   구글이 "다른 책"을 돌려주는 문제)
3. 각 검색어마다 `_search_sources`로 여러 소스 조회(같은 검색어는 캐시).
4. `_build_candidates`가 결과에서 후보를 만든다:
   - 결과에 자체 표지(`cover_url`)가 있으면 후보로 추가.
   - 결과에 ISBN이 있으면 `_isbn_based_cover_options`로 **교보(ISBN13) + Amazon(ISBN10)** 표지 후보 추가.
     ← **표지 URL이 없어도 ISBN만 있으면 후보가 생긴다**(프랑스 책 해결의 핵심).
   - 같은 이미지 URL 중복 제거, `limit`개까지.
5. 라우터(`books.py`의 `cover_candidates`)가 각 후보 이미지를 `download_first_available`로 내려받아
   (validator로 플레이스홀더 제거) `images_dir/tmp/`에 저장하고 `tmp/<uuid>.jpg` 경로로 응답.

### 응답에 서지정보(metadata)도 포함 (2026-08-19)
`GET /api/books/cover-candidates` 응답은 `{ candidates: [...], metadata: {...}|null }` 형태다.
응답의 top-level `metadata`(첫 후보의 서지정보)는 검색 직후 폼을 우선 보완하는 용도.
**더 중요한 건 후보마다 실린 판별 서지정보**: `CoverCandidate`에 translator/category까지 포함되어,
사용자가 특정 표지를 **고르는 순간**(`handleSelectCandidate(path, meta)`) 그 판의 출판사·연도 등으로
폼을 채운다. 여러 판(PUF판 vs 재판 vs 해설서)이 섞여 나와도 **고른 판에 맞는 정보**가 들어가는 게 핵심.

**덮어쓰기 vs 빈 칸만**(`BookForm`의 `overwriteMode = Boolean(coverCandidates)`):
- 스캔 검토 화면(coverCandidates 전달됨): 사진 인식이 **틀리게** 채웠을 수 있으므로 출판사·연도·
  카테고리·번역자를 찾은 값으로 **덮어씀**.
- 이미 등록된 책 수정/직접입력 화면: 사용자가 넣은 값을 존중해 **빈 칸만** 채움.
- 제목/저자는 어느 경우든 사용자가 방금 고친 값이라 **비었을 때만** 채운다.

### 표지 후보 이미지의 수명 (`image_service.py`)
- 후보는 `images_dir/tmp/`에 저장(`save_temp_image_bytes`).
- 사용자가 골라 저장하면 `promote_temp_image`로 정식 폴더로 이동. 옛 표지는 **새 값 설정 후** 삭제.
- 고르지 않은 후보는 `purge_old_temp_images`가 6시간 후 삭제(표지 검색할 때마다 호출, 별도 스케줄러 없음).
- 클라이언트가 보낸 경로는 `sanitize_image_path`(`^(tmp/)?[0-9a-f]{32}\.jpg$`)로 검증 → 경로 탈출 차단.

### 라우터 주의사항 (`books.py`)
- `GET /api/books/cover-candidates`는 반드시 `GET /api/books/{book_id}`보다 **먼저** 선언
  (안 그러면 "cover-candidates"가 book_id로 해석돼 422).
- `PUT /api/books/{id}`가 `cover_image_path` 폼 필드를 받아 표지 교체(이게 없어서 한동안 무시됐던 버그).

---

## 6. 환경변수 — ⚠️ 새 키 추가 시 반드시 3곳 수정

이 프로젝트의 `docker-compose.yml`은 env를 **하나씩 명시 전달**한다(`env_file: .env`가 아님).
새 API 키를 추가할 때 아래 **세 곳을 모두** 고쳐야 컨테이너에 전달된다:
1. `.env.example` — 문서화
2. `backend/app/config.py` — `Settings` 필드
3. `docker-compose.yml`의 `homelibrary-api` `environment:` — `KEY: ${KEY:-}`

**증상**: 3번을 빠뜨리면 `.env`에 키가 있어도 컨테이너 안에선 빈 문자열. 이번 세션에서 카카오·CSE 둘 다
이걸로 한 번씩 헛돌았음. 또한 **`.env`를 바꾼 뒤엔 컨테이너 재생성 필요**:
`docker compose up -d homelibrary-api`가 "Recreated"가 아니라 "Running"으로만 뜨면 env 반영 안 된 것.

### 현재 서버 `.env`에 설정된 키 (2026-08-18)
- `ANTHROPIC_API_KEY` ✅ / `ALADIN_TTB_KEY` ✅ / `GOOGLE_BOOKS_API_KEY` ✅ / `KAKAO_REST_API_KEY` ✅
- `GOOGLE_CSE_ID` — 넣었으나 **무의미**(Custom Search API 신규 종료로 403). 지워도 됨.

---

## 7. 테스트 방법 (서버에서 서비스 함수 직접 호출)

인증 없이 로직만 빠르게 검증. 컨테이너 안에서 실행:
```bash
# 특정 소스 왕복
docker compose exec -T homelibrary-api python -c \
  "from app.services.booklookup_service import _fetch_kakao; r=_fetch_kakao('쎄트렉아이 러시'); print(len(r), r[0]['title'] if r else '없음')"

# 표지 후보 전체 (인증 우회: current_user=None)
docker compose exec -T homelibrary-api python -c \
  "from app.routers.books import cover_candidates; r=cover_candidates(title='Études sur le jardin', author='Marie Dupont', limit=4, current_user=None); print([(c.source,c.title) for c in r.candidates])"
```
로컬에는 httpx/Pillow/pydantic이 없어서, 순수 로직 단위 테스트는 스텁으로 돌렸다(스크래치패드).
파싱/조립 로직은 로컬 스텁 테스트, 실제 왕복은 서버에서 확인하는 2단 검증을 썼다.

---

## 8. 배포 절차 (⚠️ 함정 포함)

**2026-08-23부터 서버도 git 저장소다 → `update.sh`로 배포한다. rsync는 폐기됐다.**
(아래 절차가 현재 유효한 유일한 배포 방법이다. 이 문서 다른 절에 rsync 언급이 남아 있으면
그건 그 시절 사고 기록이니 따라 하지 말 것.)
```bash
# 1) 로컬에서 커밋/push
git add -A && git commit -m "설명" && git push
git log --oneline -1 origin/main   # push 확인 — push 안 하면 서버가 받을 게 없다

# 2) 서버 업데이트 (변경된 컨테이너만 자동 재빌드)
ssh <사용자>@<서버> "cd <설치 폴더> && bash update.sh"
```
- 표지 관련 코드는 대부분 `backend/`이므로 `homelibrary-api`만 재빌드된다(`update.sh`가 판단).
- **서버 `.env`는 git에 없다.** 새 표지 소스용 API 키를 추가했다면 서버 `.env`도 손으로 고치고,
  `.env.example`·`config.py`·`docker-compose.yml` 3곳 규칙도 함께 지켜야 한다.

---

## 9. 남은 일 / 미해결 (TODO)

- [x] **서버 루트 stray 파일 정리** — 2026-08-23 git 저장소 전환 작업에서 삭제 완료
- [ ] 브라우저에서 실제 표지 교체 플로우 최종 확인(후보 선택 → 저장 → tmp→정식 이동 → 옛 표지 삭제)
- [ ] 스캔에서 건너뛴(skip) 사진의 `photo_image_path`/`web_image_path` 고아 파일도 tmp+purge로 정리할지 검토
- [ ] (선택) 사용자 `.env`의 무의미한 `GOOGLE_CSE_ID` 제거
- [ ] 널리 알려진 교양서 등에서 요약/해설서가 먼저 잡히는 랭킹 문제 개선 여지(현재는 사용자 선택으로 흡수)
