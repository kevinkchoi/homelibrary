import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { myFeedback, sendFeedback } from "../api/feedback";
import { describeApiError } from "../utils/apiError.js";
import { isPersonal, useServerConfig } from "../utils/serverConfig.js";
import { ROLE_LABEL } from "../utils/permissions.js";
import "./Help.css";

/**
 * [도움말] — 사용법(자세히) + 의견 보내기 + 내가 보낸 의견 (사용자 요구, 2026-11-27).
 *
 * 탭은 주소(?tab=)에 싣는다 — 환영 안내·다른 화면에서 "의견 보내기"로 바로 보낼 수 있게, 뒤로 가기도 되게.
 * 사용법 글은 서버 형태(가족 공용 / 개인 서재)에 맞춰 조금 다르다.
 */
const TABS = [
  { key: "guide", label: "사용법" },
  { key: "feedback", label: "의견 보내기" },
  { key: "mine", label: "내가 보낸 의견" },
];

export default function Help() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "guide";

  return (
    <div className="help-page">
      <h1>도움말</h1>
      <div className="help-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={"help-tab" + (tab === t.key ? " active" : "")}
            onClick={() => setParams(t.key === "guide" ? {} : { tab: t.key }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "guide" && <Guide />}
      {tab === "feedback" && <FeedbackForm onSent={() => setParams({ tab: "mine" }, { replace: true })} />}
      {tab === "mine" && <MyFeedback />}
    </div>
  );
}

