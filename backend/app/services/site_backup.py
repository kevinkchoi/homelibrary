"""운영자용 도서관 백업·복구 (personal 모드) — **암호화된 파일**로만 주고받는다.

사용자 요구(2026-11-27): 운영자는 관리를 위해 도서관(주인 목록과 그 책 DB)을 백업·복구할 수 있어야 하지만,
**사용자의 개인정보나 책 목록을 빼갈 수는 없어야** 한다. 그래서
- 백업 파일은 서버만 아는 키(.env의 SITE_BACKUP_SECRET, 없으면 JWT_SECRET에서 파생)로 Fernet 암호화한다.
  운영자 화면은 파일을 내려받고 다시 올려 복구하는 것만 할 수 있고, **안을 열어 보여 주는 기능은 없다.**
- ⚠️ 한계를 숨기지 않는다: 서버 주인은 .env와 DB에 직접 접근할 수 있으므로 기술적으로는 막을 수 없다.
  이 장치는 "앱이 운영자에게 데이터를 보여 주거나 내보내는 길을 만들지 않는다"는 약속이다.
- ⚠️ SITE_BACKUP_SECRET을 잃으면 그 키로 만든 백업은 영영 못 연다. 서버 밖에도 적어 둘 것.

파일 안(복호화 후): tar.gz — `data.json`(도서관·사용자·책·'다른 책' 표시) + `covers/<파일명>`.
사용자 행에는 비밀번호 **해시**와 암호화된 Claude 키가 그대로 들어간다(같은 서버에 복구하면 그대로 로그인된다).

복구: 백업 속 도서관마다
1) 백업의 아이디가 **이미 다른 도서관에서 쓰이면** 아무것도 바꾸지 않고 거절(409)
2) 같은 사람들이 지금 한 도서관에 있으면(= 그 도서관을 되돌리는 것) 그 도서관을 먼저 통째로 지운다
3) 도서관·사용자·책을 **새 번호로** 다시 만든다(번호가 다른 것과 부딪히지 않게) — 서로의 연결은 옮겨 단다
4) 표지 파일을 되돌린다(같은 이름이 이미 있으면 그대로 둔다)
"""

import base64
import hashlib
import io
import json
import os
import tarfile
from datetime import date, datetime

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import DateTime, inspect
from sqlalchemy.orm import Session

from app.config import settings
from app.models.book import Book
from app.models.duplicate_ack import DuplicateAcknowledgement
from app.models.library import Library
from app.models.user import User
from app.services import library_service
from app.services.image_service import sanitize_image_path

FORMAT = "homelibrary-site-backup/1"


class RestoreConflict(Exception):
    pass


def _fernet() -> Fernet:
    secret = settings.site_backup_secret or f"site-backup:{settings.jwt_secret}"
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


def _row(obj) -> dict:
    out = {}
    for col in inspect(obj).mapper.column_attrs:
        v = getattr(obj, col.key)
        out[col.key] = v.isoformat() if isinstance(v, (datetime, date)) else v
    return out


def _fill(model, data: dict, skip=("id",)) -> object:
    """백업 행으로 새 객체를 만든다(번호는 새로). 날짜 칸은 문자열을 되돌린다."""
    obj = model()
    for col in inspect(model).columns:
        if col.key in skip or col.key not in data:
            continue
        v = data[col.key]
        if v is not None and isinstance(col.type, DateTime):
            v = datetime.fromisoformat(v)
        setattr(obj, col.key, v)
    return obj


def make_backup(db: Session, library_id: int | None = None) -> tuple[bytes, dict]:
    """암호화된 백업 바이트와 (화면에 보여 줄) 숫자 요약을 돌려준다. library_id가 없으면 전체."""
    q = db.query(Library).order_by(Library.id)
    libs = q.filter(Library.id == library_id).all() if library_id else q.all()
    payload = {"format": FORMAT, "created_at": datetime.now().isoformat(), "libraries": []}
    covers: set[str] = set()
    for lib in libs:
        users = db.query(User).filter(User.library_id == lib.id).order_by(User.id).all()
        books = db.query(Book).filter(Book.library_id == lib.id).order_by(Book.id).all()
        acks = db.query(DuplicateAcknowledgement).filter(DuplicateAcknowledgement.library_id == lib.id).all()
        covers.update(b.cover_image_path for b in books if b.cover_image_path)
        payload["libraries"].append(
            {
                "library": _row(lib),
                "users": [_row(u) for u in users],
                "books": [_row(b) for b in books],
                "acks": [_row(a) for a in acks],
            }
        )

    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w:gz") as tar:
        data = json.dumps(payload, ensure_ascii=False).encode()
        info = tarfile.TarInfo("data.json")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
        for name in sorted(covers):
            path = os.path.join(settings.images_dir, name)
            if os.path.isfile(path):
                tar.add(path, arcname=f"covers/{name}")
    summary = {
        "libraries": len(payload["libraries"]),
        "users": sum(len(x["users"]) for x in payload["libraries"]),
        "books": sum(len(x["books"]) for x in payload["libraries"]),
    }
    return _fernet().encrypt(raw.getvalue()), summary


