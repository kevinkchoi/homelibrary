import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { listUsers, deleteUser, setAdmin, createUser, resetPassword } from "../api/users";
import { describeApiError } from "../utils/apiError.js";
import { isPersonal, useServerConfig } from "../utils/serverConfig.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import "./AdminUsers.css";

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const personal = isPersonal(useServerConfig());
  const emptyForm = { username: "", email: "", password: "" };
  const [newUser, setNewUser] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await listUsers();
      setUsers(data);
    } catch (err) {
      setError(err.response?.data?.detail || "사용자 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleToggleAdmin(u) {
    setError("");
    try {
      await setAdmin(u.id, !u.is_admin);
      load();
    } catch (err) {
      setError(err.response?.data?.detail || "권한 변경에 실패했습니다.");
    }
  }

  // 공개 가입이 닫혀서(인터넷 공개, 2026-10-11) 가족 계정은 여기서 만든다.
  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    setCreated("");
    setCreating(true);
    try {
      const u = await createUser(newUser);
      setNewUser(emptyForm);
      setCreated(`"${u.username}" 계정을 만들었습니다. 아이디와 비밀번호를 그분께 알려주세요.`);
      load();
    } catch (err) {
      setError(describeApiError(err, "계정을 만들지 못했습니다."));
    } finally {
      setCreating(false);
    }
  }

  // 비밀번호를 잊은 가족에게 새 비밀번호를 정해 준다(되찾기 메일 기능이 없다).
  async function handleResetPassword(u) {
    const pw = window.prompt(`"${u.username}"의 새 비밀번호 (6자 이상)`);
    if (pw === null) return;
    setError("");
    setCreated("");
    if (pw.length < 6) {
      setError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    try {
      await resetPassword(u.id, pw);
      setCreated(`"${u.username}"의 비밀번호를 바꿨습니다. 새 비밀번호를 그분께 알려주세요.`);
    } catch (err) {
      setError(describeApiError(err, "비밀번호를 바꾸지 못했습니다."));
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setError("");
    try {
      await deleteUser(pendingDelete.id);
      setPendingDelete(null);
      load();
    } catch (err) {
      setError(err.response?.data?.detail || "삭제에 실패했습니다.");
      setPendingDelete(null);
    }
  }

  if (!me?.is_admin) {
    return (
      <div className="admin-users-page">
        <p>이 페이지는 관리자만 볼 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div className="admin-users-page">
      <h1>사용자 관리</h1>
      <p className="admin-users-desc">
        {personal
          ? "개인 서재 서버입니다 — 계정마다 자기 책만 봅니다. 계정을 삭제하면 그 사람의 책과 표지도 함께 지워집니다."
          : "여기서 관리하는 계정은 모두 같은 책 목록을 공유합니다. 계정을 삭제해도 그 사람이 등록한 책은 그대로 남습니다."}
      </p>

      {error && <p className="form-error">{error}</p>}

      <form className="admin-users-add card" onSubmit={handleCreate}>
        <h2>사용자 추가</h2>
        {/* 아이디는 대소문자를 구분하지 않지만 휴대폰 자동 대문자는 끈다(Register.jsx와 같은 이유) */}
        <input
          placeholder="아이디 (3자 이상)"
          value={newUser.username}
          onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          minLength={3}
          required
        />
        <input
          type="email"
          placeholder="이메일"
          value={newUser.email}
          onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
          autoCapitalize="none"
          autoComplete="off"
          required
        />
        <input
          type="password"
          placeholder="비밀번호 (6자 이상)"
          value={newUser.password}
          onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
          autoComplete="new-password"
          minLength={6}
          required
        />
        <button className="btn" type="submit" disabled={creating}>
          추가
        </button>
        {created && <p className="admin-users-created">{created}</p>}
      </form>
      {loading ? (
        <p>불러오는 중...</p>
      ) : (
        <table className="book-table admin-users-table">
          <thead>
            <tr>
              <th>아이디</th>
              <th>이메일</th>
              <th>권한</th>
              <th>가입일</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.username} {u.id === me.id && <span className="me-badge">나</span>}
                </td>
                <td className="admin-users-email">{u.email}</td>
                <td>{u.is_admin ? "관리자" : "일반"}</td>
                <td className="admin-users-date">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="admin-users-actions">
                  <button className="btn secondary" onClick={() => handleToggleAdmin(u)}>
                    {u.is_admin ? "관리자 해제" : "관리자로 지정"}
                  </button>
                  <button className="btn secondary" onClick={() => handleResetPassword(u)}>
                    비밀번호 재설정
                  </button>
                  <button
                    className="btn danger"
                    disabled={u.id === me.id}
                    onClick={() => setPendingDelete(u)}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pendingDelete && (
        <ConfirmDialog
          message={
            personal
              ? `"${pendingDelete.username}" 계정과 그 사람의 책·표지를 모두 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`
              : `"${pendingDelete.username}" 계정을 삭제하시겠습니까? (등록한 책은 삭제되지 않습니다)`
          }
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
