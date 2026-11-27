from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg2://homelibrary:homelibrary@homelibrary-db:5432/homelibrary"

    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440

    anthropic_api_key: str = ""
    aladin_ttb_key: str = ""
    google_books_api_key: str = ""
    # 카카오(다음) 책 검색 REST API 키 (선택). 없으면 알라딘/구글만 사용한다.
    # (네이버 책 검색 API가 2026-07-31 종료되어 국내서 보강 소스로 카카오를 쓴다)
    kakao_rest_api_key: str = ""

    # Google 프로그래머블 검색(이미지) — 책 카탈로그에 표지가 없는 책(특히 해외 원서)을 위해
    # 웹 전체에서 표지 이미지를 찾는 최후의 소스. cse_id(검색엔진 ID)는 필수,
    # cse_api_key는 비우면 google_books_api_key를 재사용한다(같은 Google Cloud 프로젝트면 됨).
    google_cse_id: str = ""
    google_cse_api_key: str = ""

    images_dir: str = "/app/storage/images"

    # ── 운영 형태 (2026-11-27) ─────────────────────────────────────────────
    # "family"  : 가족이 **한 서재를 함께** 쓴다. 공개 가입 없음(관리자가 계정을 만든다).
    #             가족이 쓰는 서버가 이것이고, **기본값이라 설정이 없으면 예전 그대로**다.
    # "personal": 사용자마다 **자기 서재**를 따로 갖는다(서로의 책은 보이지 않는다). 초대 코드로 가입.
    #             homelibrary.kr 가 이것이다. 공유 기능은 아직 없다.
    library_mode: str = "family"
    # personal 모드의 가입 초대 코드. 비어 있으면 가입이 닫힌다(첫 계정만 예외 — 운영자).
    signup_invite_code: str = ""
    # 사용자가 넣은 Claude API 키를 DB에 **암호화해** 둘 때 쓰는 비밀값.
    # 비우면 jwt_secret에서 파생한다(그러면 JWT_SECRET을 바꿀 때 저장된 키도 못 읽게 된다 — 다시 넣으면 됨).
    user_key_secret: str = ""

    @property
    def personal_mode(self) -> bool:
        return self.library_mode.strip().lower() == "personal"


settings = Settings()
