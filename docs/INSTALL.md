# Home Library 설치 매뉴얼

Linux 서버(Docker가 설치된 환경)에서 Home Library를 설치하고 실행하는 절차입니다.

## 1. 사전 준비

- Docker Engine 및 Docker Compose v2가 설치된 Linux 서버
  ```bash
  docker --version
  docker compose version
  ```
  설치되어 있지 않다면 https://docs.docker.com/engine/install/ 참고
- (선택) Claude Vision 스캔 기능을 쓰려면 Anthropic API 키
- (선택) 국내도서 자동 검색을 쓰려면 알라딘 Open API TTBKey

스캔/자동 정보 채우기 기능을 쓰지 않고 수동 입력만 사용할 경우, API 키 없이도 나머지 기능은 모두 정상 동작합니다.
두 키를 발급받는 자세한 절차는 [API_KEYS.md](API_KEYS.md) 문서를 참고하세요.

## 2. 프로젝트 복사

서버에 이 프로젝트 폴더 전체(`HomeLibrary_v2/`)를 복사합니다.

```bash
# 예: git 저장소로 관리한다면
git clone <저장소 주소> HomeLibrary_v2
cd HomeLibrary_v2
```

## 3. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어 아래 값을 채웁니다.

- `POSTGRES_PASSWORD` — DB 비밀번호를 임의의 안전한 값으로 변경
- `DATABASE_URL` — 위 비밀번호와 동일하게 맞춰줌 (`postgresql+psycopg2://homelibrary:<비밀번호>@homelibrary-db:5432/homelibrary`)
- `JWT_SECRET` — 아래 명령으로 생성한 임의의 문자열로 교체
  ```bash
  openssl rand -hex 32
  ```
- `ANTHROPIC_API_KEY` — 사진 스캔 기능을 쓸 경우 입력
- `ALADIN_TTB_KEY` — 국내도서 자동 검색을 쓸 경우 입력
- `WEB_PORT` — 웹 접속 포트 (기본 8080, 변경하려면 수정)

## 4. 빌드 및 실행

```bash
docker compose build
docker compose up -d
```

컨테이너 상태 확인:

```bash
docker compose ps
```

`homelibrary-db`, `homelibrary-api`, `homelibrary-web` 세 컨테이너가 모두 `running`(healthy) 상태여야 합니다.
백엔드는 최초 기동 시 자동으로 DB 마이그레이션(`alembic upgrade head`)을 실행합니다.

## 5. 접속 및 최초 계정 생성

브라우저에서 `http://<서버 IP>:8080` (기본 포트 8080) 접속 → [회원가입]으로 계정을 만들고 로그인합니다.

## 6. 휴대폰에 앱으로 설치 (PWA)

1. 휴대폰과 서버가 같은 네트워크(또는 서버가 외부에서 접근 가능한 주소)인지 확인
2. 휴대폰 브라우저(Chrome/Safari 등)에서 `http://<서버 IP>:8080` 접속 후 로그인
3. 브라우저 메뉴에서 **"홈 화면에 추가"**(Android: 메뉴 → 홈 화면에 추가 / iOS Safari: 공유 → 홈 화면에 추가) 선택
4. 홈 화면 아이콘으로 실행하면 일반 앱처럼 동작합니다. 상단 메뉴의 "새책 추가 → 📷 사진으로 스캔"에서
   카메라 접근을 허용하면 책 표지를 촬영해 정보를 자동으로 채울 수 있습니다.

> 카메라(`getUserMedia`)는 보안 컨텍스트(HTTPS 또는 localhost)에서만 정상 동작하는 브라우저가 많습니다.
> `http://<사설 IP>:8080`처럼 HTTP+LAN IP로 접속하면 iOS Safari/Chrome 등에서 실시간 카메라 미리보기가
> 막힐 수 있습니다(사진 파일 선택 버튼이나 기기 카메라 앱 fallback으로 우회는 가능하지만, 근본적으로
> 해결하려면 아래 7단계의 Tailscale HTTPS 설정을 권장합니다).

## 7. (권장) Tailscale로 HTTPS 접속 설정

