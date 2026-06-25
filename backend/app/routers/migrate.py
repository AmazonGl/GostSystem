from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.database import get_db
from app.routers.auth import require_admin

router = APIRouter()


@router.post("/run")
async def run_migrations(db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    """Приводит БД к актуальной схеме: добавляет нужные колонки, удаляет
    устаревшие таблицы (роадмапы, чаты, промпты, проекты) и осиротевшие колонки.
    Идемпотентно — можно запускать повторно."""
    results = []
    migrations = [
        # --- актуальные колонки ---
        ("generated_docs.title", "ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS title VARCHAR DEFAULT ''"),
        ("generated_docs.cloud_docx_link", "ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS cloud_docx_link VARCHAR"),
        ("generated_docs.cloud_pdf_link", "ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS cloud_pdf_link VARCHAR"),
        ("generated_docs.sections_content", "ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS sections_content JSONB"),
        ("gost_files.meta_schema", "ALTER TABLE gost_files ADD COLUMN IF NOT EXISTS meta_schema JSONB"),
        ("gost_templates", """CREATE TABLE IF NOT EXISTS gost_templates (
            id VARCHAR PRIMARY KEY,
            gost_id VARCHAR UNIQUE REFERENCES gost_files(id),
            default_prompt TEXT NOT NULL,
            current_prompt TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )"""),
        ("doc_templates", """CREATE TABLE IF NOT EXISTS doc_templates (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL,
            doc_type VARCHAR DEFAULT '',
            file_path VARCHAR NOT NULL,
            structure JSONB,
            gost_id VARCHAR REFERENCES gost_files(id),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )"""),

        # --- очистка осиротевших колонок в generated_docs ---
        ("generated_docs.drop_session", "ALTER TABLE generated_docs DROP COLUMN IF EXISTS session_id"),
        ("generated_docs.drop_roadmap", "ALTER TABLE generated_docs DROP COLUMN IF EXISTS roadmap_id"),

        # --- удаление устаревших таблиц (порядок важен из-за внешних ключей) ---
        ("drop roadmap_answers", "DROP TABLE IF EXISTS roadmap_answers CASCADE"),
        ("drop chat_messages",   "DROP TABLE IF EXISTS chat_messages CASCADE"),
        ("drop chat_sessions",   "DROP TABLE IF EXISTS chat_sessions CASCADE"),
        ("drop roadmaps",        "DROP TABLE IF EXISTS roadmaps CASCADE"),
        ("drop prompt_gost",     "DROP TABLE IF EXISTS prompt_gost CASCADE"),
        ("drop prompts",         "DROP TABLE IF EXISTS prompts CASCADE"),
        ("drop projects",        "DROP TABLE IF EXISTS projects CASCADE"),
    ]
    for name, sql in migrations:
        try:
            await db.execute(text(sql))
            await db.commit()
            results.append({"migration": name, "status": "ok"})
        except Exception as e:
            await db.rollback()
            results.append({"migration": name, "status": "error", "error": str(e)})
    return {"results": results}
