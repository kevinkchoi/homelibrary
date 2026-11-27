# Home Library — 상세 설계 문서

이 문서는 Home Library 프로젝트의 아키텍처, 데이터 모델, API, 프론트엔드 구조를 정리한 기술 문서입니다.
새로운 채팅/개발 세션에서 이어서 작업할 때 이 문서를 먼저 읽으면
전체 맥락을 빠르게 파악할 수 있습니다.

## 1. 전체 아키텍처

```
                         ┌─────────────────────────┐
 사용자 브라우저/휴대폰(PWA) ──▶│  homelibrary-web (Nginx) │  :8080 (호스트 노출)
                         │  - React(Vite) 빌드 산출물 │
                         │  - /api/* 는 리버스 프록시  │
                         └────────────┬─────────────┘
                                      │ (Docker 내부망 homelibrary-net)
                         ┌────────────▼─────────────┐
                         │  homelibrary-api (FastAPI)│  :8000 (내부 전용)
                         │  - JWT 인증                │
                         │  - 책 CRUD/검색/정렬/필터    │
                         │  - Excel/CSV Import/Export │
                         │  - Claude Vision 스캔 파이프라인│
                         └────────────┬─────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
          ┌─────────▼─────────┐            ┌────────────▼────────────┐
          │ homelibrary-db     │            │ homelibrary_images volume│
          │ (PostgreSQL 16)    │            │ (책 표지 이미지 파일)      │
          └────────────────────┘            └──────────────────────────┘

 외부 API 호출 (homelibrary-api → 인터넷):
   - Anthropic Claude API (책 표지 사진 → 제목/저자/번역자/출판사 텍스트 추출)
   - 알라딘 Open API (국내도서 상세정보/표지, 1순위)
   - Google Books API (해외도서 상세정보/표지, 알라딘 실패 시 폴백)
```

