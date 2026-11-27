import csv
import io
import zipfile
from datetime import datetime

from openpyxl import load_workbook
from sqlalchemy.orm import Session

from app import library_scope
from app.models.book import Book
from app.models.user import User
from app.services import booklookup_service, category_service
from app.services.export_service import (
    COLUMNS,
    DATE_COLUMNS,
    HEADER_ALIASES,
    HEADER_KR,
    ID_COLUMN,
    IMAGE_COLUMN,
    KST,
)
from app.services.image_service import delete_image, save_image_bytes


def _coerce(col: str, raw):
    if raw in ("", None):
        return None
    if col in ("pub_year", "original_pub_year"):
        try:
            return int(raw)
        except (ValueError, TypeError):
            return None
    return str(raw).strip()


def _row_book_id(row: dict):
    """줄에 적힌 책 번호. 있으면 **그 책을 수정**하고, 없으면 새 책으로 추가한다.

    내보낸 파일을 엑셀에서 고쳐 다시 가져오는 '일괄 편집'을 위한 열쇠다.
    (이게 없으면 가져올 때마다 서재가 두 배로 불어난다 — 예전엔 실제로 그랬다)
    """
    raw = row.get(HEADER_KR[ID_COLUMN], row.get(ID_COLUMN))
    if raw in ("", None):
        return None
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return None


def _parse_date(raw):
    """내보낸 등록일을 다시 읽는다. 엑셀은 datetime, CSV는 문자열로 준다.

    내보낼 때 한국시간으로 적었으므로 다시 읽을 때도 한국시간으로 해석한다.
    읽을 수 없으면 None — 호출부가 키를 빼서 '지금 시각'이 기본값으로 들어간다.
    """
    if raw in ("", None):
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=KST)
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(raw).strip(), fmt).replace(tzinfo=KST)
        except ValueError:
            continue
    return None


def _fields_from_row(row: dict) -> dict:
    fields = {}
    for col in COLUMNS:
        raw = row.get(HEADER_KR[col])
        if raw is None:
            # 옛 이름으로 적힌 열도 읽는다(예: "서평"의 옛 이름 "코멘트").
            for alias in HEADER_ALIASES.get(col, ()):
                raw = row.get(alias)
                if raw is not None:
                    break
        if raw is None:
            raw = row.get(col)
        fields[col] = _coerce(col, raw)

    # 카테고리는 엑셀에서 `"소설, 프랑스"`처럼 콤마로 적는다. 공백과 중복을 여기서 정리해야
    # 화면에서 넣은 값과 파일로 넣은 값이 같은 모양이 된다.
    fields["category"] = category_service.normalize(fields.get("category"))

    # ISBN도 화면 입력과 같은 모양으로 맞춘다(하이픈 제거). 엑셀에는 사람이 판권면에서
    # 베껴 적은 하이픈 형태가 들어오기 쉽다. ISBN이 아닌 값은 그대로 둔다.
    raw_isbn = fields.get("isbn")
    if raw_isbn:
        normalized = booklookup_service.normalize_isbn(str(raw_isbn))
        if booklookup_service.is_valid_isbn(normalized):
            fields["isbn"] = normalized

    # 등록일: 파일에 있으면 그 값을 살리고, 없으면 **키 자체를 넣지 않아서**
    # 모델의 기본값(지금 시각)이 적용되게 한다. None을 넣으면 NULL이 저장돼 버린다.
    for col in DATE_COLUMNS:
        raw = row.get(HEADER_KR[col], row.get(col))
        parsed = _parse_date(raw)
        if parsed is not None:
            fields[col] = parsed
    return fields


def _rows_from_xlsx(data: bytes) -> list[dict]:
    wb = load_workbook(io.BytesIO(data))
    ws = wb.active
    rows_iter = ws.iter_rows(min_row=1)
    header_cells = next(rows_iter)
    headers = [str(c.value).strip() if c.value is not None else "" for c in header_cells]

    rows = []
    for cells in rows_iter:
        row = {headers[i]: cells[i].value for i in range(min(len(headers), len(cells)))}
        rows.append(row)
    return rows


def _rows_from_csv(data: bytes) -> list[dict]:
    text = data.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    return list(reader)


def import_from_upload(db: Session, user: User, filename: str, data: bytes, fmt: str) -> int:
    """filename 확장자가 .zip이면 이미지까지 함께 처리, 아니면 데이터만 가져옴.

    `번호`(id) 열로 기존 책을 고칠 때도 **이 사용자의 책만** 찾는다(library_scope). personal 모드에서
    남의 책 번호를 적어 넣어도 그 책은 건드리지 않고 내 새 책으로 들어간다.
    """
    owner_id = user.id
    image_names: dict[str, str] = {}
    zf: zipfile.ZipFile | None = None

    if filename.lower().endswith(".zip"):
        zf = zipfile.ZipFile(io.BytesIO(data))
        image_names = {
            n.split("/", 1)[1]: n
            for n in zf.namelist()
            if n.startswith("images/") and not n.endswith("/")
        }
        inner_ext = ".xlsx" if fmt == "excel" else ".csv"
        data_name = next((n for n in zf.namelist() if n.lower().endswith(inner_ext)), None)
        if not data_name:
            raise ValueError(f"zip 안에 {inner_ext} 파일이 없습니다.")
        inner_data = zf.read(data_name)
        rows = _rows_from_xlsx(inner_data) if fmt == "excel" else _rows_from_csv(inner_data)
    else:
        rows = _rows_from_xlsx(data) if fmt == "excel" else _rows_from_csv(data)

    created = 0
    updated = 0
    for row in rows:
        title = row.get(HEADER_KR["title"]) or row.get("title")
        if not title:
            continue

        fields = _fields_from_row(row)
        if not fields.get("title") or not fields.get("author") or not fields.get("publisher"):
            continue

        # 파일에 표지 이미지가 함께 들어 있으면 새로 저장한다(목록만 있는 파일이면 건너뜀)
        cover_image_path = None
        image_filename = row.get(IMAGE_COLUMN)
        if zf is not None and image_filename and image_filename in image_names:
            raw_image = zf.read(image_names[image_filename])
            cover_image_path = save_image_bytes(raw_image)

        book_id = _row_book_id(row)
        existing = (
            library_scope.books(db, user).filter(Book.id == book_id).first() if book_id else None
        )

        if existing is not None:
            # 기존 책 수정 — 표지는 파일에 새 이미지가 있을 때만 바꾼다.
            # (목록만 내보내 고친 경우 표지 열이 없으므로 기존 표지를 지우면 안 된다)
            for key, value in fields.items():
                setattr(existing, key, value)
            if cover_image_path:
                delete_image(existing.cover_image_path)
                existing.cover_image_path = cover_image_path
            updated += 1
        else:
            db.add(Book(owner_id=owner_id, cover_image_path=cover_image_path, **fields))
            created += 1

    if zf is not None:
        zf.close()

    db.commit()
    return {"created": created, "updated": updated}