카메라 기능을 안정적으로 쓰려면 HTTPS가 필요합니다. 공인 도메인/인증서 없이도
[Tailscale](https://tailscale.com)을 쓰면 무료로 손쉽게 HTTPS 주소를 받을 수 있습니다. Tailscale은
기기마다 앱을 설치해 같은 계정(tailnet)에 로그인해두면 어디서든(LTE 등 외부망 포함) 서버에 접속되는
사설 메시 VPN입니다.

1. 서버에 Tailscale 설치 및 로그인
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sudo sh
   sudo tailscale up --hostname=homelibrary
   ```
   출력되는 `https://login.tailscale.com/a/...` 링크를 브라우저에서 열어 로그인(Google/Microsoft/GitHub/Apple 등)
2. [Tailscale 관리 콘솔](https://login.tailscale.com/admin/dns)에서 **HTTPS Certificates** 활성화
   (처음 `tailscale serve`를 실행하면 활성화 링크를 안내해줌)
3. 로컬 8080 포트를 tailnet에 HTTPS로 서빙
   ```bash
   sudo tailscale serve --bg 8080
   tailscale serve status   # 확인
   ```
4. `tailscale status`로 확인한 MagicDNS 이름(예: `https://homelibrary.<tailnet>.ts.net`)으로 접속.
   재부팅해도 `tailscaled`가 자동 시작되고 `serve` 설정도 유지됩니다.
5. 접속할 각 기기(휴대폰 등)에 Tailscale 앱을 설치하고 같은 계정으로 로그인해야 이 주소로 접속됩니다.
   가족 구성원을 tailnet에 초대하려면 관리 콘솔의 **Users** 메뉴에서 초대하거나, 같은 계정을 공유하세요.

이후에는 기존 `http://<서버 IP>:8080`(LAN 전용)과 새 `https://<이름>.ts.net`(Tailscale, 어디서나) 둘 다
동시에 접속 가능합니다 — 카메라 기능은 후자에서만 안정적으로 동작합니다.

## 8. 백업

```bash
# DB 백업
docker exec homelibrary-db pg_dump -U homelibrary homelibrary > backup_$(date +%F).sql

# 책 표지 이미지 백업
docker run --rm -v homelibrary_images:/data -v "$PWD":/backup alpine \
  tar czf /backup/images_$(date +%F).tar.gz -C /data .
```

## 9. 업데이트 절차

코드를 수정한 뒤(예: `frontend/src/pages/Home.jsx` 등 기능별 파일 교체) 아래 명령으로 반영합니다.

```bash
git pull                 # 또는 수정한 파일 교체
docker compose build     # 변경된 서비스만 빌드하려면: docker compose build homelibrary-web
docker compose up -d
```

## 10. 다른 서버로 재배포

`HomeLibrary_v2/` 폴더(코드) + `.env` 파일을 새 서버로 복사한 뒤 3~4단계를 그대로 반복하면 됩니다.
데이터를 함께 옮기려면 8단계에서 만든 백업(`*.sql`, `*.tar.gz`)을 새 서버의 `homelibrary-db`/`homelibrary_images`
볼륨에 복원하세요.

```bash
# DB 복원 예시
cat backup_YYYY-MM-DD.sql | docker exec -i homelibrary-db psql -U homelibrary homelibrary

# 이미지 복원 예시
docker run --rm -v homelibrary_images:/data -v "$PWD":/backup alpine \
  tar xzf /backup/images_YYYY-MM-DD.tar.gz -C /data
```

## 문제 해결

- `docker compose ps`에서 `homelibrary-api`가 계속 재시작된다면: `docker compose logs homelibrary-api`로 원인 확인 (보통 DB 접속 정보 불일치)
- 사진 스캔이 "ANTHROPIC_API_KEY가 설정되어 있지 않습니다" 오류를 낸다면: `.env`에 키를 넣고 `docker compose up -d homelibrary-api`로 재시작
- 국내도서 정보가 비어 있다면: `ALADIN_TTB_KEY` 발급/입력 여부 확인 (없어도 Google Books로 폴백 시도)
