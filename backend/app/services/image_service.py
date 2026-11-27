import io
import logging
import os
import re
import time
import uuid

import pillow_heif
from PIL import Image, ImageChops, ImageOps, UnidentifiedImageError

from app.config import settings

logger = logging.getLogger(__name__)

# iPhone 기본 촬영 포맷인 HEIC/HEIF는 Pillow가 기본으로 못 읽는다.
# (데스크톱에서 아이폰 사진을 그대로 올리면 여기서 걸린다)
pillow_heif.register_heif_opener()

MAX_DIMENSION = 1600
# 분석용은 저장용보다 크게 유지한다. 출판사/옮긴이 같은 작은 글씨까지 읽어야 하고,
# Claude가 그대로 받는 최대 해상도가 긴 변 기준 2576px이라 더 키워봐야 서버에서 줄어든다.
VISION_MAX_DIMENSION = 2576

# 표지 후보처럼 "사용자가 고르지 않으면 버려질" 이미지는 images_dir 아래 tmp/ 에 따로 저장한다.
# 그냥 같은 폴더에 두면 고르지 않은 후보들이 영원히 쌓인다(디스크가 작은 홈서버라 무시 못 함).
TEMP_DIRNAME = "tmp"
TEMP_MAX_AGE_SECONDS = 6 * 3600

# 클라이언트가 보내온 이미지 경로 검증용. 저장 파일명은 항상 uuid4().hex + ".jpg" 이므로
# 이 형태만 허용하면 경로 탈출(../)이나 남의 파일 지정이 원천적으로 불가능하다.
IMAGE_PATH_RE = re.compile(rf"^(?:{TEMP_DIRNAME}/)?[0-9a-f]{{32}}\.jpg$")

# 고아 정리에서 "우리가 만든 표지 파일"만 지우기 위한 패턴(tmp/ 접두사 없는 영구 저장소 파일명).
# 이 형태가 아닌 파일은 무엇이든 건드리지 않는다 — 나중에 누가 다른 파일을 같은 폴더에 두더라도
# 정리 작업이 그것을 지워버리는 사고를 막기 위해서다.
STORED_IMAGE_RE = re.compile(r"^[0-9a-f]{32}\.jpg$")

# 아직 어느 책에도 연결되지 않은 영구 저장소 파일을 지우기 전에 기다리는 시간.
# 스캔/업로드 직후 아직 저장 버튼을 누르지 않은 "작업 중인" 파일을 실수로 지우지 않기 위한 여유.
ORPHAN_MIN_AGE_SECONDS = 24 * 3600


class UnsupportedImageError(Exception):
    """지원하지 않는(또는 손상된) 이미지 형식."""


def _ensure_images_dir() -> None:
    os.makedirs(settings.images_dir, exist_ok=True)


def open_image(data: bytes) -> Image.Image:
    """업로드된 바이트를 Pillow 이미지로 연다. HEIC/HEIF도 지원하며,
    휴대폰 사진의 EXIF 회전 정보를 실제 픽셀에 반영한다."""
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except UnidentifiedImageError as exc:
        raise UnsupportedImageError("지원하지 않는 이미지 형식입니다.") from exc
    except Exception as exc:  # 손상된 파일 등
        raise UnsupportedImageError("이미지를 읽을 수 없습니다.") from exc
    # 세로로 찍은 사진이 옆으로 눕는 문제 방지
    return ImageOps.exif_transpose(image)


def _save_image(image: Image.Image, subdir: str | None = None) -> str:
    _ensure_images_dir()
    target_dir = settings.images_dir
    if subdir:
        target_dir = os.path.join(target_dir, subdir)
        os.makedirs(target_dir, exist_ok=True)

    image = image.convert("RGB")
    image.thumbnail((MAX_DIMENSION, MAX_DIMENSION))

    filename = f"{uuid.uuid4().hex}.jpg"
    image.save(os.path.join(target_dir, filename), format="JPEG", quality=88)
    return f"{subdir}/{filename}" if subdir else filename


def to_jpeg_bytes(data: bytes) -> bytes:
    """어떤 형식(HEIC 등)이든 JPEG 바이트로 변환. Claude Vision은 jpeg/png/gif/webp만
    받으므로, 분석에 보내기 전에 항상 이 함수를 거친다."""
    image = open_image(data).convert("RGB")
    image.thumbnail((VISION_MAX_DIMENSION, VISION_MAX_DIMENSION))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=88)
    return buffer.getvalue()