3개 컨테이너 + 2개 Docker volume(`homelibrary_db_data`, `homelibrary_images`) + 1개 브리지 네트워크(`homelibrary-net`)로 구성됩니다.
컨테이너 이름과 역할은 [README.md](../README.md#컨테이너-구성)에 정리되어 있습니다.

## 2. 데이터 모델

### User (`backend/app/models/user.py`)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | int, PK | |
| username | string(50), unique | 로그인 아이디 |
| email | string(255), unique | |
| password_hash | string(255) | bcrypt 해시 (passlib) |
| is_admin | boolean, default false | 맨 처음 가입한 계정이 자동으로 `true` (`routers/auth.py`의 `register()`) |
| created_at | datetime | |

### Book (`backend/app/models/book.py`)

| 필드 | 타입 | 설명 |
|---|---|---|
| id | int, PK | |
| title / author / publisher | string, required | |
| pub_year | int, nullable | |
| shelf_location | string, nullable | 책꽂이 위치 |
| category | string, nullable | |
| translator | string, nullable | 번역서일 경우 |
| original_publisher | string, nullable | 원서 출판사 |
| original_pub_year | int, nullable | 원서 출판연도 |
| cover_image_path | string, nullable | `homelibrary_images` 볼륨 내 파일명 (UUID.jpg) |
| comment | text, nullable | |
| created_at / updated_at | datetime | |
| owner_id | int, nullable, FK → users.id (`ON DELETE SET NULL`) | 책을 등록한 사용자. 계정이 삭제돼도 책은 남고 이 값만 NULL이 됨(가족 공용 자원이므로) |

책은 소유자와 무관하게 **로그인한 모든 계정이 전체 목록을 보고 CRUD할 수 있는 공유 자원**입니다
(가족/구성원 공용 서재를 가정한 설계 — `routers/books.py`의 어떤 엔드포인트도 `owner_id`로 필터링하지 않음).
`is_admin` 권한은 오직 "사용자 계정 관리"(목록 조회/삭제/관리자 지정)에만 적용됩니다. 자세한 내용은 아래
"사용자 관리" 절 참고.

마이그레이션은 Alembic으로 관리하며 스키마 리비전은 `backend/alembic/versions/`에 있습니다
(`0001_initial` → `0002_admin_role`). 모델을 바꾸면
`docker exec homelibrary-api alembic revision --autogenerate -m "설명"` 으로 새 리비전을 만드세요.

## 3. 백엔드 API 레퍼런스

모든 엔드포인트(회원가입/로그인 제외)는 `Authorization: Bearer <JWT>` 헤더가 필요합니다.

### 인증 (`app/routers/auth.py`)
| Method | Path | 설명 |
|---|---|---|
| POST | `/api/auth/register` | 회원가입, JSON `{username, email, password}` → 토큰 반환 |
| POST | `/api/auth/login` | 로그인, `application/x-www-form-urlencoded` (`username`, `password`) → 토큰 반환 |
| GET | `/api/auth/me` | 현재 로그인한 사용자 정보 |

### 사용자 관리 — 관리자 전용 (`app/routers/users.py`)
`auth/deps.py`의 `require_admin` 의존성으로 보호되며, `is_admin=False` 계정이 호출하면 `403`.

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/users` | 전체 사용자 목록 (가입순) |
| DELETE | `/api/users/{id}` | 계정 삭제. 자기 자신 삭제 불가, 마지막 남은 관리자 삭제 불가. 그 사람이 등록한 책은 `owner_id`만 NULL로 바뀌고 유지됨 |
| PUT | `/api/users/{id}/admin` | JSON `{"is_admin": true\|false}` — 관리자 지정/해제. 마지막 남은 관리자는 스스로 해제 불가 |

### 책 (`app/routers/books.py`)
| Method | Path | 설명 |
|---|---|---|
| GET | `/api/books` | 목록. 쿼리: `sort_by`(title/author/publisher/pub_year/category/shelf_location/created_at), `order`(asc/desc), `title`/`author`/`publisher`/`category`(부분일치 필터), `skip`, `limit` |
| GET | `/api/books/search?q=` | 제목/저자/출판사/번역자 통합 검색 (최대 100건) |
| GET | `/api/books/cover-candidates?title=&author=&limit=` | 인터넷(알라딘·Google Books·교보문고)에서 표지 후보를 최대 `limit`(기본 3, 최대 4)개 찾아 내려받고 `{"candidates": [{image_path, source, title, author, publisher, pub_year}]}` 반환. `image_path`는 `tmp/<uuid>.jpg` 형태의 임시 경로 |
| GET | `/api/books/{id}` | 상세 |
| POST | `/api/books` | 생성 (multipart/form-data: 필드 + `cover_image`(파일, 선택) 또는 `cover_image_path`(스캔/표지검색에서 이미 저장된 파일명, 선택)) |
| PUT | `/api/books/{id}` | 수정 (동일 form 형식 + `cover_image_path`로 표지 교체, `remove_image=true`로 표지 삭제) |
| DELETE | `/api/books/{id}` | 개별 삭제 |
| DELETE | `/api/books/bulk` | 다중 삭제, JSON `{"ids": [1,2,3]}` |

`GET /api/books`, `GET /api/books/cover-candidates`, `DELETE /api/books/bulk` 라우트는
`/api/books/{book_id}` 보다 먼저 등록되어야 "search"/"cover-candidates"/"bulk"가 동적 경로에
잘못 매칭되지 않습니다 (FastAPI는 등록 순서대로 매칭).

**표지 후보 이미지의 수명**: 후보는 `images_dir/tmp/`에 저장되며, 사용자가 골라 저장하면
`promote_temp_image()`로 정식 폴더로 옮겨집니다. 고르지 않은 후보는 다음 표지 검색 때 도는
`purge_old_temp_images()`가 6시간 후 삭제합니다. 클라이언트가 보낸 `cover_image_path`는
`sanitize_image_path()`(`^(tmp/)?[0-9a-f]{32}\.jpg$`)로 검증한 뒤에만 사용합니다.

### Import/Export (`app/routers/import_export.py`)
| Method | Path | 설명 |
|---|---|---|
| GET | `/api/export/excel` | 전체 책 + 표지 이미지를 zip(`books.xlsx` + `images/`)으로 다운로드. xlsx에는 셀에 표지 썸네일이 임베드됨 |
| GET | `/api/export/csv` | 동일하되 `books.csv` 포함 |
| POST | `/api/import/excel` | zip(images 포함) 또는 단독 `.xlsx` 업로드 → 책 일괄 생성 |
| POST | `/api/import/csv` | zip 또는 단독 `.csv` 업로드 → 책 일괄 생성 |

Import는 항상 **새 책으로 추가**하며(기존 행 업데이트 아님), `title`/`author`/`publisher`가 비어있는 행은 건너뜁니다.
zip 안의 `image_filename` 컬럼과 `images/` 폴더의 파일명이 일치해야 표지가 함께 들어옵니다.

### 스캔 (`app/routers/scan.py`)
| Method | Path | 설명 |
|---|---|---|
| POST | `/api/scan/extract` | multipart `photo` 파일 업로드 → 아래 파이프라인 실행 후 `ScanResult` JSON 반환 (DB 저장은 안 함, 프론트에서 확인 후 `/api/books`로 별도 생성) |

**스캔 파이프라인 순서** (`app/services/vision_service.py`, `app/services/booklookup_service.py`):
1. 업로드된 사진을 base64로 Claude(`claude-sonnet-5`)에 전달, `title/author/translator/publisher/category`
   와 함께 표지 글의 주 언어(`language`, ISO 639-1 추정치: `ko`/`fr`/`en` 등)를 JSON으로 추출
2. **언어에 따라 조회 순서를 다르게 함** (`booklookup_service.lookup_book(query, language)`):
   - 한국어(`ko`) 또는 언어 판단 불가: 알라딘 `ItemSearch` 우선 조회, 실패 시 Google Books 폴백 (기존과 동일)
   - 한국어가 아님(예: `fr`): **Google Books를 해당 언어(`langRestrict`)로 먼저 조회** — 알라딘은
     한국 서점 카탈로그라 프랑스어 등 원서 제목을 넣어도 전혀 무관한 한국 책을 "매칭됨"으로 반환하는
     경우가 많아, 비한국어 책에서 알라딘을 먼저 쓰면 오탐이 잦았음. Google Books가 실패하면 혹시
     한국에 정식 번역 출간됐을 가능성을 보고 알라딘도 한 번 더 시도, 그래도 안 되면 언어 제한 없는
     Google Books로 마지막 시도
   - 두 소스 모두 `_looks_relevant()`로 쿼리와 결과 제목/저자 사이 최소한의 단어 겹침을 확인해 완전히
     무관한 결과를 걸러냄 (알라딘의 느슨한 검색으로 인한 오탐 완화 목적, 완벽한 검증은 아님)
3. 조회 결과의 표지 URL을 서버가 다운로드해 `homelibrary_images`에 저장. **사용자가 촬영한 원본 사진은
   표지로 절대 사용하지 않음** — 아무 소스에서도 표지를 못 찾으면 `cover_image_path`는 `null`로
   반환되고, 사용자가 검토 화면(`ScanBatchReview`)에서 직접 이미지를 올릴 수 있음
4. 최종 필드(제목/저자/번역자/출판사/카테고리/연도/표지 경로)를 프론트에 반환 → 스캔 검토 화면에 프리필

> ⚠️ **Google Books는 API 키 없이 쓰면 익명 요청 공용 할당량이 금방 소진**되어(`429 rateLimitExceeded`)
> 비한국어 책 조회가 알라딘 폴백으로 밀려 부정확해질 수 있음. 프랑스어 등 비한국어 책을 안정적으로
> 찾으려면 [API_KEYS.md](API_KEYS.md)에서 `GOOGLE_BOOKS_API_KEY`를 발급받아 `.env`에 넣는 것을 권장
> (2026-08-02 기준 이 서버는 무료 익명 할당량이 소진된 상태로 확인됨).

### 이미지 서빙
`GET /api/images/{filename}` — `StaticFiles`로 `homelibrary_images` 볼륨을 직접 서빙 (`app/main.py`).

### 헬스체크
`GET /api/health` — `{"status": "ok"}`, docker-compose healthcheck 및 Nginx 뒤에서 배포 확인용.

## 4. 프론트엔드 구조

React 18 + Vite 5, 라우팅은 `react-router-dom`. **빌드 파이프라인 방식**을 택했기 때문에
"기능별 개별 파일 업데이트"는 *소스 파일 단위로 수정 → `docker compose build homelibrary-web` 재빌드* 로 이뤄집니다.

```
src/
├── api/            # 기능별 백엔드 호출 모듈 (client, auth, books, importExport, scan, users)
├── context/         # AuthContext — 로그인 상태, JWT localStorage 관리
├── pages/            # 라우트 단위 화면
│   ├── Login / Register
│   ├── Home                 # "홈" 메뉴 — 목록/정렬/필터
│   ├── BookSearch            # "책 찾기" 메뉴 — 상단 검색창 결과
│   ├── AddBook                # "새책 추가" 메뉴 — 수동 입력 + 스캔 연동
│   ├── Scan                    # 카메라 캡처 → /api/scan/extract 호출 → AddBook으로 이동
│   ├── Admin                    # "관리" 메뉴 랜딩
│   ├── AdminManageBooks           # 책 개별/다중 삭제
│   ├── AdminImportExport           # Import/Export
│   └── AdminUsers                   # 사용자 관리 (관리자 계정에게만 메뉴 노출, 백엔드도 403으로 이중 보호)
└── components/       # 재사용 UI (NavBar, SearchBox, BookTable, BookFilterBar,
                       #  BookDetailModal, BookForm, ImageUploader, CameraCapture, ConfirmDialog)
```

### 인증 흐름
- 로그인/회원가입 성공 시 JWT를 `localStorage`(`hl_token`)에 저장, axios 인터셉터(`api/client.js`)가 매 요청에 `Authorization` 헤더 부착
- 401 응답을 받으면 토큰 삭제 후 `/login`으로 리다이렉트
- `App.jsx`의 `ProtectedLayout`이 `useAuth().isAuthenticated`를 확인해 비로그인 접근을 `/login`으로 리다이렉트

### 새책 추가 ↔ 스캔 연동 (여러 권 일괄 처리)
`Scan.jsx`는 **[📷 카메라로 사진찍기] / [🖼 사진 파일 선택]** 두 버튼을 보여줍니다.

- **카메라 경로**: `CameraCapture.jsx`는 `getUserMedia`(실시간 미리보기)를 쓰지 않습니다 — iOS
  Safari/Chrome(WebKit)에서 HTTPS가 아닌 origin은 애초에 거부하는 경우가 많고, HTTPS(Tailscale)로도
  권한은 됐지만 `canvas.toBlob()` 캡처 자체가 불안정했음(2026-08-02~04에 순서대로 시도하고 겪은 문제).
  대신 처음부터 `<input type="file" capture="environment">`(보안 컨텍스트 불필요, 기기 카메라 앱을
  직접 열어 한 장씩 촬영)만 사용 — 여러 장을 연속으로 찍어 스트립에 모았다가(개별 삭제 가능) `[완료]`를
  누르면 Blob 배열을 한 번에 상위로 전달
- **파일 선택 경로**: `<input type="file" multiple accept="image/*">` (mobile에서 `capture` 속성을 쓰지 않아
  카메라를 강제하지 않고 사진 보관함이 열림 — iOS는 이 안에도 "사진 찍기" 옵션을 포함하므로 사실상
  `getUserMedia` 없이 촬영하는 가장 안정적인 경로) — 여러 장을 한 번에 선택 가능

이후 `Scan.jsx`가 각 사진마다 순차적으로 `extractFromPhoto()`를 호출(진행률 표시), 완료되면
`navigate("/add", { state: { scanResults: [...] } })`로 **배열**을 전달합니다. `AddBook.jsx`는
`scanResults`가 있으면 `ScanBatchReview` 컴포넌트를 렌더링 — 사진마다 카드 하나씩, `BookForm`으로
프리필된 내용을 확인/수정 후 개별적으로 `[추가]`(저장) 또는 `[취소]`(건너뛰기) 할 수 있습니다.
추출 실패한 사진도 카드는 그대로 남아 빈 폼으로 수동 입력할 수 있게 함.
스캔 표지는 재업로드 없이 `cover_image_path`로만 전달되어 최종 `POST /api/books`에 실립니다
(`app/routers/books.py`의 `create_book`이 `cover_image`(파일) 우선, 없으면 `cover_image_path`(문자열) 사용).

### 표지 후보: 내 사진(자동 크롭) vs 인터넷 이미지 비교 선택
알라딘/Google Books 조회가 다른 책과 잘못 매칭되는 경우가 있었음(특히 외국어 책 — "프랑스어판을
스캔했는데 전혀 다른 책 표지가 올라온다"는 사용자 피드백). 그래서 스캔 결과를 인터넷 이미지로
자동 대체하지 않고, **촬영한 사진 자체를 기본 표지로 쓰면서 인터넷 이미지는 선택 가능한 대안으로만
제공**하도록 바꿈:

- `image_service.save_cropped_photo()`: 네 모서리 색상을 배경으로 추정해 `ImageChops.difference`로
  배경과 다른 영역(=책)의 바운딩박스를 찾아 잘라냄(`_trim_border`). 단색 배경(책상/바닥 등)에서 책이
  프레임을 크게 차지할 때 잘 동작하며, 감지 실패 시(잘린 영역이 너무 작으면) 원본을 그대로 사용
- `POST /api/scan/extract`가 항상 `photo_image_path`(자동 크롭된 내 사진)를 채우고, 조회에 성공하면
  `web_image_path`(알라딘/Google Books 이미지)도 별도로 채움. **기본 선택값은 `photo_image_path`**
  (`cover_image_path = photo_image_path`)
- 프론트 `CoverPicker.jsx`: 현재 선택된 이미지 옆에 **[업데이트]** 버튼을 두고, 누르면 "내 사진"과
  "인터넷에서 찾은 이미지"를 나란히 보여줘 클릭으로 고를 수 있음(둘 다 없으면 버튼도 안 보임). 직접
  다른 파일을 올리거나 표지를 제거하는 것도 그대로 가능. `BookForm`이 `coverCandidates` prop을 받으면
  기존 `ImageUploader` 대신 `CoverPicker`를 렌더링함 — 이 prop은 `ScanBatchReview`에서만 전달됨

### 이미 등록된 책의 표지 교체 (2026-08-18)
표지가 없거나 마음에 안 드는 책의 표지를 나중에 바꿀 수 있어야 한다는 요청에 따라, 위 비교선택 UI를
스캔 전용에서 **범용**으로 확장했습니다.

- `CoverPicker`는 이제 `baseCandidates`(처음부터 있는 후보들) + `onSearch`로 가져온 검색 결과를 한
  목록으로 보여줌. 스캔 화면의 "내 사진 vs 인터넷 이미지"는 이 구조의 특수한 경우
- `BookForm`에 `allowCoverSearch` prop → `[🔍 인터넷에서 표지 찾기]` 버튼 노출.
  **화면에 입력돼 있는 제목/저자**로 `GET /api/books/cover-candidates`를 호출하므로, 제목을 고쳐 넣은
  직후(저장 전)에도 그 값으로 검색됨. 적용 위치: 책 상세의 `[내용 업데이트]`/`[🖼 표지 바꾸기]` 화면,
  `[새책 추가]` 수동 입력 화면, 스캔 검토 화면
- 후보는 "현재 표지"와 나란히 놓여 되돌리기 쉬움. 저장 시 `PUT /api/books/{id}`에 `cover_image_path`로
  실려 가고, 서버가 tmp → 정식 폴더로 옮긴 뒤 **옛 표지 파일을 삭제**(순서 주의: 새 값을 설정한 다음에
  삭제해야 중간 실패 시 표지가 사라지지 않음)

#### 표지 검색이 실패하지 않게 하는 장치 (`search_cover_candidates`)
알라딘·Google Books는 검색어의 **모든 단어를 AND**로 걸어서, 제목을 화면에 적힌 그대로 넣으면
책이 있어도 0건이 나옵니다(실제 사례: `"SAMPLE TITLE: 예시 제목"` → 0건,
`"쎄트렉아이 러시"` → 1건). 그래서:

1. **검색어 완화 사다리** — 원제목 → 부제/원제를 잘라낸 조각(한글 조각 우선) 순으로 최대 4개 검색어를
   만들고, 앞의 것이 실패할 때만 다음으로 넘어감
2. **저자는 첫 사람만** — 알라딘은 저자를 두 명 이상 붙이면 0건을 돌려줌(실측)
3. **2단계 통과** — 1차는 검색어 단어의 50% 이상 일치하는 결과만, 아무것도 없으면 2차에서 한 단어라도
   겹치면 채택. 처음부터 느슨하면 첫 검색어에서 엉뚱한 책에 걸려 멈춰버리기 때문
4. `QueryType`은 **Title 유지** — `Keyword`로 바꾸면 오히려 0건이 되는 경우가 있음(실측)
5. 결과는 검색어별로 캐시 → 외부 호출은 최대 4(검색어)×2(소스) = 8회

**교보문고는 검색이 아니라 표지 이미지 소스로만** 씁니다. 공개 검색 API가 없고 검색 페이지는 JS
렌더링이라 파싱이 불가능하지만, ISBN13으로 표지 URL을 조립하는 것은 가능하기 때문입니다
(`https://contents.kyobobook.co.kr/sih/fit-in/800x0/pdt/{ISBN13}.jpg`). 즉 알라딘·구글이 찾은 책의
**다른 표지 버전**으로 후보에 추가됩니다. 나무위키는 문서가 없는 책이 대부분이고 JS 렌더링 +
난독화된 클래스명이라 표지 출처로 부적합해 넣지 않았습니다.

표지 화질: 알라딘은 API가 주는 `cover200` 대신 `cover500`을 먼저 시도, 구글은 `edge=curl`(말림 효과)을
빼고 `zoom=0`을 먼저 시도하며, 없으면 원래 URL로 fallback합니다(`download_first_available`).

### 업로드 이미지 형식 정규화 (HEIC 포함)
iPhone 기본 촬영 포맷인 **HEIC/HEIF**는 (1) Pillow가 기본 빌드로 열지 못하고 (2) Claude Vision이
아예 받지 않는 형식(jpeg/png/gif/webp만 지원)이라, 데스크톱에서 HEIC를 업로드하면 스캔이 전부
실패했음. 그래서 **업로드된 이미지는 형식과 무관하게 서버에서 한 번 정규화**한 뒤 사용함:

- `pillow-heif`를 설치하고 `image_service` 로드 시 `register_heif_opener()` 호출 → Pillow가 HEIC 디코딩
- `image_service.open_image()`가 모든 진입점의 공통 입구. `ImageOps.exif_transpose()`로 EXIF 회전을
  실제 픽셀에 반영(세로 사진이 눕는 문제 방지)하고, 열 수 없으면 `UnsupportedImageError` → **400**
- `image_service.to_jpeg_bytes()`로 JPEG 변환 후 Claude에 전달. 브라우저가 붙인 `content_type`을
  그대로 믿고 넘기지 않음(`image/heic`이면 API가 거부)
- 해상도 상한이 두 개인 이유: 저장용 `MAX_DIMENSION=1600`, **분석용 `VISION_MAX_DIMENSION=2576`**.
  분석용을 저장용까지 낮추면 출판사/옮긴이 같은 작은 글씨 인식률이 떨어짐. 2576px는 Claude가 그대로
  받는 최대치(그 이상은 서버에서 축소됨)
- 표지 직접 업로드(`books.py`)도 같은 경로를 쓰므로 HEIC 표지 업로드가 함께 지원됨
- 프론트는 파일 선택 `accept`에 `.heic/.heif`를 명시해야 함(브라우저에 따라 `image/*`만으로는 HEIC가
  선택 불가). 또한 **크롬/파이어폭스는 HEIC를 화면에 렌더링하지 못하므로** 미리보기는 서버가 저장한
  JPEG(`photo_image_path`)를 우선 사용하고, 실패 시 안내 문구로 대체함

### 표지 자동 검색 (직접 입력 시에도)
스캔이 아니라 "새책 추가" 폼에 제목/저자만 직접 타이핑해서 추가하는 경우에도, 사진을 첨부하지 않았다면
백엔드가 자동으로 알라딘/Google Books에서 표지를 찾아 채워줍니다 — `books.py`의 `_auto_cover_lookup()`이
`create_book`(표지 파일도 `cover_image_path`도 없을 때)과 `update_book`(아직 표지가 없는 책을 수정할 때)
양쪽에서 호출됩니다. 사용자가 직접 올린 이미지는 절대 덮어쓰지 않음(이미 표지가 있으면 호출 자체를 안 함).

### 사용자 관리 / 가족 공유
모든 계정은 같은 책 목록을 보고 CRUD할 수 있습니다(가입만 하면 바로 공유 서재 사용 가능). `is_admin`은
오직 "사용자 계정 관리" 화면 노출 여부에만 관여 — `Admin.jsx`가 `useAuth().user.is_admin`을 확인해
"사용자 관리" 카드를 조건부로 보여주고, 실제 접근 제어는 백엔드의 `require_admin`(403)이 최종적으로 보장합니다.
맨 처음 가입한 계정이 자동으로 관리자가 되며, 이후 관리자가 다른 계정을 관리자로 지정/해제하거나 삭제할 수
있습니다(마지막 관리자는 보호됨). 자세한 배경/검증 내역은 개발 기록(비공개)에 있습니다.

### PWA
`vite-plugin-pwa`(`generateSW` 모드)로 `manifest.webmanifest`/`sw.js`를 빌드 시 자동 생성.
`workbox.runtimeCaching`으로 `/api/images/*`만 CacheFirst로 캐시하고, `/api/*` 나머지는 캐시하지 않도록
`navigateFallbackDenylist`로 제외해 인증/데이터 API가 오프라인 캐시로 꼬이지 않게 함.
아이콘(`frontend/public/icons/icon-192.png`, `icon-512.png`)은 현재 placeholder(단색 배경 + 사각형)이므로
실제 배포 전에 디자인 아이콘으로 교체 권장.

## 5. 알려진 제한사항 / 향후 개선 아이디어

- JWT를 `localStorage`에 저장 — XSS에 취약할 수 있어 공인 인터넷에 노출할 경우 HTTPS 필수, 가능하면 httpOnly 쿠키 방식으로 전환 검토
- Import는 항상 "새로 추가"이며 기존 행을 갱신하는 업서트 기능은 없음 (중복 방지 로직 없음)
- 책은 의도적으로 전역 공유(누구나 CRUD 가능) — 가족 공용 서재를 가정한 설계이며 "책 단위 권한"은 없음. 계정 관리만 관리자 전용
- 표지 이미지 삭제 시 실제 파일은 지우지만 별도 정리(orphan cleanup) 배치는 없음
- PWA 아이콘이 placeholder — 실제 아이콘 이미지로 교체 필요
- 카메라는 `getUserMedia`(실시간 미리보기)를 아예 쓰지 않고 `<input capture="environment">`(기기
  카메라 앱 직접 실행)만 사용 — HTTPS 없이도 동작하지만, 그 대신 실시간 미리보기·셔터 UX는 없음(한 장
  찍을 때마다 카메라 앱이 열렸다 닫힘). Tailscale HTTPS 설정([docs/INSTALL.md](INSTALL.md) 7단계)은
  여전히 유효하고 권장되지만, 카메라 기능 자체의 필수 조건은 아니게 됨
