# API 키 발급 가이드

책 표지 사진 스캔 기능(`📷 사진으로 스캔`)을 쓰려면 아래 두 키가 필요합니다. 두 키 모두 없어도
나머지 기능(직접 입력, 목록/검색/정렬/필터, Import/Export 등)은 정상 동작합니다.

## 1. Anthropic API 키 (Claude Vision — 사진에서 글자 읽기)

사진 속 책 제목·저자·번역자·출판사를 읽어내는 데 사용됩니다.

1. https://console.anthropic.com 접속 후 회원가입/로그인
   - Claude.ai(일반 채팅 구독)와는 별개의 계정 체계입니다. Console 계정이 없다면 새로 가입해야 합니다.
2. 왼쪽 메뉴에서 **Settings → API Keys** 이동 (또는 https://console.anthropic.com/settings/keys)
3. **Create Key** 클릭 → 키 이름 입력(예: `homelibrary`) → 생성
4. 생성된 키(`sk-ant-...`로 시작)를 복사 — **이 화면을 벗어나면 다시 볼 수 없으니 바로 복사**
5. **Billing** 메뉴에서 결제 수단을 등록하고 크레딧을 충전해야 실제 호출이 됩니다 (Claude API는 사용량 기반 종량 과금이며, Claude.ai 구독료와는 별도)
6. 서버의 `.env` 파일에서:
   ```
   ANTHROPIC_API_KEY=sk-ant-여기에-복사한-키
   ```
7. 반영: `docker compose up -d homelibrary-api` (또는 `docker compose restart homelibrary-api`)

> 스캔 1회당 이미지 1장을 Claude에 전달하는 정도라 비용은 매우 낮은 편이지만, 사용량이 걱정된다면
> Console의 **Usage** 탭에서 호출량/비용을 모니터링할 수 있습니다.

## 2. 알라딘 Open API TTBKey (국내도서 상세정보/표지)

Claude가 읽어낸 제목/저자로 알라딘에서 정확한 출판사·출판연도·표지 이미지를 찾아옵니다. 무료입니다.

1. https://www.aladin.co.kr 알라딘 회원가입/로그인 (알라딘 온라인서점 일반 회원이면 됩니다)
2. Open API 신청 페이지 접속: https://www.aladin.co.kr/ttb/wblog_manage.aspx
   (알라딘 메인 하단 **"Open API"** 링크로도 찾아갈 수 있습니다)
3. 처음이면 **"TTB(Total To Business) 계정 만들기"** 또는 **API 사용 신청**을 진행
   - 사용 목적 등 간단한 정보 입력 (개인 프로젝트/비상업적 용도로 기재하면 됩니다)
4. 신청 완료 후 발급된 **TTBKey** 문자열을 확인 (보통 즉시 발급되며, `ttbabcd1234001` 같은 형식)
5. 서버의 `.env` 파일에서:
   ```
   ALADIN_TTB_KEY=발급받은-TTBKey
   ```
6. 반영: `docker compose up -d homelibrary-api`

> 알라딘 키가 없거나 검색 결과가 없으면 자동으로 Google Books API로 폴백을 시도합니다(국내도서는 정확도가 낮을 수 있음).

## 3. Google Books API 키 (한국어 책만 있다면 선택, 외국어 원서가 있다면 사실상 필수)

없어도 동작하지만, 키 없이 쓰는 익명 요청은 전 세계 사용자가 같이 쓰는 공용 할당량이라 금방
소진되어 `429` 오류가 자주 납니다. 특히 **알라딘은 한국 서점 카탈로그라 프랑스어 등 외국어 원서를
찾지 못하고, 이 경우 Google Books가 사실상 유일한 조회 경로**라서 프랑스어/영어 등 외국어 책을
스캔할 계획이라면 키를 꼭 발급받으세요.

1. https://console.cloud.google.com 접속 → 프로젝트 생성(또는 기존 프로젝트 선택)
2. **API 및 서비스 → 라이브러리**에서 "Books API" 검색 후 **사용 설정**
3. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키**
4. 발급된 키를 `.env`의 `GOOGLE_BOOKS_API_KEY`에 입력

## 4. 카카오(다음) 책 검색 REST API (국내도서 보강, 선택사항)

알라딘이 못 찾는 국내서를 한 번 더 찾아봅니다. 표지 교체(`🔍 인터넷에서 표지 찾기`)와 사진 스캔
양쪽에서 쓰이며, **무료**입니다. 키가 없으면 이 소스만 조용히 건너뜁니다.

> **왜 네이버가 아니라 카카오인가**: 네이버 책 검색 API는 **2026-07-31에 종료**되어 더 이상
> 신규 발급이 불가능합니다(애플리케이션 등록 화면의 "사용 API" 목록에서 "검색"이 사라진 이유).
> 카카오(다음) 책 검색 API가 현재 살아있는 대체 소스라 이걸로 연동했습니다.

1. https://developers.kakao.com 접속 → 오른쪽 위 **로그인** (카카오 계정 그대로 사용)
2. 상단 **내 애플리케이션 → 애플리케이션 추가하기**
3. 팝업에서 입력 (아무 값이나 가능, 나중에 알아볼 이름이면 됩니다):
   - **앱 이름**: `HomeLibrary`
   - **사업자명(회사명)**: 개인 이름이나 `personal` 등 아무거나
   - 저장
4. 만들어진 앱을 클릭 → 왼쪽 메뉴 **앱 설정 → 앱 키**로 이동
5. 거기 있는 **REST API 키**를 복사 (`a1b2c3...` 형태의 32자 문자열)
   - ⚠️ REST API 키입니다. "네이티브 앱 키"/"JavaScript 키"/"Admin 키"가 아님
   - **책 검색(Daum 검색) API는 별도 활성화나 플랫폼 등록이 필요 없습니다** — 키만 있으면 바로 호출됩니다
6. 서버의 `.env` 파일에 **직접** 입력 (키는 서버 `.env`에만 두고 git에는 절대 커밋하지 않습니다):
   ```
   KAKAO_REST_API_KEY=복사한-REST-API-키
   ```
7. 반영: `docker compose up -d homelibrary-api`

> 키를 넣은 뒤 잘 붙었는지는 아래 명령으로 확인할 수 있습니다:
> ```bash
> docker compose exec -T homelibrary-api python -c "from app.services.booklookup_service import _fetch_kakao; r=_fetch_kakao('쎄트렉아이 러시'); print(len(r), r[0]['title'] if r else '결과 없음')"
> ```

## 5. 해외 원서 표지 — Amazon ISBN 표지(자동, 키 불필요) + (구) Google 프로그래머블 검색

**문제**: 알라딘·카카오·Google Books는 모두 *책 카탈로그*라, 카탈로그에 표지 이미지가 없는
책은 못 찾습니다. 특히 해외 원서·학술서는 그런 경우가 많습니다. 실제 예:
`Études sur le jardin (Marie Dupont)`는 Google Books가 책 자체(**ISBN까지**)는 찾지만
표지 이미지가 없어서 이 앱이 표지를 못 붙였습니다.

**해결(2026-08-18, 키 불필요·자동)**: 카탈로그가 ISBN은 찾아주므로, 그 **ISBN으로 Amazon 표지
이미지**(`m.media-amazon.com/images/P/<ISBN10>.jpg`)를 가져옵니다. 별도 키·설정이 전혀 필요 없고,
Amazon이 파는 책이면 표지가 나옵니다(위 프랑스 책도 이제 자동으로 표지가 붙습니다). Amazon에 없는
책이면 1x1 플레이스홀더가 오는데, 서버가 크기로 걸러냅니다. **여기까지는 아무 것도 안 해도 됩니다.**

### (선택) Google 프로그래머블 검색 — ⚠️ 대부분 사용 불가
> **Google이 Custom Search JSON API를 신규 사용자에게 닫았습니다**
> ("The Custom Search JSON API is closed to new customers", 기존 사용자만 2027-01-01까지).
> 그래서 **새로 만든 Google Cloud 프로젝트에서는 이 API를 켜도 403(PERMISSION_DENIED)** 이 납니다.
> 새 프로젝트라면 **이 소스는 쓸 수 없습니다** — `GOOGLE_CSE_ID`는 넣어도 조용히
> 무시되니 그냥 비워두면 됩니다(위 Amazon 표지로 해외 원서는 이미 커버됩니다).
> 아래 절차는 예전에 whole-web 엔진을 갖고 있던 기존 사용자만 참고용으로 남겨둡니다.

발급은 두 부분입니다 — (A) 검색엔진 ID(cx)를 만들고, (B) API 키를 준비합니다.

### A. 검색엔진 ID(cx) 만들기
> ⚠️ **2026-01-20부터 신규 엔진은 "전체 웹 검색(Search the entire web)"을 쓸 수 없습니다.**
> (기존에 만든 whole-web 엔진만 2027-01-01까지 유지). 그래서 생성 화면에 그 옵션이 없습니다.
> 대신 **표지가 잘 올라오는 사이트들을 직접 지정**합니다(최대 50개 도메인). 웹 전체보다 잡음이
> 적어 오히려 낫습니다. 나중에 도메인을 더하거나 뺄 수 있습니다.

1. https://programmablesearchengine.google.com 접속 → 로그인 → **추가(Add)**
2. **이름**: `Book Image Search` (아무거나)
3. **Select sites or pages to search** 칸에 아래 도메인을 하나씩 입력하고 **Add**를 반복합니다.
   `*.도메인` 형태면 그 도메인 전체가 대상이 됩니다. **최소한 첫 줄(openedition)은 꼭 넣으세요**
   — 실제로 못 찾던 프랑스 책(`Études sur le jardin`) 표지가 여기 있습니다:
   ```
   *.openedition.org
   *.babelio.com
   *.decitre.fr
   *.fnac.com
   *.cairn.info
   *.amazon.fr
   *.amazon.com
   *.media-amazon.com
   *.goodreads.com
   *.openlibrary.org
   books.google.com/*
   *.wikimedia.org
   en.wikipedia.org/*
   fr.wikipedia.org/*
   *.worldcat.org
   ```
   (국내서는 알라딘·카카오·교보가 이미 처리하므로 위 목록은 해외 원서 위주입니다. 원하면
   `image.aladin.co.kr`, `contents.kyobobook.co.kr` 등을 더 넣어도 됩니다)
4. **Search settings**에서 **Image search**를 **켬(ON)** — 스크린샷처럼 이미 켜져 있으면 그대로 두세요
5. **Create(만들기)** 클릭
6. 만든 엔진 → **Overview** 또는 **Basics**에서 **검색엔진 ID(Search engine ID)** 문자열을 복사
   (이게 `GOOGLE_CSE_ID`)

### B. API 키 준비 (3절 Google Books 키를 재사용하면 편함)
1. https://console.cloud.google.com → 3절에서 Books API를 켠 그 프로젝트 선택
2. **API 및 서비스 → 라이브러리**에서 **"Custom Search API"** 검색 → **사용 설정**
3. 키는 **3절에서 발급한 `GOOGLE_BOOKS_API_KEY`를 그대로 재사용**할 수 있습니다
   (키에 API 제한을 걸어두지 않았다면 같은 프로젝트의 Custom Search API에도 동작).
   → 이 경우 `GOOGLE_CSE_API_KEY`는 **비워두면** 됩니다(자동으로 Books 키를 재사용).
   별도 키를 쓰고 싶으면 새 API 키를 발급해 `GOOGLE_CSE_API_KEY`에 넣으세요.

### C. `.env`에 입력 후 반영
```
GOOGLE_CSE_ID=복사한-검색엔진-ID
# GOOGLE_CSE_API_KEY=   # 비우면 GOOGLE_BOOKS_API_KEY 재사용
```
```bash
docker compose up -d homelibrary-api
```

> 잘 붙었는지 확인:
> ```bash
> docker compose exec -T homelibrary-api python -c "from app.services.booklookup_service import _fetch_web_images; r=_fetch_web_images('Études sur le jardin Marie Dupont'); print(len(r), r[0]['cover_url'] if r else '결과 없음')"
> ```

> **주의**: 웹 이미지 검색은 카탈로그와 달리 **엉뚱한 이미지도 섞여 나올 수 있습니다**(지정한
> 사이트 안에서 이미지로 검색하므로). 표지 후보 화면에서 눈으로 보고 고르는 용도라 문제는 없고,
> 100회/일 무료 한도가 있으니 표지 검색을 할 때만 호출됩니다. 특정 책 표지가 안 나오면, 그 표지가
> 있는 사이트 도메인을 검색엔진 설정에 추가하면 됩니다.

## 키를 넣은 뒤 반영 방법 (공통)

```bash
cd <설치 폴더>
nano .env    # 또는 원하는 편집기로 값 채우기
docker compose up -d homelibrary-api
```

키가 없을 때 스캔을 시도하면 백엔드가 `ANTHROPIC_API_KEY가 설정되어 있지 않습니다` 같은 오류 메시지를
그대로 반환하므로, 어떤 키가 빠졌는지 화면에서 바로 확인할 수 있습니다.
