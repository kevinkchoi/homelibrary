import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app import library_scope
from app.auth.deps import get_current_user
from app.models.user import User
from app.schemas.scan import ScanResult
from app.services import booklookup_service, user_keys, vision_service
from app.services.image_service import (
    UnsupportedImageError,
    purge_old_temp_images,
    save_cropped_photo,
    save_temp_image_bytes,
    to_jpeg_bytes,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scan", tags=["scan"])


@router.post("/extract", response_model=ScanResult)
def extract_from_photo(
    photo: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    library_scope.ensure_can_edit(current_user)  # 사진 스캔은 책을 넣으려고 하는 일이다
    api_key = user_keys.ai_key_for(current_user)
    if not api_key:
        # personal 모드에서 [내 설정]에 Claude 키를 넣지 않은 사용자. 화면도 이 기능을 숨기지만
        # API를 직접 부르는 경우를 위해 여기서도 막는다(운영자 키로 넘어가면 안 된다).
        raise HTTPException(
            status_code=403,
            detail="표지 사진 인식은 [내 설정]에 Claude API 키를 넣어야 쓸 수 있습니다.",
        )

    photo_bytes = photo.file.read()
    if not photo_bytes:
        raise HTTPException(status_code=400, detail="이미지가 비어 있습니다.")

    # 지난 스캔에서 채택되지 않고 남은 임시 이미지를 이 김에 정리한다(별도 스케줄러 없이).
    purge_old_temp_images()

    # 아이폰 HEIC 등 어떤 형식이 올라와도 여기서 JPEG로 통일한다.
    # (Claude Vision은 jpeg/png/gif/webp만 받는다)
    try:
        photo_bytes = to_jpeg_bytes(photo_bytes)
    except UnsupportedImageError:
        logger.warning("이미지 변환 실패: filename=%s content_type=%s", photo.filename, photo.content_type)
        raise HTTPException(status_code=400, detail="지원하지 않는 이미지 형식입니다. JPEG/PNG/HEIC 파일을 올려주세요.")

    try:
        extracted = vision_service.extract_book_fields_from_image(photo_bytes, "image/jpeg", api_key=api_key)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        logger.exception("사진 분석 실패: filename=%s", photo.filename)
        raise HTTPException(status_code=502, detail="사진에서 정보를 읽는 데 실패했습니다. 다시 시도해주세요.")

    title = (extracted.get("title") or "").strip()
    author = (extracted.get("author") or "").strip()
    language = (extracted.get("language") or "").strip().lower() or None
    query = " ".join(part for part in [title, author] if part)

    looked_up = booklookup_service.lookup_book(query, language=language) if query else None

    result = ScanResult(
        title=(looked_up and looked_up.get("title")) or extracted.get("title"),
        author=(looked_up and looked_up.get("author")) or extracted.get("author"),
        translator=extracted.get("translator") or (looked_up and looked_up.get("translator")),
        publisher=(looked_up and looked_up.get("publisher")) or extracted.get("publisher"),
        category=(looked_up and looked_up.get("category")) or extracted.get("category"),
        pub_year=looked_up and looked_up.get("pub_year"),
        isbn=looked_up and looked_up.get("isbn"),
        source=looked_up and looked_up.get("source"),
    )

    # 촬영한 사진은 배경 여백을 자동으로 잘라내 기본 표지 후보로 항상 저장한다.
    # (알라딘/Google Books 조회가 다른 책과 잘못 매칭되는 경우가 있어 — 특히 외국어 책 —
    # 더 이상 인터넷 이미지를 자동으로 표지에 채우지 않고, 검토 화면에서 사용자가 비교해서 고르게 함)
    #
    # ⚠️ 둘 다 **`tmp/`에 임시로** 저장한다. 검토 화면에서 사용자가 이 사진을 건너뛸 수도 있고,
    # 두 후보 중 하나만 고를 수도 있기 때문이다. 책에 채택되는 순간 `promote_temp_image()`가
    # 정식 저장소로 옮기고, 채택되지 않은 쪽은 `purge_old_temp_images()`가 알아서 지운다.
    # (예전에는 여기서 곧바로 정식 저장소에 넣어, 건너뛴 사진이 영원히 남아 고아 파일이 쌓였다)
    result.photo_image_path = save_cropped_photo(photo_bytes, temporary=True)

    web_cover_bytes = None
    if looked_up and looked_up.get("cover_url"):
        web_cover_bytes = booklookup_service.download_cover_image(looked_up["cover_url"])
    result.web_image_path = save_temp_image_bytes(web_cover_bytes) if web_cover_bytes else None

    result.cover_image_path = result.photo_image_path

    return result
