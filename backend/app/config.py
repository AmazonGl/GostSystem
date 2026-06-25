import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    STORAGE_PATH: str = "/storage/gosts"
    OLLAMA_BASE_URL: str = "http://172.17.0.1:11434"
    OLLAMA_MODEL: str = "mistral:7b"
    YANDEX_DISK_TOKEN: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
