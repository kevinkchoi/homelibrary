from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserRegister(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    # family 모드에서는 필수(라우터가 검사), personal 모드(homelibrary.kr) 가입에서는 선택.
    email: EmailStr | None = None
    password: str = Field(min_length=6, max_length=100)
    # personal 모드 가입에 필요한 초대 코드(운영자가 .env의 SIGNUP_INVITE_CODE로 정한다)
    invite_code: str | None = Field(default=None, max_length=100)

    @field_validator("email", mode="before")
    @classmethod
    def _blank_email_is_none(cls, v):
        # 화면의 빈 입력칸은 ""로 온다. 그대로 두면 EmailStr 검사에서 422가 난다.
        return None if isinstance(v, str) and not v.strip() else v

    # 휴대폰 키보드는 자동완성/자동수정 과정에서 앞뒤 공백을 붙이는 일이 잦다.
    # 공백이 섞인 채로 저장되면 나중에 로그인에서 계속 실패한다(눈에 보이지도 않는다).
    # mode="before"라 min_length 검사는 **공백을 제거한 값**에 적용된다.
    @field_validator("username", mode="before")
    @classmethod
    def _strip_username(cls, v):
        return v.strip() if isinstance(v, str) else v


class UserLogin(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    email: EmailStr | None = None
    # is_admin = **사이트 운영자**(family 모드에선 가족 관리자). 도서관 안의 권한은 library_role.
    is_admin: bool
    created_at: datetime
    library_id: int | None = None
    library_role: str = "owner"
    welcome_seen_at: datetime | None = None

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserAdminUpdate(BaseModel):
    is_admin: bool


class UserPasswordReset(BaseModel):
    password: str = Field(min_length=6, max_length=100)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=100)
    new_password: str = Field(min_length=6, max_length=100)


class AiKeyIn(BaseModel):
    api_key: str = Field(min_length=1, max_length=300)


class AiKeyStatus(BaseModel):
    # 표지 사진 인식·새책 추천을 이 사용자가 지금 쓸 수 있는가
    available: bool
    # "user" = 자기 키(personal), "server" = 서버 키(family), None = 없음
    source: str | None = None
    # 자기 키의 끝 4자리. 평문은 절대 돌려주지 않는다.
    last4: str | None = None
    # 이 서버에서 사용자가 자기 키를 넣을 수 있는가(personal 모드)
    user_key_allowed: bool = False


class PublicConfig(BaseModel):
    library_mode: str
    signup_enabled: bool
    signup_requires_invite: bool


# ── 도서관(personal 모드) ─────────────────────────────────────────────────
class LibraryMember(BaseModel):
    id: int
    username: str
    role: str
    created_at: datetime
    book_count: int = 0  # 이 사람이 넣은 책 수


class LibraryInfo(BaseModel):
    id: int
    name: str
    my_role: str
    can_manage: bool
    book_count: int
    members: list[LibraryMember]
    # 관리자(주인·공동 관리자)에게만 보인다
    invite_code: str | None = None
    invite_role: str | None = None


class LibraryRename(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class MemberCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=6, max_length=100)
    email: EmailStr | None = None
    role: str = "editor"

    @field_validator("username", mode="before")
    @classmethod
    def _strip_username(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("email", mode="before")
    @classmethod
    def _blank_email_is_none(cls, v):
        return None if isinstance(v, str) and not v.strip() else v


class MemberRole(BaseModel):
    role: str


class InviteCodeRequest(BaseModel):
    role: str = "editor"