function Guide() {
  const { user } = useAuth();
  const personal = isPersonal(useServerConfig());

  const sections = [
    { id: "start", title: "처음 시작하기" },
    { id: "add", title: "책 넣기 — 바코드·사진·직접" },
    { id: "store", title: "서점에서 중복 확인" },
    { id: "find", title: "찾기·거르기·정렬" },
    { id: "shelf", title: "책꽂이 정하기" },
    { id: "review", title: "서평 쓰기" },
    { id: "recommend", title: "새책 추천" },
    ...(personal ? [{ id: "ai", title: "AI 기능 켜기 (Claude 키)" }] : []),
    ...(personal ? [{ id: "share", title: "가족·친구와 함께 쓰기" }] : []),
    { id: "manage", title: "정리하기 — 엑셀·카테고리·점검" },
    { id: "app", title: "휴대폰에 앱처럼 설치" },
    { id: "account", title: "내 설정·비밀번호" },
    { id: "faq", title: "자주 묻는 질문" },
    { id: "copyright", title: "저작권·출처" },
  ];

  return (
    <div className="help-guide">
      <nav className="help-toc card" aria-label="차례">
        <b>차례</b>
        <ol>
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      <section id="start" className="help-section">
        <h2>처음 시작하기</h2>
        <p>
          Home Library는 <b>집에 있는 책을 휴대폰으로 관리</b>하는 도서관입니다. 가장 큰 쓸모는 서점에서
          <b> "이 책 집에 있던가?"</b>를 바로 확인하는 것입니다.
        </p>
        <ol>
          <li>왼쪽 위 <b>☰</b>를 누르면 메뉴가 열립니다. 맨 위에 내 서재의 책 권수가 보입니다.</li>
          <li>
            <b>[바코드 스캔]</b>으로 집에 있는 책을 넣습니다. 한 번에 여러 권을 연속으로 찍을 수 있습니다.
          </li>
          <li>넣을 때 <b>책꽂이 위치</b>를 적어 두면 나중에 찾기 쉽습니다.</li>
          <li>휴대폰 <b>홈 화면에 추가</b>하면 앱처럼 쓸 수 있습니다(아래 "휴대폰에 앱처럼 설치").</li>
        </ol>
        {personal && user && (
          <p className="help-note">
            지금 계정은 이 도서관에서 <b>{ROLE_LABEL[user.library_role] || user.library_role}</b> 권한입니다.
            {user.library_role === "viewer" && " 책을 보고 찾을 수는 있지만 넣거나 고칠 수는 없습니다."}
          </p>
        )}
      </section>

      <section id="add" className="help-section">
        <h2>책 넣기 — 바코드·사진·직접</h2>
        <h3>📖 바코드 스캔 (가장 빠르고 정확)</h3>
        <ol>
          <li>☰ → <b>[바코드 스캔]</b> → <b>[ISBN 바코드로 스캔]</b>. 처음엔 카메라 사용을 허락해 주세요.</li>
          <li>책 <b>뒤표지의 줄무늬 바코드</b>(978 또는 979로 시작)를 화면 가운데 상자에 맞춥니다.</li>
          <li>읽히면 제목·저자·출판사·표지가 자동으로 채워져 목록에 쌓입니다. 다음 책을 계속 비추세요.</li>
          <li>다 찍었으면 <b>[검토하러 가기]</b>를 눌러 확인하고 한꺼번에 등록합니다.</li>
        </ol>
        <p className="help-tip">
          💡 초점이 안 맞으면 책을 조금 멀리 두고 <b>🔍 당겨 찍기</b>로 당겨 보세요. 요즘 큰 휴대폰은 너무 가까우면
          초점이 안 맞습니다. 어두우면 <b>🔦 불 켜기</b>. (기기가 지원할 때만 단추가 보입니다)
        </p>
        <p className="help-tip">
          💡 카메라가 안 되는 환경에서는 바코드를 <b>사진 한 장</b>으로 찍는 방식으로 저절로 바뀝니다.
        </p>
        <h3>📷 표지 사진</h3>
        <p>
          바코드가 없는 오래된 책은 <b>[표지 사진찍기]</b>로 표지를 찍으면 AI가 제목과 저자를 읽고 나머지 정보와
          깨끗한 표지를 찾아옵니다.
          {personal && " 이 기능은 [내 설정]에 Claude API 키를 넣어야 켜집니다(아래 \"AI 기능 켜기\")."}
        </p>
        <h3>✏️ 직접 입력</h3>
        <p>
          ☰ → <b>[새책 추가]</b>에서 직접 적습니다. <b>ISBN만 넣고 [조회]</b>를 누르면 나머지가 채워집니다.
          표지는 [표지 검색]으로 인터넷에서 골라 바꿀 수 있습니다.
        </p>
      </section>

      <section id="store" className="help-section">
        <h2>서점에서 중복 확인</h2>
        <p>
          [새책 추가]에서 바코드를 비추면, <b>이미 서재에 있는 책이면 바로 경고</b>가 뜨고 어느 책꽂이에 있는지
          보여 줍니다. 인터넷 조회가 안 되는 곳에서도 ISBN만으로 확인합니다.
        </p>
        <ul>
          <li><b>ISBN이 같음</b> — 사실상 같은 책입니다.</li>
          <li><b>제목만 같음</b> — 판이 다를 수 있으니 참고만 하세요.</li>
          <li>일부러 여러 권 두는 책은 <b>[이건 다른 책입니다]</b>를 누르면 다음부터 묻지 않습니다.</li>
        </ul>
      </section>

      <section id="find" className="help-section">
        <h2>찾기·거르기·정렬</h2>
        <ul>
          <li>
            맨 위 <b>검색창</b>은 제목·저자·출판사·번역자·ISBN을 한꺼번에 찾습니다. <b>띄어쓰기는 무시</b>합니다
            (<code>작은정원</code>으로 <code>작은 정원</code>도 찾음).
          </li>
          <li>외국 저자는 <b>로마자로도</b> 찾습니다 — <code>Robert</code>로 <code>로버트</code>를 찾습니다.</li>
          <li>
            목록 위 <b>🔎 필터</b>를 펼치면 제목·저자·출판사·카테고리·<b>책꽂이(여러 개 동시)</b>로 거를 수 있습니다.
            걸린 필터는 칩으로 보이고 ✕로 하나씩 지웁니다.
          </li>
          <li>폰에서는 <b>정렬</b> 막대로, 넓은 화면에서는 표 머리글을 눌러 정렬합니다.</li>
          <li>책을 누르면 자세한 정보가 열리고, 표지를 누르면 크게 봅니다.</li>
        </ul>
      </section>

      <section id="shelf" className="help-section">
        <h2>책꽂이 정하기</h2>
        <p>
          책을 넣거나 고칠 때 <b>책꽂이 위치</b>를 적습니다. 한 번 쓴 이름은 목록에서 고를 수 있어 오타로 갈라지지
          않습니다. 여러 권을 한꺼번에 정하려면 <b>[관리] → [책 관리]</b>에서 책을 고르고 위치를 적은 뒤 <b>[일괄 지정]</b>.
        </p>
      </section>

      <section id="review" className="help-section">
        <h2>서평 쓰기</h2>
        <p>
          책 정보 창의 <b>[서평 쓰기]</b>를 누르면 서평 전용 화면이 열립니다. A4 몇 쪽 분량도 넉넉히 들어갑니다.
          서식 단추로 <b>제목·굵게·목록</b>을 넣을 수 있습니다(마크다운).
        </p>
      </section>

      <section id="recommend" className="help-section">
        <h2>새책 추천</h2>
        <p>
          ☰ → <b>[새책 추천]</b>은 내 서재에 많은 분야의 신간·베스트셀러를 모아, <b>이미 가진 책은 빼고</b> AI가
          서재의 결에 맞는 것을 골라 <b>추천 이유 한 줄</b>과 함께 보여 줍니다. 하루에 한 번 새로 만듭니다.
          {personal && " 이 기능도 Claude API 키가 있어야 메뉴에 나타납니다."}
        </p>
      </section>

      {personal && (
        <section id="ai" className="help-section">
          <h2>AI 기능 켜기 (Claude 키)</h2>
          <p>
            <b>표지 사진 인식</b>과 <b>새책 추천</b>은 Anthropic의 Claude를 씁니다. 이 서버에서는 각자 자기 키를 넣어
            켭니다 — 사용료는 내 Anthropic 계정에 청구됩니다.
          </p>
          <ol>
            <li>
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                console.anthropic.com
              </a>
              에서 가입하고 API 키를 만듭니다(<code>sk-ant-</code>로 시작).
            </li>
            <li>☰ → <b>[내 설정]</b> → Claude API 키 칸에 붙여 넣고 <b>[저장]</b>.</li>
            <li>저장할 때 실제로 맞는 키인지 확인합니다. 서버에는 <b>암호화해서</b> 두고, 다시 화면에 보이지 않습니다(끝 4자리만).</li>
          </ol>
          <p className="help-note">키가 없어도 바코드·ISBN·직접 입력·검색은 모두 됩니다.</p>
        </section>
      )}

      {personal && (
        <section id="share" className="help-section">
          <h2>가족·친구와 함께 쓰기</h2>
          <p>
            가입하면 <b>나만의 도서관</b>이 생기고 내가 <b>주인</b>이 됩니다. 가족·친구를 멤버로 넣으면 같은 책 목록을
            함께 보고 관리합니다. 다른 도서관의 책은 서로 보이지 않습니다.
          </p>
          <h3>멤버를 넣는 두 가지 방법</h3>
          <ol>
            <li>
              <b>직접 만들어 주기</b> — ☰ → <b>[우리 도서관]</b> → [멤버 추가]에서 아이디·비밀번호를 만들어 알려 줍니다.
            </li>
            <li>
              <b>도서관 초대 코드</b> — [우리 도서관] → [초대 코드 만들기]로 <code>lib-</code>로 시작하는 코드를 만들어
              나눠 줍니다. 받은 사람은 로그인 화면의 [초대 코드로 가입하기]에 그 코드를 넣으면 이 도서관에 들어옵니다.
            </li>
          </ol>
          <h3>권한</h3>
          <ul>
            <li><b>주인</b> — 도서관을 만든 사람. 멤버 관리와 책 편집을 모두 합니다.</li>
            <li><b>공동 관리자</b> — 주인처럼 멤버를 관리하고 책을 편집합니다.</li>
            <li><b>편집</b> — 책을 넣고, 고치고, 지웁니다.</li>
            <li><b>보기만</b> — 찾고 보기만 합니다.</li>
          </ul>
          <p>
            주인·공동 관리자는 멤버마다 권한을 바꾸고, 비밀번호를 재설정하고, 멤버를 뺄 수 있습니다. 멤버를 빼도 그 사람이
            넣은 책은 도서관에 남습니다.
          </p>
          <p className="help-note">
            🔒 운영자는 서비스를 관리하지만 <b>여러분의 책 목록·서평·이메일을 볼 수 있는 화면은 없습니다</b>.
            운영자의 백업은 암호화되어 있어 서버 안에서만 되돌릴 수 있습니다.
          </p>
        </section>
      )}

      <section id="manage" className="help-section">
        <h2>정리하기 — 엑셀·카테고리·점검</h2>
        <ul>
          <li>
            <b>[관리] → [가져오기/내보내기]</b> — 목록을 엑셀/CSV로 내려받아 고친 뒤 다시 올리면 그대로 반영됩니다
            (맨 앞 <code>번호</code> 열이 있으면 그 책을 고침, 지우면 새 책). <b>되돌릴 수 없으니</b> 먼저 내보내기를 해 두세요.
          </li>
          <li><b>[카테고리 정리]</b> — 분류 이름을 바꾸면 같은 이름끼리 합쳐집니다. 권수가 많은 것부터 하세요.</li>
          <li><b>[서재 점검]</b> — 이미 들어간 중복, 표지가 깨진 책을 찾아 정리합니다.</li>
        </ul>
      </section>

      <section id="app" className="help-section">
        <h2>휴대폰에 앱처럼 설치</h2>
        <ul>
          <li><b>아이폰</b> — Safari로 이 사이트를 열고 아래 <b>공유(□↑)</b> → <b>홈 화면에 추가</b>.</li>
          <li><b>안드로이드</b> — Chrome으로 열고 오른쪽 위 <b>⋮</b> → <b>홈 화면에 추가</b>(또는 앱 설치).</li>
        </ul>
        <p>
          자세한 그림 안내는 <Link to="/install">앱 설치 안내</Link>에 있습니다. 화면 왼쪽 아래의 작은 글자(v…)는 지금
          버전입니다 — 화면이 이상하면 먼저 이걸 알려 주세요.
        </p>
      </section>

      <section id="account" className="help-section">
        <h2>내 설정·비밀번호</h2>
        <p>
          ☰ → <b>[내 설정]</b>에서 비밀번호를 바꿉니다{personal ? "(Claude 키도 여기서)" : ""}. 비밀번호를 잊었다면
          {personal ? " 도서관 주인(멤버라면)이나 운영자(주인이라면)" : " 관리자"}에게 재설정을 요청하세요. 아직 메일로 찾는
          기능은 없습니다.
        </p>
      </section>

      <section id="faq" className="help-section">
        <h2>자주 묻는 질문</h2>
        <dl className="help-faq">
          <dt>바코드를 비춰도 안 읽혀요.</dt>
          <dd>조금 멀리 두고 [🔍 당겨 찍기]로 당겨 보세요. 흐린 화면은 읽을 수 없습니다. 그래도 안 되면 ISBN 숫자를 직접 넣으세요.</dd>
          <dt>표지가 엉뚱한 책 것이에요.</dt>
          <dd>책 정보 → [수정] → [표지 검색]으로 다른 후보를 고르거나, 직접 사진을 올리세요.</dd>
          <dt>휴대폰에서 새 기능이 안 보여요.</dt>
          <dd>앱을 완전히 닫았다 다시 여세요. 새 버전은 화면을 옮기거나 앱을 다시 열 때 반영됩니다.</dd>
          <dt>바라는 기능이 있어요.</dt>
          <dd>
            위의 <b>[의견 보내기]</b> 탭으로 알려 주세요. 운영자가 읽고 답을 남기면 [내가 보낸 의견]에서 볼 수 있습니다.
          </dd>
        </dl>
      </section>

      {/* 저작권·출처(사용자 요청, 2026-11-27). 알라딘 Open API는 "도서 DB 제공 : 알라딘 인터넷서점" 표기를 요구한다.
          외부 출처를 늘리거나 빼면(services/booklookup_service.py) 여기도 함께 고칠 것. */}
      <section id="copyright" className="help-section">
        <h2>저작권·출처</h2>

        <h3>Home Library 프로그램</h3>
        <p>
          © 2026 Kevin Choi. <b>MIT 라이선스</b>로 공개된 오픈소스입니다 — 누구나 자유롭게 쓰고, 고치고, 나눌 수
          있습니다. 소스 코드:{" "}
          <a href="https://github.com/kevinkchoi/homelibrary" target="_blank" rel="noopener noreferrer">
            github.com/kevinkchoi/homelibrary
          </a>
        </p>

        <h3>책 정보와 표지</h3>
        <ul>
          <li>
            도서 DB 제공 : <b>알라딘 인터넷서점</b>(
            <a href="https://www.aladin.co.kr" target="_blank" rel="noopener noreferrer">
              www.aladin.co.kr
            </a>
            )
          </li>
          <li>함께 찾아보는 곳: Google Books, 카카오 책 검색</li>
          <li>
            표지 이미지는 알라딘·교보문고·Amazon 등에서 가져오며, <b>저작권은 각 출판사와 저작권자에게</b> 있습니다.
            이 도서관에서 책을 알아보는 용도로만 쓰고, 다른 곳에 옮겨 싣거나 공개하지 마세요.
          </li>
        </ul>

        <h3>AI 기능</h3>
        <p>표지 사진 인식과 새책 추천은 Anthropic의 <b>Claude</b>를 사용합니다. 결과가 틀릴 수 있으니 확인해 주세요.</p>

        <h3>내가 쓴 서평</h3>
        <p>
          서평의 저작권은 <b>쓴 사람</b>에게 있습니다.
          {personal
            ? " 내 도서관의 멤버만 볼 수 있고, 사이트 운영자 화면에도 나오지 않습니다."
            : " 이 서재를 함께 쓰는 가족 모두가 볼 수 있습니다."}
        </p>

        <h3>함께 쓴 오픈소스</h3>
        <p className="help-small">
          React, React Router, react-markdown, ZXing(바코드 인식), FastAPI, SQLAlchemy, Alembic, PostgreSQL, Pillow,
          nginx 등 — 각 프로젝트의 라이선스를 따릅니다.
        </p>
      </section>
    </div>
  );
}

