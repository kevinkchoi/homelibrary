"""사용자가 직접 넣는 Claude API 키 (personal 모드, homelibrary.kr).

**왜 사용자 키인가**: homelibrary.kr은 누구나(초대 코드로) 쓰는 서비스라, 운영자 키로 표지 사진 인식·
새책 추천을 돌리면 남의 사용량이 운영자에게 청구된다. 그래서 personal 모드에서는 **각자 자기 키**를
[내 설정]에 넣어야 그 기능이 켜진다. family 모드는 예전처럼 서버 `.env`의 키를 쓴다.

**보관 원칙**
- DB에는 Fernet으로 **암호화해서만** 둔다. 암호 키는 `USER_KEY_SECRET`(없으면 JWT_SECRET에서 파생).
- 평문은 **돌려주지 않는다**. 화면에는 "등록됨 · …끝 4자리"만.
- 로그에 찍지 않는다(마스킹하려 하지 말고 아예 출력하지 말 것).
"""

import base64
import hashlib
import logging

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.config import settings
from app.models.user import User

logger = logging.getLogger(__name__)


def _fernet() -> Fernet:
    secret = settings.user_key_secret or f"user-keys:{settings.jwt_secret}"
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
    return Fernet(key)


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(token: str | None) -> str:
    """복호화 실패(비밀값이 바뀜 등)는 "키 없음"으로 본다 — 사용자가 다시 넣으면 된다."""
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        logger.warning("저장된 사용자 API 키를 복호화하지 못함 (USER_KEY_SECRET/JWT_SECRET이 바뀌었을 수 있음)")
        return ""


def last4(user: User) -> str | None:
    plain = decrypt(user.anthropic_api_key_enc)
    return plain[-4:] if plain else None


def ai_key_for(user: User | None) -> str:
    """이 사용자 요청에 쓸 Claude 키. 빈 문자열이면 AI 기능을 쓸 수 없다.

    - personal: 그 사람이 넣은 키만. **운영자 키로 넘어가지 않는다**(청구가 운영자에게 가므로).
    - family  : 서버 `.env`의 ANTHROPIC_API_KEY (예전 그대로).
    """
    if settings.personal_mode:
        return decrypt(user.anthropic_api_key_enc) if user else ""
    return settings.anthropic_api_key


def looks_like_anthropic_key(value: str) -> bool:
    return value.startswith("sk-ant-") and 20 <= len(value) <= 300 and value.isascii()


def verify_key(value: str) -> None:
    """키가 실제로 동작하는지 가장 싼 호출(모델 목록 조회 — 토큰 과금 없음)로 확인한다.

    저장하기 전에 확인하는 이유: 잘못 붙여 넣은 키를 저장하면, 나중에 표지 사진을 찍었을 때에야
    "인식 실패"로 드러나 원인을 알기 어렵다.

    SDK(`anthropic==0.34.2`)에는 모델 목록 API가 없어 HTTP로 직접 부른다.
    """
    try:
        resp = httpx.get(
            "https://api.anthropic.com/v1/models",
            params={"limit": 1},
            headers={"x-api-key": value, "anthropic-version": "2023-06-01"},
            timeout=15,
        )
    except httpx.HTTPError as exc:
        raise ValueError("Claude 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.") from exc
    if resp.status_code == 401:
        raise ValueError("Claude가 이 키를 거부했습니다. 키를 다시 확인해 주세요.")
    if resp.status_code == 403:
        raise ValueError("이 키에는 권한이 없습니다(조직·결제 설정을 확인해 주세요).")
    if resp.status_code >= 400:
        raise ValueError(f"키를 확인하지 못했습니다(HTTP {resp.status_code}). 잠시 후 다시 시도해 주세요.")
