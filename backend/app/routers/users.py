import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.models.models import User
from app.routers.auth import get_current_user, require_admin

router = APIRouter()


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    class Config:
        from_attributes = True


class UpdateProfileRequest(BaseModel):
    name: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class UpdateRoleRequest(BaseModel):
    role: str


@router.get("/me", response_model=UserOut)
async def get_me(user: User = Depends(get_current_user)):
    return user


@router.put("/me", response_model=UserOut)
async def update_profile(body: UpdateProfileRequest, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    user.name = body.name
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/me/password")
async def change_password(body: ChangePasswordRequest, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if not bcrypt.checkpw(body.old_password.encode(), user.password_hash.encode()):
        raise HTTPException(400, "Неверный текущий пароль")
    user.password_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    await db.commit()
    return {"ok": True}


@router.get("/", response_model=list[UserOut])
async def list_users(db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    result = await db.execute(select(User).order_by(User.created_at))
    return result.scalars().all()


@router.put("/{user_id}/role", response_model=UserOut)
async def update_role(user_id: str, body: UpdateRoleRequest, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    if body.role not in ("admin", "user"):
        raise HTTPException(400, "Роль должна быть admin или user")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    user.role = body.role
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/{user_id}")
async def delete_user(user_id: str, db: AsyncSession = Depends(get_db), current: User = Depends(require_admin)):
    if user_id == current.id:
        raise HTTPException(400, "Нельзя удалить себя")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    await db.delete(user)
    await db.commit()
    return {"ok": True}