def save_image_bytes(data: bytes, suggested_ext: str = "jpg") -> str:
    """이미지를 정규화(RGB, 최대 해상도 제한)하여 저장하고 상대 경로(파일명)를 반환."""
    return _save_image(open_image(data))


def _trim_border(image: Image.Image) -> Image.Image:
    """배경이 비교적 단색(책상/바닥 등)이라고 가정하고, 네 모서리 색상을 배경으로 추정해
    가장자리 여백을 잘라낸다. 배경 감지가 잘 안 되거나(무늬가 있는 배경 등) 너무 많이
    잘리는 경우엔 원본을 그대로 반환한다."""
    rgb = image.convert("RGB")
    width, height = rgb.size

    corners = [
        rgb.getpixel((0, 0)),
        rgb.getpixel((width - 1, 0)),
        rgb.getpixel((0, height - 1)),
        rgb.getpixel((width - 1, height - 1)),
    ]
    bg_color = tuple(sum(c[i] for c in corners) // len(corners) for i in range(3))

    bg = Image.new("RGB", rgb.size, bg_color)
    diff = ImageChops.difference(rgb, bg)
    # 약한 노이즈(조명 얼룩 등)는 무시하고 뚜렷한 차이만 남도록 대비를 높임
    diff = ImageChops.add(diff, diff, scale=2.0, offset=-30)
    bbox = diff.getbbox()

    if not bbox:
        return image

    box_w, box_h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    # 너무 작게 잘렸다면(배경 감지 실패로 의심) 원본 유지
    if box_w < width * 0.3 or box_h < height * 0.3:
        return image

    pad = int(min(box_w, box_h) * 0.03)
    left = max(0, bbox[0] - pad)
    top = max(0, bbox[1] - pad)
    right = min(width, bbox[2] + pad)
    bottom = min(height, bbox[3] + pad)
    return rgb.crop((left, top, right, bottom))


def save_cropped_photo(data: bytes, temporary: bool = False) -> str:
    """촬영한 책 사진에서 배경 여백을 자동으로 잘라내 저장. 실패하면 원본 그대로 저장.

    `temporary=True`면 `tmp/` 아래에 저장한다. 스캔 검토 화면에서 사용자가 그 사진을 **건너뛸 수도**
    있기 때문에, 책에 실제로 채택될 때까지는 임시 취급해야 한다(채택되면 `promote_temp_image()`가
    정식 저장소로 옮긴다). 예전에는 곧바로 정식 저장소에 넣어서, 건너뛴 사진이 영원히 남았다.
    """
    image = open_image(data)
    try:
        cropped = _trim_border(image)
    except Exception:
        cropped = image
    return _save_image(cropped, subdir=TEMP_DIRNAME if temporary else None)


def save_temp_image_bytes(data: bytes) -> str:
    """표지 후보처럼 아직 채택되지 않은 이미지를 tmp/ 아래에 저장하고 `tmp/<파일명>`을 반환.
    사용자가 고르면 `promote_temp_image()`로 정식 저장소로 옮기고, 고르지 않으면
    `purge_old_temp_images()`가 나중에 지운다."""
    return _save_image(open_image(data), subdir=TEMP_DIRNAME)


def is_temp_image_path(path: str | None) -> bool:
    return bool(path) and path.startswith(f"{TEMP_DIRNAME}/")


def sanitize_image_path(path: str | None) -> str | None:
    """클라이언트가 보낸 이미지 경로가 우리가 만든 파일명 형식인지 확인. 아니면 None."""
    if not path:
        return None
    return path if IMAGE_PATH_RE.match(path) else None


def promote_temp_image(temp_path: str) -> str | None:
    """사용자가 고른 임시 이미지를 정식 저장소로 옮기고 새 파일명을 반환. 파일이 없으면 None
    (검색만 해놓고 한참 뒤에 저장하면 purge에 이미 지워졌을 수 있다)."""
    source = os.path.join(settings.images_dir, temp_path)
    if not os.path.exists(source):
        return None
    filename = os.path.basename(temp_path)
    _ensure_images_dir()
    os.replace(source, os.path.join(settings.images_dir, filename))
    return filename


def purge_old_temp_images(max_age_seconds: int = TEMP_MAX_AGE_SECONDS) -> int:
    """오래된 표지 후보 이미지를 정리한다. 표지 검색을 할 때마다 호출하므로 별도 스케줄러가 필요 없다."""
    temp_dir = os.path.join(settings.images_dir, TEMP_DIRNAME)
    if not os.path.isdir(temp_dir):
        return 0

    cutoff = time.time() - max_age_seconds
    removed = 0
    for name in os.listdir(temp_dir):
        path = os.path.join(temp_dir, name)
        try:
            if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                os.remove(path)
                removed += 1
        except OSError:
            logger.warning("임시 이미지 삭제 실패: %s", path)
    return removed


def find_orphan_images(
    referenced: set[str], min_age_seconds: int = ORPHAN_MIN_AGE_SECONDS
) -> list[str]:
    """어느 책에도 연결되지 않은 영구 저장소 표지 파일을 찾는다(지우지는 않는다).

    `referenced`는 DB의 `books.cover_image_path` 집합이다. DB를 직접 보지 않고 인자로 받는 이유:
    이 모듈은 저장소만 다루는 계층으로 유지하고 싶어서다(테스트도 DB 없이 된다).

    안전장치 3겹 — 실수로 살아있는 표지를 지우면 복구가 어렵기 때문:
      1. `tmp/` 하위는 제외(그쪽은 `purge_old_temp_images()`가 따로 관리)
      2. 우리가 만든 파일명 형식(`STORED_IMAGE_RE`)이 아니면 제외
      3. 만들어진 지 `min_age_seconds`가 안 된 파일은 제외(아직 저장 안 누른 작업 중 파일 보호)
    """
    if not os.path.isdir(settings.images_dir):
        return []

    cutoff = time.time() - min_age_seconds
    orphans = []
    for name in os.listdir(settings.images_dir):
        if not STORED_IMAGE_RE.match(name):
            continue  # tmp/ 디렉터리나 우리 형식이 아닌 파일은 건드리지 않는다
        if name in referenced:
            continue
        path = os.path.join(settings.images_dir, name)
        try:
            if not os.path.isfile(path) or os.path.getmtime(path) >= cutoff:
                continue
        except OSError:
            continue
        orphans.append(name)
    return orphans


def orphan_images_size(names: list[str]) -> int:
    """고아 파일들이 차지하는 총 바이트 수(정리 전에 얼마나 줄어드는지 보여주기 위함)."""
    total = 0
    for name in names:
        try:
            total += os.path.getsize(os.path.join(settings.images_dir, name))
        except OSError:
            pass
    return total


def delete_orphan_images(
    referenced: set[str], min_age_seconds: int = ORPHAN_MIN_AGE_SECONDS
) -> int:
    """`find_orphan_images()`가 찾은 파일을 실제로 지우고 지운 개수를 반환."""
    orphans = find_orphan_images(referenced, min_age_seconds)
    removed = 0
    for name in orphans:
        try:
            os.remove(os.path.join(settings.images_dir, name))
            removed += 1
        except OSError:
            logger.warning("고아 이미지 삭제 실패: %s", name)
    if removed:
        logger.info("사용되지 않는 표지 이미지 %d개를 정리했습니다.", removed)
    return removed


def is_probably_cover(data: bytes, min_side: int = 60) -> bool:
    """내려받은 이미지가 실제 표지인지(플레이스홀더가 아닌지) 확인.
    Amazon의 ISBN 표지 URL은 해당 책이 없으면 200 OK로 **1x1 픽셀 플레이스홀더**를 돌려주므로,
    최소 크기(기본 60px)로 이런 것들을 걸러낸다."""
    if not data:
        return False
    try:
        img = open_image(data)
    except UnsupportedImageError:
        return False
    width, height = img.size
    return width >= min_side and height >= min_side


def delete_image(filename: str | None) -> None:
    if not filename:
        return
    path = os.path.join(settings.images_dir, filename)
    if os.path.exists(path):
        os.remove(path)


def image_path_on_disk(filename: str) -> str:
    return os.path.join(settings.images_dir, filename)


def image_exists(filename: str | None) -> bool:
    """DB에 적힌 표지 파일이 실제로 디스크에 있는지 확인.

    파일이 사라졌는데 DB에는 경로가 남아 있으면 화면에 **깨진 이미지**가 뜬다
    (실서버에서 실제로 7권이 이 상태였다). 점검/복구 기능이 이 함수로 그런 책을 찾아낸다.
    """
    if not filename:
        return False
    return os.path.isfile(image_path_on_disk(filename))
