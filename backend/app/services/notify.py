"""운영자에게 텔레그램으로 알린다(새 의견이 왔을 때).

서버의 다른 알림(백업 감시자)과 같은 봇·채팅을 쓴다 — .env의 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID.
둘 중 하나라도 없으면 조용히 건너뛴다(알림은 부가 기능이라 실패해도 의견 저장은 된다).
토큰은 URL에 들어가므로 httpx 로그(INFO)에 찍히지 않게 main.py에서 WARNING으로 낮춰 두었다.
"""

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def send_telegram(text: str) -> bool:
    token, chat = settings.telegram_bot_token.strip(), settings.telegram_chat_id.strip()
    if not token or not chat:
        return False
    try:
        resp = httpx.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data={"chat_id": chat, "text": text[:4000], "disable_web_page_preview": "true"},
            timeout=10,
        )
        if resp.status_code != 200:
            logger.warning("텔레그램 알림 실패: HTTP %s", resp.status_code)  # 응답 본문·토큰은 찍지 않는다
            return False
        return True
    except httpx.HTTPError:
        logger.warning("텔레그램 알림 실패: 연결 오류")
        return False
