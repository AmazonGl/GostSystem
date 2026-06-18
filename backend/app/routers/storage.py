import os
from fastapi import APIRouter, Depends, HTTPException
from app.routers.auth import require_admin
from app.config import settings

router = APIRouter()


@router.get("/tree")
async def get_tree(_=Depends(require_admin)):
    """Возвращает дерево папок хранилища ГОСТов"""
    root = settings.STORAGE_PATH
    os.makedirs(root, exist_ok=True)

    def walk(path: str, rel: str = "/") -> dict:
        entries = []
        try:
            for name in sorted(os.listdir(path)):
                full = os.path.join(path, name)
                rel_path = os.path.join(rel, name)
                if os.path.isdir(full):
                    entries.append({"name": name, "type": "folder", "path": rel_path, "children": walk(full, rel_path)})
                else:
                    entries.append({"name": name, "type": "file", "path": rel_path})
        except PermissionError:
            pass
        return entries

    return {"root": "/", "children": walk(root)}


@router.post("/folders")
async def create_folder(path: str, _=Depends(require_admin)):
    full_path = os.path.join(settings.STORAGE_PATH, path.lstrip("/"))
    os.makedirs(full_path, exist_ok=True)
    return {"ok": True, "path": path}


@router.delete("/folders")
async def delete_folder(path: str, _=Depends(require_admin)):
    full_path = os.path.join(settings.STORAGE_PATH, path.lstrip("/"))
    if not os.path.exists(full_path):
        raise HTTPException(404, "Папка не найдена")
    import shutil
    shutil.rmtree(full_path)
    return {"ok": True}
