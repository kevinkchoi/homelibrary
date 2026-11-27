from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app import library_scope
from app.auth.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.services.export_service import build_export_bytes, build_export_zip
from app.services.import_service import import_from_upload

router = APIRouter(prefix="/api", tags=["import-export"])


@router.get("/export/excel")
def export_excel(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    data = build_export_zip(db, current_user, "excel")
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=homelibrary_export_excel.zip"},
    )


@router.get("/export/csv")
def export_csv(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    data = build_export_zip(db, current_user, "csv")
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=homelibrary_export_csv.zip"},
    )


@router.get("/export/excel/list")
def export_excel_list(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """표지 없이 **목록만** — 일괄 편집용. 표지를 넣으면 845권에 150MB라 엑셀에서 열기 힘들다."""
    data = build_export_bytes(db, current_user, "excel")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=homelibrary_list.xlsx"},
    )


@router.get("/export/csv/list")
def export_csv_list(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """표지 없이 목록만 (CSV)."""
    data = build_export_bytes(db, current_user, "csv")
    return Response(
        content=data,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=homelibrary_list.csv"},
    )


@router.post("/import/excel")
async def import_excel(
    file: UploadFile,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    library_scope.ensure_can_edit(current_user)  # 가져오기는 책을 넣고 고친다
    data = await file.read()
    try:
        result = import_from_upload(db, current_user, file.filename or "", data, "excel")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=400, detail="파일을 처리하는 중 오류가 발생했습니다. 형식을 확인해주세요.")
    return result


@router.post("/import/csv")
async def import_csv(
    file: UploadFile,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    library_scope.ensure_can_edit(current_user)  # 가져오기는 책을 넣고 고친다
    data = await file.read()
    try:
        result = import_from_upload(db, current_user, file.filename or "", data, "csv")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=400, detail="파일을 처리하는 중 오류가 발생했습니다. 형식을 확인해주세요.")
    return result
