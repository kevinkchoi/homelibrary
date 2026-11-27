import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { adminFeedback, adminUpdateFeedback } from "../api/admin";
import { describeApiError } from "../utils/apiError.js";
import { FEEDBACK_STATUS } from "./Help.jsx";
import "./AdminFeedback.css";

const CATEGORY = { idea: "💡 제안", bug: "🐞 버그", praise: "👍 칭찬", other: "💬 기타" };
const FILTERS = [{ value: "", label: "전체" }, ...Object.entries(FEEDBACK_STATUS).map(([value, label]) => ({ value, label }))];

/**
 * 운영자 — 의견함. 사용자가 [도움말 → 의견 보내기]로 보낸 것을 모아 보고, 상태와 답을 남긴다.
 * 남긴 답은 보낸 사람의 [내가 보낸 의견]에 보인다. 새 의견은 텔레그램으로도 알린다(서버 .env 설정 시).
 */
export default function AdminFeedback() {
  const { user } = useAuth();
  const [filter, setFilter] = useState("");
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setItems(null);
    adminFeedback(filter)
      .then(setItems)
      .catch((err) => setError(describeApiError(err, "불러오지 못했습니다.")));
  }, [filter]);

  if (!user?.is_admin) return <p>운영자만 볼 수 있습니다.</p>;

  function replace(updated) {
    setItems((list) => list.map((f) => (f.id === updated.id ? updated : f)));
  }

  return (
    <div className="admin-feedback-page">
      <h1>의견함</h1>
      <div className="admin-feedback-filters">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={"help-tab" + (filter === f.value ? " active" : "")}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
      {items === null ? (
        !error && <p>불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="help-empty">의견이 없습니다.</p>
      ) : (
        <ul className="admin-feedback-list">
          {items.map((f) => (
            <FeedbackItem key={f.id} item={f} onSaved={replace} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedbackItem({ item, onSaved }) {
  const [status, setStatus] = useState(item.status);
  const [reply, setReply] = useState(item.admin_reply || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const dirty = status !== item.status || reply !== (item.admin_reply || "");

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      onSaved(await adminUpdateFeedback(item.id, { status, admin_reply: reply }));
      setMsg("저장했습니다.");
    } catch (err) {
      setMsg(describeApiError(err, "저장하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="card admin-feedback-item">
      <div className="help-mine-head">
        <span className={`help-status status-${item.status}`}>{FEEDBACK_STATUS[item.status]}</span>
        <span>{CATEGORY[item.category] || item.category}</span>
        <b>{item.username}</b>
        <span>{new Date(item.created_at).toLocaleString()}</span>
      </div>
      <p className="help-mine-body">{item.body}</p>
      <div className="admin-feedback-edit">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="상태">
          {Object.entries(FEEDBACK_STATUS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <textarea
          rows={2}
          placeholder="보낸 사람에게 보일 답 (선택)"
          value={reply}
          maxLength={4000}
          onChange={(e) => setReply(e.target.value)}
        />
        <button className="btn btn-sm" type="button" disabled={busy || !dirty} onClick={save}>
          저장
        </button>
      </div>
      {msg && <p className="admin-feedback-msg">{msg}</p>}
    </li>
  );
}
