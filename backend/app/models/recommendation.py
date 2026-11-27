from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Recommendation(Base):
    """[새책 추천] 화면이 보여 주는 한 권.

    **왜 DB에 두는가**: 목록 한 벌을 만들려면 알라딘을 여러 번 부르고 Claude로 한 번 더
    걸러야 해서 몇 초가 걸리고 비용도 든다. 화면을 열 때마다 그걸 하면 느리고 아깝다.
    그렇다고 파이썬 메모리에 두면 **컨테이너를 다시 띄울 때마다 사라진다**(배포가 잦다).
    파일로 두는 것도 안 된다 — 쓸 만한 볼륨이 `storage/images` 뿐인데 거기엔 **고아 파일
    스윕**이 돌아서 언젠가 지워진다. 그래서 테이블로 둔다.

    갱신은 **통째로 교체**한다(전부 지우고 새로 넣기). 한 배치 안의 행들은 `generated_at`이
    같고, 화면은 그 값을 "마지막 갱신"으로 보여 준다.
    """

    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(primary_key=True)
    # personal 모드(homelibrary.kr)에서는 **사람마다 자기 서재에 맞춘 목록**을 따로 둔다(0009).
    # family 모드는 NULL(가족 공용 한 벌).
    owner_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )

    # 이 배치를 만든 시각. 같은 배치의 행은 모두 같은 값을 갖는다(하루 지나면 다시 만든다).
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True,
        default=lambda: datetime.now(timezone.utc),
    )

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    author: Mapped[str | None] = mapped_column(String(255))
    publisher: Mapped[str | None] = mapped_column(String(255))
    # 알라딘이 주는 출간일 문자열(YYYY-MM-DD). 날짜로 바꾸지 않는 이유는 예약 출간처럼
    # 형식이 어긋나는 값이 가끔 오는데, 그것 때문에 배치 전체가 실패하면 안 되기 때문이다.
    pub_date: Mapped[str | None] = mapped_column(String(20))
    isbn: Mapped[str | None] = mapped_column(String(20), index=True)
    category: Mapped[str | None] = mapped_column(String(300))
    cover_url: Mapped[str | None] = mapped_column(String(500))
    link: Mapped[str | None] = mapped_column(String(500))

    # "신간" / "주목신간" / "베스트셀러" — 어디서 걸렸는지 화면에 배지로 보여 준다.
    source: Mapped[str | None] = mapped_column(String(20))

    # Claude가 붙인 추천 이유 한두 줄. 이게 없으면 "그냥 신간 목록"과 다를 바가 없다.
    reason: Mapped[str | None] = mapped_column(Text)
    # Claude가 매긴 적합도(0~100). 정렬에만 쓴다.
    score: Mapped[float | None] = mapped_column(Float)

    # 서재에서 어떤 결을 보고 골랐는지(예: "인류학, 우주"). 왜 떴는지 납득시키는 용도.
    matched_on: Mapped[str | None] = mapped_column(String(300))

    rank: Mapped[int | None] = mapped_column(Integer)
