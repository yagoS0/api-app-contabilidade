from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    max_upload_bytes: int = Field(default=15 * 1024 * 1024, validation_alias="MAX_UPLOAD_BYTES")
    ocr_enabled: bool = Field(default=False, validation_alias="OCR_ENABLED")
    min_text_chars: int = Field(default=20, validation_alias="MIN_TEXT_CHARS")
    log_raw_text: bool = Field(default=False, validation_alias="LOG_RAW_TEXT")


settings = Settings()
