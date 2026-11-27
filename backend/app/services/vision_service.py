import base64
import json

import anthropic

from app.config import settings

MODEL = "claude-sonnet-5"

EXTRACTION_PROMPT = """다음은 책 표지 사진입니다. 사진에서 다음 정보를 읽어 JSON으로만 답하세요.
알 수 없는 항목은 null로 두세요. 다른 설명 없이 JSON 객체 하나만 출력하세요.

{
  "title": "책 제목",
  "author": "저자",
  "translator": "번역자 (없으면 null)",
  "publisher": "출판사",
  "category": "이 책의 대략적인 분야/카테고리 (예: 소설, 인문, 경제 등, 모르면 null)",
  "language": "표지에 적힌 글의 주 언어를 ISO 639-1 코드로 (한국어=ko, 프랑스어=fr, 영어=en 등), 판단하기 어려우면 null"
}
"""


def extract_book_fields_from_image(
    image_bytes: bytes, media_type: str = "image/jpeg", *, api_key: str
) -> dict:
    """api_key는 호출하는 쪽이 user_keys.ai_key_for(user)로 정한다 —
    personal 모드에서는 **그 사용자의 키**, family 모드에서는 서버 키."""
    if not api_key:
        raise RuntimeError("Claude API 키가 없어 사진을 읽을 수 없습니다.")

    client = anthropic.Anthropic(api_key=api_key)
    b64 = base64.b64encode(image_bytes).decode("ascii")

    message = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": b64},
                    },
                    {"type": "text", "text": EXTRACTION_PROMPT},
                ],
            }
        ],
    )

    text = "".join(
        block.text for block in message.content if getattr(block, "type", None) == "text"
    )
    return _parse_json_response(text)


def _parse_json_response(text: str) -> dict:
    text = text.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("Claude 응답에서 JSON을 찾을 수 없습니다.")
    return json.loads(text[start : end + 1])
