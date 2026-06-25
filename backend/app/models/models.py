import uuid
from datetime import datetime
from sqlalchemy import String, Text, ForeignKey, JSON, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String, default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    generated_docs: Mapped[list["GeneratedDoc"]] = relationship(back_populates="user")


class GostFile(Base):
    __tablename__ = "gost_files"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    code: Mapped[str] = mapped_column(String, index=True)
    title: Mapped[str] = mapped_column(String)
    file_path: Mapped[str] = mapped_column(String)
    file_type: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String)
    folder_path: Mapped[str] = mapped_column(String, default="/")
    meta_schema: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    template: Mapped["GostTemplate | None"] = relationship(back_populates="gost", uselist=False)


class GostTemplate(Base):
    """Авто-промпт по ГОСТу: создаётся при загрузке ГОСТа, хранит дефолтный и
    текущий промпт для подсказок по содержанию разделов."""
    __tablename__ = "gost_templates"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    gost_id: Mapped[str] = mapped_column(String, ForeignKey("gost_files.id"), unique=True)
    default_prompt: Mapped[str] = mapped_column(Text)
    current_prompt: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    gost: Mapped["GostFile"] = relationship(back_populates="template")


class DocTemplate(Base):
    """Загружаемый .docx-шаблон документа (ТЗ, РП, ПМИ и т.п.).

    Хранит сам файл шаблона и разобранную структуру его разделов.
    Может быть привязан к ГОСТу для подсказок по содержанию разделов.
    """
    __tablename__ = "doc_templates"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String)              # «Техническое задание»
    doc_type: Mapped[str] = mapped_column(String, default="")  # tz / rp / pmi ...
    file_path: Mapped[str] = mapped_column(String)         # путь к .docx
    structure: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # разделы из заголовков
    gost_id: Mapped[str | None] = mapped_column(String, ForeignKey("gost_files.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class GeneratedDoc(Base):
    """Сгенерированный документ пользователя (DOCX/PDF + содержимое разделов)."""
    __tablename__ = "generated_docs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String, default="")
    sections_content: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    docx_path: Mapped[str | None] = mapped_column(String, nullable=True)
    pdf_path: Mapped[str | None] = mapped_column(String, nullable=True)
    cloud_docx_link: Mapped[str | None] = mapped_column(String, nullable=True)
    cloud_pdf_link: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    user: Mapped["User"] = relationship(back_populates="generated_docs")
