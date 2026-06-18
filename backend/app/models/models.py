import uuid
from datetime import datetime
from sqlalchemy import String, Text, ForeignKey, Integer, JSON, DateTime, func
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
    projects: Mapped[list["Project"]] = relationship(back_populates="user")
    chat_sessions: Mapped[list["ChatSession"]] = relationship(back_populates="user")
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
    prompts: Mapped[list["PromptGost"]] = relationship(back_populates="gost")
    roadmaps: Mapped[list["Roadmap"]] = relationship(back_populates="gost")
    chat_sessions: Mapped[list["ChatSession"]] = relationship(back_populates="gost")
    template: Mapped["GostTemplate | None"] = relationship(back_populates="gost", uselist=False)


class GostTemplate(Base):
    __tablename__ = "gost_templates"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    gost_id: Mapped[str] = mapped_column(String, ForeignKey("gost_files.id"), unique=True)
    default_prompt: Mapped[str] = mapped_column(Text)
    current_prompt: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    gost: Mapped["GostFile"] = relationship(back_populates="template")


class Prompt(Base):
    __tablename__ = "prompts"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    title: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    gosts: Mapped[list["PromptGost"]] = relationship(back_populates="prompt")
    roadmaps: Mapped[list["Roadmap"]] = relationship(back_populates="prompt")


class PromptGost(Base):
    __tablename__ = "prompt_gost"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    prompt_id: Mapped[str] = mapped_column(String, ForeignKey("prompts.id"))
    gost_id: Mapped[str] = mapped_column(String, ForeignKey("gost_files.id"))
    prompt: Mapped["Prompt"] = relationship(back_populates="gosts")
    gost: Mapped["GostFile"] = relationship(back_populates="prompts")


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    user: Mapped["User"] = relationship(back_populates="projects")
    chat_sessions: Mapped[list["ChatSession"]] = relationship(back_populates="project")


class Roadmap(Base):
    __tablename__ = "roadmaps"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    gost_id: Mapped[str] = mapped_column(String, ForeignKey("gost_files.id"))
    prompt_id: Mapped[str] = mapped_column(String, ForeignKey("prompts.id"))
    name: Mapped[str] = mapped_column(String, default="")  # название роадмапа
    structure: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    gost: Mapped["GostFile"] = relationship(back_populates="roadmaps")
    prompt: Mapped["Prompt"] = relationship(back_populates="roadmaps")
    chat_sessions: Mapped[list["ChatSession"]] = relationship(back_populates="roadmap")
    answers: Mapped[list["RoadmapAnswer"]] = relationship(back_populates="roadmap")
    generated_docs: Mapped[list["GeneratedDoc"]] = relationship(back_populates="roadmap")


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    project_id: Mapped[str | None] = mapped_column(String, ForeignKey("projects.id"), nullable=True)
    gost_id: Mapped[str | None] = mapped_column(String, ForeignKey("gost_files.id"), nullable=True)
    roadmap_id: Mapped[str | None] = mapped_column(String, ForeignKey("roadmaps.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    user: Mapped["User"] = relationship(back_populates="chat_sessions")
    project: Mapped["Project"] = relationship(back_populates="chat_sessions")
    gost: Mapped["GostFile"] = relationship(back_populates="chat_sessions")
    roadmap: Mapped["Roadmap"] = relationship(back_populates="chat_sessions")
    messages: Mapped[list["ChatMessage"]] = relationship(back_populates="session")
    answers: Mapped[list["RoadmapAnswer"]] = relationship(back_populates="session")
    generated_docs: Mapped[list["GeneratedDoc"]] = relationship(back_populates="session")


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    session_id: Mapped[str] = mapped_column(String, ForeignKey("chat_sessions.id"))
    role: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    session: Mapped["ChatSession"] = relationship(back_populates="messages")


class RoadmapAnswer(Base):
    __tablename__ = "roadmap_answers"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    roadmap_id: Mapped[str] = mapped_column(String, ForeignKey("roadmaps.id"))
    session_id: Mapped[str] = mapped_column(String, ForeignKey("chat_sessions.id"))
    question_index: Mapped[int] = mapped_column(Integer)
    answer: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    roadmap: Mapped["Roadmap"] = relationship(back_populates="answers")
    session: Mapped["ChatSession"] = relationship(back_populates="answers")


class GeneratedDoc(Base):
    __tablename__ = "generated_docs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    session_id: Mapped[str | None] = mapped_column(String, ForeignKey("chat_sessions.id"), nullable=True)
    roadmap_id: Mapped[str | None] = mapped_column(String, ForeignKey("roadmaps.id"), nullable=True)
    title: Mapped[str] = mapped_column(String, default="")  # название документа
    sections_content: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    docx_path: Mapped[str | None] = mapped_column(String, nullable=True)
    pdf_path: Mapped[str | None] = mapped_column(String, nullable=True)
    cloud_docx_link: Mapped[str | None] = mapped_column(String, nullable=True)
    cloud_pdf_link: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    user: Mapped["User"] = relationship(back_populates="generated_docs")
    session: Mapped["ChatSession"] = relationship(back_populates="generated_docs")
    roadmap: Mapped["Roadmap"] = relationship(back_populates="generated_docs")
