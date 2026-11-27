import csv
import io
import os
import zipfile

from openpyxl import Workbook
from openpyxl.drawing.image import Image as XLImage
from sqlalchemy.orm import Session

from datetime import timedelta, timezone

from app.config import settings
from app import library_scope
from app.models.book import Book
from app.models.user import User

# 등록일은 UTC로 저장되지만 사람이 보는 건 한국시간이다.
KST = timezone(timedelta(hours=9))
KST_OFFSET = timedelta(hours=9)

# 사용자가 직접 고칠 수 있는 항목들. 내보내기와 **가져오기가 함께** 쓴다.
COLUMNS = [
    "title",
    "author",
    "publisher",
    "pub_year",
    "isbn",
    "shelf_location",
    "category",
    "translator",
    "original_publisher",
    "original_pub_year",
    "comment",
]

# 책 번호(id). 내보낸 파일을 고쳐 다시 가져올 때 **어느 책을 수정할지 알아내는 열쇠**다.
# 이 값을 지우거나 비우면 그 줄은 새 책으로 추가된다.
ID_COLUMN = "id"

# 등록일은 사람이 타이핑해 넣는 값이 아니라 **기록된 값**이라 따로 둔다.
# 내보내기에는 포함하고(언제 넣은 책인지 봐야 하니까), 가져오기에서는 값이 있으면 살리고
# 없으면 지금 시각으로 새로 잡는다. 이게 없으면 내보내기→가져오기에서 등록일이 조용히 사라진다.
DATE_COLUMNS = ["created_at"]

HEADER_KR = {
    "id": "번호",
    "title": "제목",
    "isbn": "ISBN",
    "created_at": "등록일",
    "author": "저자",
    "publisher": "출판사",
    "pub_year": "출판연도",
    "shelf_location": "책꽂이 위치",
    "category": "카테고리",
    "translator": "번역자",
    "original_publisher": "원서 출판사",
    "original_pub_year": "원서 출판연도",
    "comment": "서평",
}

# 옛 내보내기 파일과의 호환. 2026-09-27에 "코멘트"를 **서평**으로 바꿨는데, 그 전에 내보낸
# 파일을 고쳐 다시 가져오는 일이 흔하다. 별칭을 두지 않으면 그 열이 조용히 무시되어
# **적어 둔 서평이 빈칸으로 덮인다.** 읽기만 별칭을 허용하고, 내보내기는 새 이름으로 한다.
HEADER_ALIASES = {
    "comment": ["코멘트"],
}

IMAGE_COLUMN = "image_filename"


def build_export_zip(db: Session, user: User, fmt: str) -> bytes:
    """fmt: 'excel' | 'csv' — books.xlsx|csv + images/ 폴더를 담은 zip 바이트 반환"""
    books = library_scope.books(db, user).order_by(Book.id.asc()).all()

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for book in books:
            if book.cover_image_path:
                path = os.path.join(settings.images_dir, book.cover_image_path)
                if os.path.exists(path):
                    zf.write(path, arcname=f"images/{book.cover_image_path}")

        if fmt == "excel":
            zf.writestr("books.xlsx", _build_xlsx_bytes(books))
        else:
            zf.writestr("books.csv", _build_csv_bytes(books))

    return zip_buffer.getvalue()


def _format_date(value) -> str:
    """등록일을 'YYYY-MM-DD HH:MM' 로 적는다.

    DB에는 UTC로 저장되므로 **한국시간으로 바꿔서** 내보낸다. 그대로 내보내면
    밤에 넣은 책이 하루 전날로 보인다.
    """
    if value is None:
        return ""
    return (value + KST_OFFSET).strftime("%Y-%m-%d %H:%M") if value.tzinfo is None else (
        value.astimezone(KST).strftime("%Y-%m-%d %H:%M")
    )


def _headers() -> list[str]:
    return (
        [HEADER_KR[ID_COLUMN]]
        + [HEADER_KR[c] for c in COLUMNS]
        + [HEADER_KR[c] for c in DATE_COLUMNS]
        + [IMAGE_COLUMN]
    )


def _row_values(book: Book) -> list:
    """한 권을 파일에 적을 값 목록. CSV와 엑셀이 **같은 순서**를 쓰도록 한 곳에서 만든다."""
    return (
        [book.id]
        + [getattr(book, c) if getattr(book, c) is not None else "" for c in COLUMNS]
        + [_format_date(getattr(book, c)) for c in DATE_COLUMNS]
        + [book.cover_image_path or ""]
    )


def _build_csv_bytes(books: list[Book]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_headers())
    for book in books:
        writer.writerow(_row_values(book))
    return buf.getvalue().encode("utf-8-sig")


def _build_xlsx_bytes(books: list[Book], include_images: bool = True) -> bytes:
    """엑셀 파일을 만든다.

    `include_images=False`면 표지 열을 넣지 않는다. 표지를 셀에 박으면 845권 기준 150MB라
    **일괄 편집용으로는 쓸 수 없다.** 목록만 내보내면 수백 KB로 끝난다.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "Books"

    # 표지는 이미지를 셀에 얹어야 해서 값 열과 섞을 수 없다. 맨 앞에 따로 둔다.
    offset = 1 if include_images else 0
    ws.append((["표지"] if include_images else []) + _headers())
    if include_images:
        ws.column_dimensions["A"].width = 14

    for row_idx, book in enumerate(books, start=2):
        if include_images:
            ws.row_dimensions[row_idx].height = 80
        for col_idx, value in enumerate(_row_values(book), start=1 + offset):
            ws.cell(row=row_idx, column=col_idx, value=value)

        if include_images and book.cover_image_path:
            path = os.path.join(settings.images_dir, book.cover_image_path)
            if os.path.exists(path):
                try:
                    img = XLImage(path)
                    img.height = 100
                    img.width = 75
                    ws.add_image(img, f"A{row_idx}")
                except Exception:
                    pass

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_export_bytes(db: Session, user: User, fmt: str) -> bytes:
    """표지 없이 **목록만** 담은 파일(csv/xlsx) 바이트. 일괄 편집용."""
    books = library_scope.books(db, user).order_by(Book.id.asc()).all()
    if fmt == "excel":
        return _build_xlsx_bytes(books, include_images=False)
    return _build_csv_bytes(books)
