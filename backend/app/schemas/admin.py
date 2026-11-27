from datetime import datetime

from pydantic import BaseModel, Field


class AdminLibrary(BaseModel):
    """운영자에게 보이는 도서관 한 줄 — **개인정보·책 내용은 없다**(사용자 요구, 2026-11-27).
    아이디는 말썽 사용자를 지우는 데 필요해서 보인다. 이메일·책 제목·서평은 보이지 않는다."""

    id: int
    name: str
    owner_username: str | None
    member_count: int
    book_count: int
    created_at: datetime | None
    members: list[str]  # 아이디만


class AdminLibraryList(BaseModel):
    libraries: list[AdminLibrary]
    total_users: int
    total_books: int


class RestoreResult(BaseModel):
    libraries: int
    users: int
    books: int
    covers: int
    replaced: list[str]


class FeedbackIn(BaseModel):
    category: str = "idea"
    body: str = Field(min_length=2, max_length=4000)


class FeedbackOut(BaseModel):
    id: int
    username: str
    category: str
    body: str
    status: str
    admin_reply: str | None
    created_at: datetime
    updated_at: datetime | None

    class Config:
        from_attributes = True


class FeedbackUpdate(BaseModel):
    status: str | None = None
    admin_reply: str | None = Field(default=None, max_length=4000)
