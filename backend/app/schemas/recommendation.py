from datetime import datetime

from pydantic import BaseModel, ConfigDict


class RecommendationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    author: str | None = None
    publisher: str | None = None
    pub_date: str | None = None
    isbn: str | None = None
    category: str | None = None
    cover_url: str | None = None
    link: str | None = None
    source: str | None = None
    reason: str | None = None
    score: float | None = None
    matched_on: str | None = None


class RecommendationList(BaseModel):
    items: list[RecommendationOut]
    generated_at: datetime | None = None
    # Claude 선별이 실패했으면 이유가 비어 있다. 화면이 그 사실을 말해 줘야
    # "왜 이유가 없지?"를 사용자가 혼자 고민하지 않는다.
    curated: bool = True
