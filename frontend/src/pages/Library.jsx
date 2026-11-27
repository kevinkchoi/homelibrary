import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import {
  createMember,
  disableInviteCode,
  fetchLibrary,
  makeInviteCode,
  removeMember,
  renameLibrary,
  resetMemberPassword,
  setMemberRole,
} from "../api/library";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { describeApiError } from "../utils/apiError.js";
import { ROLE_LABEL } from "../utils/permissions.js";
import "./Library.css";

const MEMBER_ROLES = ["manager", "editor", "viewer"];
const ROLE_HELP = {
  manager: "멤버 관리 + 책 편집",
  editor: "책 넣기·고치기·지우기",
  viewer: "찾고 보기만",
};

/**
 * [우리 도서관] — personal 모드(개인 서재 서버). 사용자 요구(2026-11-27):
 * 가입자(주인)가 가족·친구를 넣어 같은 도서관을 함께 쓴다. 넣는 길은 둘 — 아이디를 직접 만들어 주기, 도서관 초대 코드.
 * 권한은 멤버마다 주인이 정한다(공동 관리자/편집/보기만).
 *
 * 관리 권한이 없는 멤버에게는 도서관 이름·멤버·권수만 보여 준다(서버도 초대 코드를 주지 않는다).
 */
export default function Library() {
  const { user } = useAuth();
  const [lib, setLib] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingRemove, setPendingRemove] = useState(null);

  async function run(fn, done) {
    setError("");
    setNotice("");
    try {
      const next = await fn();
      if (next) setLib(next);
      if (done) setNotice(done);
    } catch (err) {
      setError(describeApiError(err, "처리하지 못했습니다."));
    }
  }

  useEffect(() => {
    run(fetchLibrary);
  }, []);

  if (!lib) {
    return <div className="library-page">{error ? <p className="form-error">{error}</p> : <p>불러오는 중…</p>}</div>;
  }

  const manage = lib.can_manage;

  return (
    <div className="library-page">
      <LibraryName lib={lib} manage={manage} onRename={(name) => run(() => renameLibrary(name), "이름을 바꿨습니다.")} />
      <p className="library-sub">
        책 <b>{lib.book_count}</b>권 · 멤버 <b>{lib.members.length}</b>명 · 내 권한 <b>{ROLE_LABEL[lib.my_role]}</b>
      </p>

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="library-ok">{notice}</p>}

      <section className="card library-section">
        <h2>멤버</h2>
        <ul className="library-members">
          {lib.members.map((m) => (
            <li key={m.id} className="library-member">
              <div className="library-member-main">
                <span className="library-member-name">
                  {m.username}
                  {m.id === user?.id && <span className="me-badge">나</span>}
                </span>
                <span className="library-member-meta">
                  넣은 책 {m.book_count}권 · {new Date(m.created_at).toLocaleDateString()} 가입
                </span>
              </div>
              <div className="library-member-actions">
                {manage && m.role !== "owner" && m.id !== user?.id ? (
                  <>
                    <select
                      aria-label={`${m.username}의 권한`}
                      value={m.role}
                      onChange={(e) => run(() => setMemberRole(m.id, e.target.value), `${m.username}의 권한을 바꿨습니다.`)}
                    >
                      {MEMBER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn secondary btn-sm"
                      type="button"
                      onClick={() => {
                        const pw = window.prompt(`"${m.username}"의 새 비밀번호 (6자 이상)`);
                        if (pw === null) return;
                        if (pw.length < 6) {
                          setError("비밀번호는 6자 이상이어야 합니다.");
                          return;
                        }
                        run(async () => {
                          await resetMemberPassword(m.id, pw);
                          return null;
                        }, `${m.username}의 비밀번호를 바꿨습니다. 새 비밀번호를 알려 주세요.`);
                      }}
                    >
                      비밀번호 재설정
                    </button>
                    <button className="btn danger btn-sm" type="button" onClick={() => setPendingRemove(m)}>
                      빼기
                    </button>
                  </>
                ) : (
                  <span className={`library-role role-${m.role}`}>{ROLE_LABEL[m.role]}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {manage && <AddMember onAdd={(form) => run(() => createMember(form), `"${form.username}" 멤버를 만들었습니다. 아이디와 비밀번호를 알려 주세요.`)} />}
      {manage && (
        <InviteCode
          lib={lib}
          onMake={(role) => run(() => makeInviteCode(role), "새 초대 코드를 만들었습니다. 이전 코드는 더 이상 쓸 수 없습니다.")}
          onDisable={() => run(disableInviteCode, "초대 코드를 껐습니다.")}
        />
      )}

      {!manage && (
        <p className="library-note">
          멤버를 넣거나 권한을 바꾸는 일은 도서관 주인이나 공동 관리자가 합니다.
        </p>
      )}

      {pendingRemove && (
        <ConfirmDialog
          message={`"${pendingRemove.username}"을(를) 도서관에서 뺄까요? 계정이 지워지고 다시 로그인할 수 없습니다. 이 사람이 넣은 책은 도서관에 남습니다.`}
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            const m = pendingRemove;
            setPendingRemove(null);
            run(() => removeMember(m.id), `${m.username}을(를) 뺐습니다.`);
          }}
        />
      )}
    </div>
  );
}

function LibraryName({ lib, manage, onRename }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(lib.name);
  if (!editing) {
    return (
      <div className="library-title">
        <h1>{lib.name}</h1>
        {manage && (
          <button className="btn secondary btn-sm" type="button" onClick={() => setEditing(true)}>
            이름 바꾸기
          </button>
        )}
      </div>
    );
  }
  return (
    <form
      className="library-title library-rename"
      onSubmit={(e) => {
        e.preventDefault();
        onRename(name.trim());
        setEditing(false);
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
      <button className="btn btn-sm" type="submit">
        저장
      </button>
      <button className="btn secondary btn-sm" type="button" onClick={() => setEditing(false)}>
        취소
      </button>
    </form>
  );
}

function AddMember({ onAdd }) {
  const empty = { username: "", password: "", email: "", role: "editor" };
  const [form, setForm] = useState(empty);
  return (
    <section className="card library-section">
      <h2>멤버 추가 — 직접 만들어 주기</h2>
      <p className="library-desc">아이디와 비밀번호를 만들어 가족·친구에게 알려 주세요. 메일 인증은 없습니다.</p>
      <form
        className="library-form"
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(form);
          setForm(empty);
        }}
      >
        <input
          placeholder="아이디 (3자 이상)"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          minLength={3}
          required
        />
        <input
          type="password"
          placeholder="비밀번호 (6자 이상)"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          autoComplete="new-password"
          minLength={6}
          required
        />
        <input
          type="email"
          placeholder="이메일 (선택)"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          autoCapitalize="none"
          autoComplete="off"
        />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="권한">
          {MEMBER_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]} — {ROLE_HELP[r]}
            </option>
          ))}
        </select>
        <button className="btn" type="submit">
          추가
        </button>
      </form>
    </section>
  );
}

