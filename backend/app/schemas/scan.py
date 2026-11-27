from pydantic import BaseModel


class ScanResult(BaseModel):
    title: str | None = None
    author: str | None = None
    translator: str | None = None
    publisher: str | None = None
    category: str | None = None
    pub_year: int | None = None
    isbn: str | None = None
    cover_image_path: str | None = None  # 현재 선택된 표지(기본값: photo_image_path)
    photo_image_path: str | None = None  # 촬영한 사진에서 배경을 잘라낸 버전 (항상 시도)
    web_image_path: str | None = None  # 알라딘/Google Books에서 찾은 표지 (있을 때만)
    source: str | None = None  # "aladin" | "google_books" | None (정보를 못 찾은 경우)
