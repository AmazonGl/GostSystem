from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.routers.auth import get_current_user
from app.models.models import User, GostFile
from app.services import ai

router = APIRouter()

SITE_CONTEXT = """
Ты — нейропомощник платформы «ГОСТ Документы». Помогаешь пользователям работать с сайтом.

Разделы сайта:
- **Чат** (/chat) — заполнение документа по роадмапу: бот задаёт вопросы по разделам ГОСТа, пользователь отвечает
- **Документы** (/docs) — генерация DOCX/PDF из заполненных сессий, просмотр, редактирование, скачивание
- **Профиль** (/profile) — настройки пользователя

Для администраторов:
- **ГОСТы** (/admin/gosts) — загрузка и удаление стандартов
- **Хранилище** (/admin/storage) — управление ГОСТами с мета-информацией (ГОСТ 19, ГОСТ 2), папки
- **Шаблоны** (/admin/templates) — промпты по каждому ГОСТу, можно редактировать и сбросить
- **Промпты** (/admin/prompts) — инструкции для нейросети
- **Роадмапы** (/admin/roadmaps) — структура вопросов по ГОСТу
- **Пользователи**, **Статистика**

Типичный workflow:
1. Пользователь идёт в «Новый документ», выбирает ГОСТ, заполняет разделы вручную → готовый DOCX
2. Или через «Чат»: создаёт сессию с роадмапом, отвечает на вопросы бота → генерирует документ на странице «Документы»
3. В обоих случаях документ можно редактировать и скачать

Отвечай кратко, по делу, на русском. Помогай с навигацией, объясняй шаги, предлагай улучшения текста если пользователь просит.
"""


class AssistantMessage(BaseModel):
    content: str
    page_context: str = ""
    section_context: str = ""


class SuggestGostRequest(BaseModel):
    title: str


class SuggestGostResponse(BaseModel):
    gost_id: Optional[str]
    gost_code: Optional[str]
    message: Optional[str]


class AssistantResponse(BaseModel):
    reply: str


@router.post("/chat", response_model=AssistantResponse)
async def assistant_chat(body: AssistantMessage, user: User = Depends(get_current_user)):
    system = SITE_CONTEXT
    if body.page_context:
        system += f"\n\nТекущая страница пользователя: {body.page_context}"
    if body.section_context:
        system += f"\n\nПользователь сейчас заполняет раздел документа:\n{body.section_context}"
    if user.role == "admin":
        system += "\nПользователь — администратор, может видеть все разделы."

    reply = await ai.assistant_reply(body.content, system=system)
    return {"reply": reply}


@router.post("/suggest-gost", response_model=SuggestGostResponse)
async def suggest_gost(
    body: SuggestGostRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if len(body.title.strip()) < 5:
        return SuggestGostResponse(gost_id=None, gost_code=None, message=None)

    result = await db.execute(select(GostFile))
    gosts = result.scalars().all()
    if not gosts:
        return SuggestGostResponse(gost_id=None, gost_code=None, message=None)

    t = body.title.lower()
    kw_19 = ['программ', 'еспд', 'гост 19', 'по ', 'приложени']
    kw_34 = ['автоматизир', 'систем', ' ас ', 'гост 34', 'аис', 'информационн', 'платформ', 'сервис', 'crm', 'erp']

    score_19 = sum(1 for k in kw_19 if k in t)
    score_34 = sum(1 for k in kw_34 if k in t)

    target = '19' if score_19 > score_34 and score_19 > 0 else ('34' if score_34 > 0 else None)
    if not target:
        return SuggestGostResponse(gost_id=None, gost_code=None, message=None)

    for gost in gosts:
        meta = gost.meta_schema or {}
        series = str(meta.get('series', ''))
        if series == target or target in (gost.code or ''):
            return SuggestGostResponse(
                gost_id=gost.id,
                gost_code=gost.code,
                message=f"Похоже на документ серии ГОСТ {target} — рекомендуем «{gost.code}». Применить структуру разделов?",
            )

    return SuggestGostResponse(gost_id=None, gost_code=None, message=None)