const CATEGORY_OPTIONS = [
  { value: "idea", label: "💡 기능 제안" },
  { value: "bug", label: "🐞 잘 안 돼요(버그)" },
  { value: "praise", label: "👍 좋아요" },
  { value: "other", label: "💬 기타" },
];

function FeedbackForm({ onSent }) {
  const [category, setCategory] = useState("idea");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await sendFeedback(category, body.trim());
      setBody("");
      onSent();
    } catch (err) {
      setError(describeApiError(err, "보내지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card help-feedback" onSubmit={handleSubmit}>
      <p className="help-lead">
        쓰다가 불편한 점, 잘 안 되는 것, 있으면 좋겠는 기능을 알려 주세요. <b>운영자에게 전달</b>되고, 답을 남기면
        [내가 보낸 의견]에서 볼 수 있습니다.
      </p>
      <div className="help-categories" role="radiogroup" aria-label="종류">
        {CATEGORY_OPTIONS.map((c) => (
          <label key={c.value} className={"help-chip" + (category === c.value ? " active" : "")}>
            <input
              type="radio"
              name="category"
              value={c.value}
              checked={category === c.value}
              onChange={() => setCategory(c.value)}
            />
            {c.label}
          </label>
        ))}
      </div>
      <textarea
        rows={7}
        maxLength={4000}
        placeholder={
          category === "bug"
            ? "어느 화면에서 무엇을 했더니 어떻게 됐는지 적어 주세요. 화면 왼쪽 아래 버전(v…)도 함께 적어 주시면 좋아요."
            : "자유롭게 적어 주세요."
        }
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
      />
      <div className="help-feedback-foot">
        <span className="help-count">{body.length} / 4000</span>
        <button className="btn" type="submit" disabled={busy || body.trim().length < 2}>
          {busy ? "보내는 중…" : "보내기"}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}

export const FEEDBACK_STATUS = {
  new: "접수",
  reviewing: "검토 중",
  done: "반영",
  declined: "보류",
};

function MyFeedback() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    myFeedback()
      .then(setItems)
      .catch((err) => setError(describeApiError(err, "불러오지 못했습니다.")));
  }, []);

  if (error) return <p className="form-error">{error}</p>;
  if (items === null) return <p>불러오는 중…</p>;
  if (items.length === 0) {
    return <p className="help-empty">아직 보낸 의견이 없습니다. [의견 보내기]에서 알려 주세요.</p>;
  }
  return (
    <ul className="help-mine">
      {items.map((f) => (
        <li key={f.id} className="card">
          <div className="help-mine-head">
            <span className={`help-status status-${f.status}`}>{FEEDBACK_STATUS[f.status] || f.status}</span>
            <span className="help-mine-cat">{CATEGORY_OPTIONS.find((c) => c.value === f.category)?.label}</span>
            <span className="help-mine-date">{new Date(f.created_at).toLocaleDateString()}</span>
          </div>
          <p className="help-mine-body">{f.body}</p>
          {f.admin_reply && (
            <div className="help-reply">
              <b>운영자 답</b>
              <p>{f.admin_reply}</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
