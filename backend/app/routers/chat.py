from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel

from app.database import get_db
from app.models.models import ChatSession, ChatMessage, RoadmapAnswer, Roadmap, User
from app.routers.auth import get_current_user
from app.services import ai

router = APIRouter()


class SessionCreate(BaseModel):
    project_id: str | None = None
    gost_id: str | None = None
    roadmap_id: str | None = None


class MessageIn(BaseModel):
    content: str


class MessageOut(BaseModel):
    id: str
    role: str
    content: str

    class Config:
        from_attributes = True


class SessionOut(BaseModel):
    id: str
    project_id: str | None
    gost_id: str | None
    roadmap_id: str | None

    class Config:
        from_attributes = True


class AiSuggestRequest(BaseModel):
    current_input: str = ""       # то, что пользователь уже начал вводить (может быть пустым)
    last_bot_message: str = ""    # последний вопрос бота — контекст для ИИ


class AiSuggestResponse(BaseModel):
    text: str


@router.post("/sessions", response_model=SessionOut)
async def create_session(body: SessionCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    session = ChatSession(
        user_id=user.id,
        project_id=body.project_id,
        gost_id=body.gost_id,
        roadmap_id=body.roadmap_id,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Если есть роадмап — бот сразу задаёт первый вопрос
    if body.roadmap_id:
        rm_result = await db.execute(select(Roadmap).where(Roadmap.id == body.roadmap_id))
        roadmap = rm_result.scalar_one_or_none()
        if roadmap and roadmap.structure:
            first = roadmap.structure[0]
            greeting = (
                f"Привет! Я помогу тебе заполнить документ по {first.get('section', 'разделу 1')}.\n\n"
                f"**{first.get('question', 'Расскажи подробнее')}**"
            )
            bot_msg = ChatMessage(session_id=session.id, role="bot", content=greeting)
            db.add(bot_msg)
            await db.commit()

    return session


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(ChatSession).where(ChatSession.user_id == user.id))
    return result.scalars().all()


@router.get("/sessions/{session_id}/messages", response_model=list[MessageOut])
async def get_messages(session_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at)
    )
    return result.scalars().all()


@router.post("/sessions/{session_id}/messages", response_model=list[MessageOut])
async def send_message(
    session_id: str,
    body: MessageIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sess_result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user.id)
    )
    session = sess_result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Сессия не найдена")

    # Сохраняем сообщение пользователя
    user_msg = ChatMessage(session_id=session_id, role="user", content=body.content)
    db.add(user_msg)

    bot_reply = ""

    # Если сессия привязана к роадмапу — работаем в режиме анкеты
    if session.roadmap_id:
        rm_result = await db.execute(select(Roadmap).where(Roadmap.id == session.roadmap_id))
        roadmap = rm_result.scalar_one_or_none()

        if roadmap:
            structure = roadmap.structure  # list[{section, description, question}]

            # Считаем сколько ответов уже есть
            count_result = await db.execute(
                select(func.count()).where(RoadmapAnswer.session_id == session_id)
            )
            answered_count = count_result.scalar()

            # Сохраняем ответ на текущий вопрос
            if answered_count < len(structure):
                answer = RoadmapAnswer(
                    roadmap_id=session.roadmap_id,
                    session_id=session_id,
                    question_index=answered_count,
                    answer=body.content,
                )
                db.add(answer)
                next_index = answered_count + 1

                if next_index < len(structure):
                    # Задаём следующий вопрос
                    next_item = structure[next_index]
                    bot_reply = (
                        f"Записал! Переходим к следующему разделу: **{next_item['section']}**\n\n"
                        f"**{next_item['question']}**"
                    )
                else:
                    # Все вопросы отвечены
                    bot_reply = (
                        "Отлично! Все разделы заполнены 🎉\n\n"
                        "Можешь генерировать документ через кнопку «Создать документ»."
                    )
            else:
                bot_reply = "Все вопросы уже отвечены. Нажми «Создать документ» чтобы получить файл."
    else:
        # Обычный чат без роадмапа — заглушка
        bot_reply = "я понял! Ок. Будет сделано."

    bot_msg = ChatMessage(session_id=session_id, role="bot", content=bot_reply)
    db.add(bot_msg)

    await db.commit()
    await db.refresh(user_msg)
    await db.refresh(bot_msg)

    return [user_msg, bot_msg]


