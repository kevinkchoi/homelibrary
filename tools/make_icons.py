#!/usr/bin/env python3
"""앱 아이콘(책 더미) 생성기 — 안드로이드 런처 아이콘 + PWA 아이콘.

아이콘을 PNG로만 두면 나중에 색이나 모양을 조금 바꾸고 싶을 때 손댈 수가 없다.
그래서 **그리는 코드**를 저장소에 두고, 필요하면 여기 숫자만 고쳐 다시 생성한다.

    python3 tools/make_icons.py

만드는 것:
  frontend/public/icons/icon-{192,512}.png      PWA(아이폰 홈 화면 포함)
  mobile/android/.../mipmap-*/ic_launcher.png         안드로이드 런처(정사각)
  mobile/android/.../mipmap-*/ic_launcher_round.png   안드로이드 런처(원형)
  mobile/android/.../mipmap-*/ic_launcher_foreground.png  적응형 아이콘 전경(투명 배경)

필요: Pillow
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 앱 기본색 (frontend/src/styles/global.css 의 --color-primary 와 같다)
BRAND = (44, 95, 138)
BRAND_DARK = (30, 66, 96)

# 책 세 권을 아래부터 위로. (표지색, 두께(아랫면)색, 책배=페이지 단면색)
# 파란 배경에서 또렷하게 보이는 따뜻한 색으로 골랐다.
# 표지색은 서로, 그리고 책배(밝은 크림)와도 뚜렷이 구분돼야 한다.
# 처음엔 맨 위를 크림색으로 했더니 책배가 표지에 묻혀 보이지 않았다.
BOOKS = [
    ((214, 106, 90), (176, 80, 66), (250, 241, 229)),    # 아래: 코랄
    ((233, 178, 76), (196, 141, 50), (253, 247, 233)),   # 가운데: 앰버
    ((109, 160, 130), (84, 128, 103), (248, 246, 238)),  # 위: 세이지 그린
]
# 각 권을 어긋나게 쌓고 책배를 좌/우 번갈아 둬서 '손으로 쌓은 책 더미'로 읽히게 한다.
# (전부 나란하면 책이 아니라 막대 세 개로 보인다 — 처음 그렸을 때 실제로 그랬다)
X_OFFSETS = [-0.030, 0.045, -0.010]
PAGES_ON_RIGHT = [True, False, True]

SS = 8  # 슈퍼샘플링 배수 — 크게 그려서 줄이면 가장자리가 매끈해진다


def _draw_stack(draw: ImageDraw.ImageDraw, box: tuple[float, float, float, float]) -> None:
    """정사각 아트박스 안에 책 세 권을 쌓아 그린다. box = (left, top, size, size)."""
    left, top, A, _ = box

    bw = 0.84 * A           # 책 한 권의 너비
    bh = 0.235 * A          # 책 한 권의 높이(옆에서 본 두께)
    gap = 0.012 * A         # 책 사이 간격 — 거의 붙여야 '쌓인 더미'로 보인다
    radius = 0.030 * A

    total = 3 * bh + 2 * gap
    y = top + (A - total) / 2 + total  # 맨 아래 책의 바닥에서 시작해 위로 쌓는다

    for (cover, under, pages), dx, right in zip(BOOKS, X_OFFSETS, PAGES_ON_RIGHT):
        x0 = left + (A - bw) / 2 + dx * A
        x1 = x0 + bw
        y1 = y
        y0 = y1 - bh

        # 표지(책 전체 몸통)
        draw.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=cover)

        # 책배(페이지 단면) — 책등 반대쪽 **끝까지** 채운다.
        # 양쪽에 여백을 두면 가운데 붙은 '라벨'처럼 보인다(처음에 그렇게 보였다).
        # 반대편에 남는 약 20%가 책등이 되어 '책'으로 읽힌다.
        pw = bw * 0.74
        px0 = (x1 - bw * 0.045 - pw) if right else (x0 + bw * 0.045)
        draw.rounded_rectangle(
            [px0, y0 + bh * 0.24, px0 + pw, y1 - bh * 0.24],
            radius=bh * 0.07,
            fill=pages,
        )

        # 아래쪽 그림자 — 권끼리 분리돼 보이게 하는 얇은 띠
        draw.rounded_rectangle([x0, y1 - bh * 0.16, x1, y1], radius=radius, fill=under)

        y = y0 - gap


def render(size: int, art_frac: float, background: str) -> Image.Image:
    """아이콘 한 장을 만든다.

    art_frac: 캔버스 대비 책 그림이 차지하는 비율.
      - 안드로이드 적응형 전경은 가운데 66%만 항상 보이므로 그보다 작게 둔다.
      - PWA maskable은 가운데 80%가 안전 영역이다.
    background: "square"(꽉 찬 사각) | "rounded" | "circle" | "none"(투명)
    """
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if background == "square":
        draw.rectangle([0, 0, S, S], fill=BRAND)
    elif background == "rounded":
        draw.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.22, fill=BRAND)
    elif background == "circle":
        draw.ellipse([0, 0, S - 1, S - 1], fill=BRAND)

    A = S * art_frac
    _draw_stack(draw, ((S - A) / 2, (S - A) / 2, A, A))
    return img.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG")
    print(f"  {os.path.relpath(path, ROOT)}  ({img.size[0]}px)")


def main() -> None:
    res = os.path.join(ROOT, "mobile", "android", "app", "src", "main", "res")

    print("PWA 아이콘 (배경 꽉 참 — maskable 안전영역 고려해 그림은 66%)")
    for px in (192, 512):
        save(render(px, 0.66, "square"),
             os.path.join(ROOT, "frontend", "public", "icons", f"icon-{px}.png"))

    # 밀도별 크기: (폴더, 런처 아이콘 px, 적응형 전경 px)
    densities = [
        ("mdpi", 48, 108), ("hdpi", 72, 162), ("xhdpi", 96, 216),
        ("xxhdpi", 144, 324), ("xxxhdpi", 192, 432),
    ]

    print("\n안드로이드 런처 아이콘")
    for name, launcher, fg in densities:
        d = os.path.join(res, f"mipmap-{name}")
        save(render(launcher, 0.64, "rounded"), os.path.join(d, "ic_launcher.png"))
        save(render(launcher, 0.60, "circle"), os.path.join(d, "ic_launcher_round.png"))
        # 적응형 전경은 배경이 따로 깔리므로 투명. 가운데 66%만 보장되니 58%로 여유를 둔다.
        save(render(fg, 0.58, "none"), os.path.join(d, "ic_launcher_foreground.png"))

    print("\n완료. 안드로이드는 `npx cap sync android` 후 재빌드해야 반영됩니다.")


if __name__ == "__main__":
    main()
