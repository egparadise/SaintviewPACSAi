"""로컬 서버 폴더 공유 — server.network.local_share_dir의 파일 목록/다운로드.

워크리스트 [Local Server] 버튼에서 사용. 경로 이탈(path traversal) 방지를 위해
공유 루트 안의 파일만 접근을 허용한다.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.db import get_db
from app.services.settings_service import get_setting

router = APIRouter(prefix="/api/share", tags=["share"])


def _share_root(db: Session) -> Path:
    cfg = get_setting(db, "server.network", default={}) or {}
    raw = str(cfg.get("local_share_dir", "") or "").strip()
    if not raw:
        raise HTTPException(status_code=404, detail="공유 디렉토리가 설정되지 않았습니다 — 설정>서버 네트워크")
    root = Path(raw).resolve()
    if not root.is_dir():
        raise HTTPException(status_code=404, detail=f"공유 디렉토리가 존재하지 않습니다: {raw}")
    return root


@router.get("")
def list_share(db: Session = Depends(get_db), user: dict = Depends(current_user)):
    root = _share_root(db)
    items = []
    for p in sorted(root.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True)[:200]:
        try:
            st = p.stat()
            items.append({
                "name": p.name,
                "is_dir": p.is_dir(),
                "size": st.st_size if p.is_file() else 0,
                "mtime": int(st.st_mtime),
            })
        except OSError:
            continue
    return {"dir": str(root), "items": items}


@router.get("/file")
def get_share_file(name: str, db: Session = Depends(get_db), user: dict = Depends(current_user)):
    root = _share_root(db)
    target = (root / name).resolve()
    if root not in target.parents and target != root:
        raise HTTPException(status_code=400, detail="허용되지 않은 경로")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")
    return FileResponse(target, filename=target.name)
