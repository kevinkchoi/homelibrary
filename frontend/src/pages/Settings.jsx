import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { changePassword, deleteAiKey, saveAiKey } from "../api/me";
import { describeApiError } from "../utils/apiError.js";
import { setAiStatus, useAiStatus } from "../utils/serverConfig.js";
import "./Settings.css";

/**
 * [내 설정] — 로그인한 사람 자신의 것.
 *
 * **Claude API 키**(personal 모드, homelibrary.kr): 표지 사진 인식·새책 추천은 각자 자기 키로 돈다.
 * 운영자 키를 쓰지 않는 이유는 남의 사용량이 운영자에게 청구되기 때문이다(사용자 결정, 2026-11-27).
 * 키는 서버에 암호화해 두고 **다시 보여 주지 않는다** — 끝 4자리만.
 *
 * **비밀번호 바꾸기**: 메일 발송 기능이 없어 "비밀번호 찾기"가 없다. 로그인한 상태에서 바꾸게 한다.
 */
export default function Settings() {
  const { user } = useAuth();
  const ai = useAiStatus();

  return (
    <div className="settings-page">
      <h1>내 설정</h1>
      <p className="settings-who">
        <b>{user?.username}</b>
        {user?.email ? ` · ${user.email}` : ""}
      </p>
      {ai?.user_key_allowed && <AiKeySection status={ai} />}
      <PasswordSection />
    </div>
  );
}

function AiKeySection({ status }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSave(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await saveAiKey(value.trim());
      setAiStatus(next);
      setValue(""); // 저장한 키는 입력칸에 남겨 두지 않는다
      setMessage("저장했습니다. 이제 표지 사진 인식과 새책 추천을 쓸 수 있습니다.");
    } catch (err) {
      setError(describeApiError(err, "키를 저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("저장한 Claude API 키를 지울까요? 표지 사진 인식과 새책 추천이 꺼집니다.")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setAiStatus(await deleteAiKey());
      setMessage("키를 지웠습니다.");
    } catch (err) {
      setError(describeApiError(err, "키를 지우지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card settings-section">
      <h2>Claude API 키</h2>
      <p className="settings-desc">
        <b>표지 사진으로 책 읽기</b>와 <b>새책 추천</b>은 Anthropic의 Claude를 씁니다. 내 키를 넣으면 켜지고,
        사용료는 내 Anthropic 계정에 청구됩니다. 바코드 스캔·ISBN 입력·검색은 키 없이 됩니다.
      </p>
      <p className="settings-state">
        {status.last4 ? (
          <>
            ✓ 등록됨 <span className="settings-mask">sk-ant-…{status.last4}</span>
          </>
        ) : (
          "등록된 키가 없습니다."
        )}
      </p>
      <form className="settings-form" onSubmit={handleSave}>
        <input
          type="password"
          placeholder={status.last4 ? "새 키로 바꾸기 (sk-ant-…)" : "sk-ant-…"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
        <button className="btn" type="submit" disabled={busy || !value.trim()}>
          {busy ? "확인 중…" : "저장"}
        </button>
        {status.last4 && (
          <button className="btn secondary" type="button" onClick={handleDelete} disabled={busy}>
            지우기
          </button>
        )}
      </form>
      {error && <p className="form-error">{error}</p>}
      {message && <p className="settings-ok">{message}</p>}
      <p className="settings-help">
        키는 <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
          console.anthropic.com
        </a>
        에서 만듭니다. 저장할 때 Claude에 실제로 맞는 키인지 확인하고, 서버에는 암호화해서 보관합니다.
        저장한 키는 다시 화면에 보이지 않습니다(끝 4자리만).
      </p>
    </section>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (next !== confirm) {
      setError("새 비밀번호 두 칸이 서로 다릅니다.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage("비밀번호를 바꿨습니다.");
    } catch (err) {
      setError(describeApiError(err, "비밀번호를 바꾸지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card settings-section">
      <h2>비밀번호 바꾸기</h2>
      <form className="settings-form settings-form-stack" onSubmit={handleSubmit}>
        <input
          type="password"
          placeholder="지금 비밀번호"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
        <input
          type="password"
          placeholder="새 비밀번호 (6자 이상)"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
        />
        <input
          type="password"
          placeholder="새 비밀번호 확인"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
        />
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "바꾸는 중…" : "바꾸기"}
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {message && <p className="settings-ok">{message}</p>}
    </section>
  );
}
