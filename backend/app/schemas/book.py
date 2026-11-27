from datetime import datetime

from pydantic import BaseModel, Field


class BookBase(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    author: str = Field(min_length=1, max_length=255)
    publisher: str = Field(min_length=1, max_length=255)
    pub_year: int | None = None
    shelf_location: str | None = None
    category: str | None = None
    isbn: str | None = None
    translator: str | None = None
    original_publisher: str | None = None
    original_pub_year: int | None = None
    comment: str | None = None


class BookCreate(BookBase):
    cover_image_path: str | None = None


class BookUpdate(BookBase):
    cover_image_path: str | None = None


class BookOut(BookBase):
    id: int
    cover_image_path: str | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class BookListResponse(BaseModel):
    items: list[BookOut]
    total: int
    # 검색어 그대로는 못 찾아 **단어를 나눠** 찾은 결과인지. 화면에서 그 사실을 알려주기 위한 것.
    # (나눠 찾으면 단어들이 제각각 떨어져 있는 책도 걸리므로 사용자가 알고 봐야 한다)
    relaxed: bool = False
    # 저자 이름을 **소리로** 맞춰 찾은 결과인지(`Laurent` → `로랑`).
    # 글자로는 하나도 못 찾았을 때만 쓰는 마지막 수단이라, 화면에서 그 사실을 알려야 한다.
    sounds_like: bool = False


class BulkDeleteRequest(BaseModel):
    ids: list[int]


class CategoryCount(BaseModel):
    """카테고리 하나와 그 카테고리에 속한 책 수."""

    name: str | None  # None = 카테고리가 비어 있는 책들
    count: int


class ShelfCount(BaseModel):
    """책꽂이 한 곳과 거기 꽂힌 책 수."""

    name: str | None  # None = 책꽂이가 비어 있는 책들
    count: int


class CategoryRenameRequest(BaseModel):
    """카테고리 이름 바꾸기 / 합치기.

    `to`가 이미 있는 이름이면 자연스럽게 **합쳐진다**(따로 합치기 기능을 두지 않은 이유).
    `to`를 비우면 카테고리를 지운다(분류 없음으로).
    """

    from_name: str | None  # None = 카테고리가 비어 있는 책들
    to_name: str | None


class BulkShelfRequest(BaseModel):
    """고른 책들의 책꽂이 위치를 한꺼번에 지정."""

    ids: list[int]
    shelf_location: str | None


class BulkUpdateResult(BaseModel):
    updated: int


class DuplicateCheckResult(BaseModel):
    """이미 등록된 같은 책이 있는지 확인한 결과 — 이 앱의 존재 이유(중복 구매 방지)를 등록 단계에서 돕는다.

    두 종류를 **분리해서** 돌려주는 이유: ISBN이 같으면 판까지 동일한 사실상 확실한 중복이지만,
    제목만 같은 책은 다른 판/다른 저자의 동명 도서일 수 있어 사용자가 직접 판단해야 한다.
    """

    isbn_matches: list[BookOut] = []  # ISBN이 같은 책 — 사실상 확실한 중복
    title_matches: list[BookOut] = []  # 제목이 같은 책 — 판/저자가 다를 수 있어 참고용


class DuplicateGroup(BaseModel):
    """이미 등록돼 있는 중복 책 한 묶음. 서재를 점검해 **기존** 중복을 찾아낼 때 쓴다
    (등록 시점에 막는 check-duplicate와 달리, 이미 들어간 중복을 사후에 찾는 용도)."""

    reason: str  # "isbn" = ISBN이 같음(확실) / "title" = 제목이 같음(판이 다를 수 있음)
    key: str  # 묶은 기준값 (정규화된 ISBN 또는 제목)
    books: list[BookOut]


class DuplicateGroupList(BaseModel):
    groups: list[DuplicateGroup]
    # 중복을 모두 한 권씩만 남긴다면 줄어드는 권수(그룹마다 권수-1의 합).
    # "정리하면 몇 권이 줄어드는지"를 화면에 바로 보여주기 위한 값.
    redundant_count: int
    # 사용자가 "다른 책"이라고 확인해 둬서 목록에서 빠진 묶음 수.
    # 0이 아니면 화면에 "N묶음은 다른 책으로 표시됨 — 다시 보기"를 띄운다.
    acknowledged_count: int = 0


class DuplicateAckRequest(BaseModel):
    """"이 묶음은 중복이 아니다"라고 표시하거나 되돌릴 때 쓰는 요청."""

    reason: str  # "isbn" | "title"
    key: str


class DuplicateAckResult(BaseModel):
    acknowledged: int  # 이번에 새로 표시한 묶음 수


class CoverRepairResult(BaseModel):
    """깨진 표지 일괄 복구 결과."""

    checked: int  # 검사한(깨져 있던) 책 수
    refetched: int  # 인터넷에서 표지를 다시 찾아 붙인 수
    cleared: int  # 못 찾아서 '표지 없음'으로 정리한 수


class UnusedImageReport(BaseModel):
    """어느 책도 쓰지 않는 표지 이미지 현황(정리 전에 무엇이 지워질지 확인용)."""

    orphan_count: int  # 지울 수 있는 파일 수
    orphan_bytes: int  # 그 파일들이 차지하는 용량
    referenced_count: int  # 실제로 쓰이고 있는 표지 수(대조용)
    sample: list[str] = []  # 파일명 예시 몇 개


class ImageSweepResult(BaseModel):
    """이미지 정리 실행 결과."""

    temp_removed: int  # 채택되지 않은 임시 이미지(tmp/) 삭제 수
    orphan_removed: int  # 영구 저장소의 고아 이미지 삭제 수


class CoverCandidate(BaseModel):
    """인터넷에서 찾은 표지 후보 한 개. image_path는 서버가 이미 내려받아 저장해 둔 임시 경로
    (`tmp/...`)라서 프론트에서 `/api/images/<path>`로 바로 미리보기할 수 있다."""

    image_path: str
    source: str | None = None  # "aladin" | "kyobo" | "google_books"
    title: str | None = None
    author: str | None = None
    translator: str | None = None
    publisher: str | None = None
    pub_year: int | None = None
    category: str | None = None
    isbn: str | None = None


class BookMetadata(BaseModel):
    """표지 검색과 함께 찾은 책의 서지 정보(가장 관련도 높은 결과 기준).
    프론트가 폼의 **빈 칸만** 이 값으로 채운다 — 사진 인식이 틀려 사용자가 제목/저자를 고쳐 넣고
    표지를 찾으면, 출판사·연도·카테고리·번역자 등 나머지 정보를 자동으로 보완하기 위함."""

    title: str | None = None
    author: str | None = None
    translator: str | None = None
    publisher: str | None = None
    pub_year: int | None = None
    category: str | None = None
    isbn: str | None = None


class CoverCandidateList(BaseModel):
    candidates: list[CoverCandidate]
    metadata: BookMetadata | None = None


class IsbnLookup(BaseModel):
    """ISBN으로 책 정보를 조회한 결과. 새책 추가 시 ISBN만 입력하면 나머지 정보를 채우는 용도.
    cover_image_path는 서버가 표지를 내려받아 저장한 임시 경로(`tmp/...`)로, 저장 시 정식 보관된다."""

    found: bool = False
    title: str | None = None
    author: str | None = None
    translator: str | None = None
    publisher: str | None = None
    pub_year: int | None = None
    category: str | None = None
    isbn: str | None = None
    cover_image_path: str | None = None
