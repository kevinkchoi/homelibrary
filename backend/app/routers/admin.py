"""운영자(사이트 관리자, is_admin) 전용.

personal 모드(개인 서재 서버)의 원칙 — 사용자 요구(2026-11-27):
- 운영자는 모든 도서관을 **관리**할 수 있다: 목록 보기, 말썽 사용자/도서관 지우기, 백업·복구.
- 그러나 사용자의 **개인정보·책 DB를 빼갈 수 없다**: 이 라우터는 이메일·책 제목·서평을 돌려주지 않는다.
  백업은 암호화 파일로만 내려준다(services/site_backup.py). 운영자가 남의 비밀번호를 바꾸는 길도 없다(users.py).

의견(피드백) 함은 두 모드 모두에서 쓴다.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.deps import require_admin
from app.config import settings
from app.database import get_db
from app.models.book import Book
from app.models.feedback import STATUSES, Feedback
from app.models.library import Library
from app.models.user import User
from app.schemas.admin import AdminLibrary, AdminLibraryList, FeedbackOut, FeedbackUpdate, RestoreResult
from app.services import library_service, site_backup

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _personal_only():
    if not settings.personal_mode:
        raise HTTPException(status_code=404, detail="개인 서재 서버에서만 쓰는 기능입니다.")


@router.get("/libraries", response_model=AdminLibraryList)
def list_libraries(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    _personal_only()
    libs = db.query(Library).order_by(Library.created_at.asc()).all()
    book_counts = dict(db.query(Book.library_id, func.count(Book.id)).group_by(Book.library_id).all())
    out = []
    for lib in libs:
        members = db.query(User.id, User.username).filter(User.library_id == lib.id).order_by(User.id).all()
        owner = next((name for uid, name in members if uid == lib.owner_user_id), None)
        out.append(
            AdminLibrary(
                id=lib.id,
                name=lib.name,
                owner_username=owner,
                member_count=len(members),
                book_count=book_counts.get(lib.id, 0),
                created_at=lib.created_at,
                members=[name for _, name in members],
            )
        )
    return AdminLibraryList(
        libraries=out,
        total_users=db.query(func.count(User.id)).scalar() or 0,
        total_books=db.query(func.count(Book.id)).scalar() or 0,
    )


@router.delete("/libraries/{library_id}", status_code=204)
def delete_library(library_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    """말썽 도서관을 통째로 지운다(모든 멤버 계정·책·표지). 되돌리려면 그 전에 만든 백업으로 복구."""
    _personal_only()
    lib = db.get(Library, library_id)
    if lib is None:
        raise HTTPException(status_code=404, detail="도서관을 찾을 수 없습니다.")
    if admin.library_id == lib.id:
        raise HTTPException(status_code=400, detail="운영자 자신의 도서관은 지울 수 없습니다.")
    library_service.delete_library(db, lib)
    db.commit()


@router.get("/backup")
def download_backup(
    library_id: int | None = None, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    """암호화된 백업 파일. library_id가 없으면 모든 도서관."""
    _personal_only()
    if library_id is not None and db.get(Library, library_id) is None:
        raise HTTPException(status_code=404, detail="도서관을 찾을 수 없습니다.")
    blob, summary = site_backup.make_backup(db, library_id)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    scope = f"library{library_id}" if library_id else "all"
    return Response(
        content=blob,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="homelibrary-{scope}-{stamp}.hlbak"',
            # 화면에 "도서관 N곳 · 사용자 N명 · 책 N권"을 보여 주려고 숫자만 함께 보낸다
            "X-Backup-Summary": f"{summary['libraries']},{summary['users']},{summary['books']}",
            "Access-Control-Expose-Headers": "X-Backup-Summary, Content-Disposition",
        },
    )


@router.post("/restore", response_model=RestoreResult)
async def restore_backup(file: UploadFile, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    _personal_only()
    blob = await file.read()
    try:
        return site_backup.restore_backup(db, blob, admin)
    except site_backup.RestoreConflict as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/feedback", response_model=list[FeedbackOut])
def list_feedback(status: str | None = None, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    q = db.query(Feedback)
    if status:
        q = q.filter(Feedback.status == status)
    return q.order_by(Feedback.created_at.desc()).limit(500).all()


@router.put("/feedback/{feedback_id}", response_model=FeedbackOut)
def update_feedback(
    feedback_id: int, payload: FeedbackUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    item = db.get(Feedback, feedback_id)
    if item is None:
        raise HTTPException(status_code=404, detail="의견을 찾을 수 없습니다.")
    if payload.status is not None:
        if payload.status not in STATUSES:
            raise HTTPException(status_code=400, detail="상태가 올바르지 않습니다.")
        item.status = payload.status
    if payload.admin_reply is not None:
        item.admin_reply = payload.admin_reply.strip() or None
    db.commit()
    db.refresh(item)
    return item