function InviteCode({ lib, onMake, onDisable }) {
  const [role, setRole] = useState(lib.invite_role || "editor");
  const [copied, setCopied] = useState(false);
  const site = typeof location !== "undefined" ? location.host : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(lib.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 복사가 막힌 브라우저 — 화면의 코드를 직접 옮겨 적으면 된다
    }
  }

  return (
    <section className="card library-section">
      <h2>도서관 초대 코드</h2>
      <p className="library-desc">
        코드를 받은 사람이 <b>{site}</b>의 [초대 코드로 가입하기]에 넣으면 이 도서관의 멤버가 됩니다.
      </p>
      {lib.invite_code ? (
        <div className="library-code">
          <code>{lib.invite_code}</code>
          <span className="library-code-role">→ {ROLE_LABEL[lib.invite_role]}으로 들어옴</span>
          <button className="btn secondary btn-sm" type="button" onClick={copy}>
            {copied ? "복사됨" : "복사"}
          </button>
          <button className="btn secondary btn-sm" type="button" onClick={onDisable}>
            끄기
          </button>
        </div>
      ) : (
        <p className="library-desc">지금은 초대 코드가 없습니다.</p>
      )}
      <div className="library-form library-form-inline">
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="코드로 들어올 사람의 권한">
          {MEMBER_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}으로 들어오게
            </option>
          ))}
        </select>
        <button className="btn" type="button" onClick={() => onMake(role)}>
          {lib.invite_code ? "새 코드로 바꾸기" : "초대 코드 만들기"}
        </button>
      </div>
    </section>
  );
}