def restore_backup(db: Session, blob: bytes, admin: User) -> dict:
    try:
        raw = _fernet().decrypt(blob)
    except InvalidToken as exc:
        raise ValueError("이 서버에서 만든 백업이 아니거나 파일이 손상되었습니다.") from exc

    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        payload = json.loads(tar.extractfile("data.json").read())
        if payload.get("format") != FORMAT:
            raise ValueError("알 수 없는 백업 형식입니다.")
        cover_files = {
            m.name.split("/", 1)[1]: tar.extractfile(m).read()
            for m in tar.getmembers()
            if m.isfile() and m.name.startswith("covers/")
        }

    # 1) 먼저 전부 검사 — 하나라도 부딪히면 아무것도 바꾸지 않는다
    plans = []
    for entry in payload["libraries"]:
        names = [u["username"] for u in entry["users"]]
        existing = db.query(User).filter(User.username.in_(names)).all()
        libs_in_use = {u.library_id for u in existing}
        if len(libs_in_use) > 1:
            raise RestoreConflict(f"'{entry['library']['name']}'의 사람들이 지금 여러 도서관에 흩어져 있어 되돌릴 수 없습니다.")
        replace = None
        if libs_in_use:
            candidate = db.get(Library, next(iter(libs_in_use)))
            owner = db.get(User, candidate.owner_user_id) if candidate and candidate.owner_user_id else None
            backup_owner = next(
                (u["username"] for u in entry["users"] if u["id"] == entry["library"].get("owner_user_id")), None
            )
            # **같은 도서관**일 때만 덮어쓴다(번호가 같거나 주인이 같을 때). 지워진 도서관의 아이디를 그새 다른
            # 도서관 사람이 가져갔다면, 그 도서관을 지워 버리는 사고가 난다 → 거절하고 운영자가 판단하게 한다.
            same = candidate is not None and (
                candidate.id == entry["library"]["id"] or (owner is not None and owner.username == backup_owner)
            )
            if not same:
                taken = ", ".join(sorted(u.username for u in existing))
                raise RestoreConflict(f"'{entry['library']['name']}'의 아이디({taken})를 지금 다른 도서관이 쓰고 있어 복구하지 않았습니다.")
            if admin.library_id == candidate.id:
                raise RestoreConflict("운영자 자신의 도서관은 이 화면에서 되돌리지 않습니다(로그인한 계정이 지워집니다).")
            replace = candidate
        plans.append((entry, replace))

    result = {"libraries": 0, "users": 0, "books": 0, "covers": 0, "replaced": []}
    for entry, replace in plans:
        if replace is not None:
            result["replaced"].append(replace.name)
            library_service.delete_library(db, replace)
            db.flush()

        lib = _fill(Library, entry["library"], skip=("id", "owner_user_id", "invite_code"))
        code = entry["library"].get("invite_code")
        if code and not db.query(Library).filter(Library.invite_code == code).first():
            lib.invite_code = code
        db.add(lib)
        db.flush()

        user_map = {}
        for u in entry["users"]:
            user = _fill(User, u, skip=("id", "library_id"))
            user.library_id = lib.id
            user.is_admin = False  # 운영자 권한은 백업으로 되살리지 않는다
            db.add(user)
            db.flush()
            user_map[u["id"]] = user.id
        lib.owner_user_id = user_map.get(entry["library"].get("owner_user_id"))

        for b in entry["books"]:
            book = _fill(Book, b, skip=("id", "library_id", "owner_id"))
            book.library_id = lib.id
            book.owner_id = user_map.get(b.get("owner_id"))
            db.add(book)
        for a in entry["acks"]:
            ack = _fill(DuplicateAcknowledgement, a, skip=("id", "library_id", "owner_id"))
            ack.library_id = lib.id
            ack.owner_id = user_map.get(a.get("owner_id"))
            db.add(ack)
        result["libraries"] += 1
        result["users"] += len(entry["users"])
        result["books"] += len(entry["books"])

    db.commit()

    for name, content in cover_files.items():
        safe = sanitize_image_path(name)
        if not safe:
            continue
        path = os.path.join(settings.images_dir, safe)
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(content)
            result["covers"] += 1
    return result
