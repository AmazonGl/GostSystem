from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.routers import auth, users, gosts, prompts, chat, roadmaps, docs, storage, ollama, stats, templates, assistant

app = FastAPI(title="ГОСТ Документы", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


app.include_router(auth.router,      prefix="/api/auth",     tags=["auth"])
app.include_router(users.router,     prefix="/api/users",    tags=["users"])
app.include_router(gosts.router,     prefix="/api/gosts",    tags=["gosts"])
app.include_router(prompts.router,   prefix="/api/prompts",  tags=["prompts"])
app.include_router(chat.router,      prefix="/api/chat",     tags=["chat"])
app.include_router(roadmaps.router,  prefix="/api/roadmaps", tags=["roadmaps"])
app.include_router(docs.router,      prefix="/api/docs",     tags=["docs"])
app.include_router(storage.router,   prefix="/api/storage",  tags=["storage"])
app.include_router(ollama.router,    prefix="/api/ollama",   tags=["ollama"])
app.include_router(stats.router,     prefix="/api/stats",    tags=["stats"])
app.include_router(templates.router, prefix="/api/templates", tags=["templates"])
app.include_router(assistant.router, prefix="/api/assistant", tags=["assistant"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}

# Импортируем migrate роутер
from app.routers import migrate as migrate_router
app.include_router(migrate_router.router, prefix="/api/migrate", tags=["migrate"])