@router.post("/sessions/{session_id}/ai-suggest", response_model=AiSuggestResponse)
async def ai_suggest(
    session_id: str,
    body: AiSuggestRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Нейропомощник: предлагает вариант ответа на текущий вопрос роадмапа.
    Принимает последний вопрос бота и черновик пользователя (если есть),
    возвращает готовый текст ответа.
    """
    sess_result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user.id)
    )
    session = sess_result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Сессия не найдена")
    if not session.roadmap_id:
        raise HTTPException(422, "Нейропомощник доступен только в сессиях с роадмапом")

    # Получаем роадмап и текущий вопрос
    rm_result = await db.execute(select(Roadmap).where(Roadmap.id == session.roadmap_id))
    roadmap = rm_result.scalar_one_or_none()
    if not roadmap:
        raise HTTPException(404, "Роадмап не найден")

    count_result = await db.execute(
        select(func.count()).where(RoadmapAnswer.session_id == session_id)
    )
    answered_count = count_result.scalar()
    structure = roadmap.structure

    if answered_count >= len(structure):
        raise HTTPException(422, "Все вопросы уже отвечены")

    current_item = structure[answered_count]
    section = current_item.get("section", "")
    description = current_item.get("description", "")
    question = current_item.get("question", body.last_bot_message)

    system = """Ты — опытный технический писатель, специалист по технической документации.

Твоя задача — помочь пользователю ответить на вопрос при заполнении технического документа.
Напиши конкретный, профессиональный ответ от лица заказчика/разработчика системы:
- Деловой стиль, конкретные формулировки
- Без вводных фраз типа «В ответ на вопрос...» или «Согласно требованиям...»
- Если пользователь уже начал вводить — развей и дополни его мысль
- 3–7 предложений, по делу
- Отвечай ТОЛЬКО текстом ответа, без пояснений"""

    hint = f"\nЧерновик пользователя: {body.current_input}" if body.current_input.strip() else ""

    user_message = f"""Раздел документа: {section}
Описание раздела: {description}
Вопрос: {question}{hint}

Напиши профессиональный ответ на этот вопрос."""

    try:
        text = await ai.chat(
            [{"role": "user", "content": user_message}],
            system=system,
            temperature=0.6,
        )
        return AiSuggestResponse(text=text.strip())
    except Exception as e:
        raise HTTPException(500, f"Ошибка нейропомощника: {str(e)}")


@router.get("/sessions/{session_id}/progress")
async def get_progress(session_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Сколько вопросов отвечено и сколько осталось"""
    sess_result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user.id)
    )
    session = sess_result.scalar_one_or_none()
    if not session or not session.roadmap_id:
        return {"answered": 0, "total": 0, "done": True}

    rm_result = await db.execute(select(Roadmap).where(Roadmap.id == session.roadmap_id))
    roadmap = rm_result.scalar_one_or_none()
    total = len(roadmap.structure) if roadmap else 0

    count_result = await db.execute(
        select(func.count()).where(RoadmapAnswer.session_id == session_id)
    )
    answered = count_result.scalar()

    return {"answered": answered, "total": total, "done": answered >= total}


class ImproveRequest(BaseModel):
    text: str
    question: str = ""


@router.post("/improve")
async def improve_text(
    body: ImproveRequest,
    _=Depends(get_current_user),
):
    from app.services.ai import chat as ai_chat
    system = """Ты помощник по написанию технической документации.
Улучши текст пользователя: сделай его профессиональным и чётким для технического документа.
Сохрани смысл и все факты. Отвечай только улучшенным текстом без пояснений."""
    question_hint = f"Вопрос: {body.question}\n\n" if body.question else ""
    user_message = f"{question_hint}Текст пользователя:\n{body.text}\n\nНапиши улучшенный вариант."
    try:
        improved = await ai_chat([{"role": "user", "content": user_message}], system=system, temperature=0.4)
        return {"original": body.text, "improved": improved.strip()}
    except Exception as e:
        raise HTTPException(500, f"Ошибка: {str(e)}")
