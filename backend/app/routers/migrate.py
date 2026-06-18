from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.database import get_db
from app.routers.auth import require_admin

router = APIRouter()

@router.post("/run")
async def run_migrations(db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    """Запускает все pending миграции"""
    results = []
    migrations = [
        ("roadmaps.name", "ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS name VARCHAR DEFAULT ''"),
        ("generated_docs.title", "ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS title VARCHAR DEFAULT ''"),
        ("generated_docs.cloud_docx_link", "ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS cloud_docx_link VARCHAR"),
        ("generated_docs.cloud_pdf_link", "ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS cloud_pdf_link VARCHAR"),
        ("gost_files.meta_schema", "ALTER TABLE gost_files ADD COLUMN IF NOT EXISTS meta_schema JSONB"),
        ("generated_docs.sections_content", "ALTER TABLE generated_docs ADD COLUMN IF NOT EXISTS sections_content JSONB"),
        ("generated_docs.session_nullable", "ALTER TABLE generated_docs ALTER COLUMN session_id DROP NOT NULL"),
        ("generated_docs.roadmap_nullable", "ALTER TABLE generated_docs ALTER COLUMN roadmap_id DROP NOT NULL"),
        ("gost_templates", """CREATE TABLE IF NOT EXISTS gost_templates (
            id VARCHAR PRIMARY KEY,
            gost_id VARCHAR UNIQUE REFERENCES gost_files(id),
            default_prompt TEXT NOT NULL,
            current_prompt TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )"""),
    ]
    for name, sql in migrations:
        try:
            await db.execute(text(sql))
            await db.commit()
            results.append({"migration": name, "status": "ok"})
        except Exception as e:
            results.append({"migration": name, "status": "error", "error": str(e)})
    return {"results": results}
