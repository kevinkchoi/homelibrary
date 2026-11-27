import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import {
  adminDeleteLibrary,
  adminDeleteUser,
  adminDownloadBackup,
  adminLibraries,
  adminRestore,
} from "../api/admin";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { describeApiError } from "../utils/apiError.js";
import "./AdminSite.css";

/**
 * 운영자 — 도서관 관리 (personal 모드). 사용자 요구(2026-11-27):
 * 모든 도서관을 관리(백업·복구·말썽 사용자 삭제)하되 **사용자의 개인정보·책 DB를 빼갈 수 없게**.
 * 그래서 이 화면에는 도서관 이름·아이디·멤버 수·책 수·가입일만 있고, 이메일·책 제목은 없다(서버도 주지 않는다).
 * 백업 파일은 서버만 아는 키로 암호화돼 있어 내려받아도 열 수 없고, 여기서 다시 올려 복구만 할 수 있다.
 */
export default function AdminSite() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null); // { kind: 'library'|'user', ... }
  const fileRef = useRef(null);

  async function load() {
    try {
      setData(await adminLibraries());
    } catch (err) {
      setError(describeApiError(err, "불러오지 못했습니다."));
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function act(fn, message) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fn();
      setNotice(typeof message === "function" ? message(r) : message);
      await load();
    } catch (err) {
      setError(describeApiError(err, "처리하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  if (!user?.is_admin) return <p>운영자만 볼 수 있습니다.</p>;

  return (
    <div className="admin-site-page">
      <h1>도서관 관리 (운영자)</h1>
      <p className="admin-site-desc">
        🔒 이 화면에는 사용자의 이메일·책 제목·서평이 나오지 않습니다. 백업 파일은 암호화되어 있어 이 서버에서
        복구하는 데만 쓸 수 있습니다.
      </p>
      {data && (
        <p className="admin-site-total">
          도서관 <b>{data.libraries.length}</b>곳 · 사용자 <b>{data.total_users}</b>명 · 책 <b>{data.total_books}</b>권
        </p>
      )}

      <section className="card admin-site-tools">
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={() =>
            act(() => adminDownloadBackup(null), (r) => `전체 백업을 내려받았습니다: ${r.name} (도서관 ${r.libs}곳 · 사용자 ${r.users}명 · 책 ${r.books}권)`)
          }
        >
          ⬇ 전체 백업 내려받기
        </button>
        <button className="btn secondary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
          ⬆ 백업으로 복구…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".hlbak"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) setPending({ kind: "restore", file });
          }}
        />
      </section>

      {error && <p className="form-error">{error}</p>}
      {notice && <p className="admin-site-ok">{notice}</p>}

      {!data ? (
        !error && <p>불러오는 중…</p>
      ) : (
        <ul className="admin-site-list">
          {data.libraries.map((lib) => {
            const mine = lib.id === user.library_id;
            return (
              <li key={lib.id} className="card admin-site-lib">
                <div className="admin-site-lib-head">
                  <span className="admin-site-lib-name">
                    {lib.name} {mine && <span className="me-badge">내 도서관</span>}
                  </span>
                  <span className="admin-site-lib-meta">
                    주인 {lib.owner_username || "-"} · 멤버 {lib.member_count}명 · 책 {lib.book_count}권 ·{" "}
                    {lib.created_at ? new Date(lib.created_at).toLocaleDateString() : "-"}
                  </span>
                </div>
                <div className="admin-site-members">
                  {lib.members.map((name) => (
                    <span key={name} className="admin-site-member">
                      {name}
                      {!mine && name !== lib.owner_username && (
                        <button
                          type="button"
                          className="admin-site-x"
                          aria-label={`${name} 삭제`}
                          title="이 사용자만 삭제"
                          onClick={() => setPending({ kind: "user", lib, name })}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                <div className="admin-site-actions">
                  <button
                    className="btn secondary btn-sm"
                    type="button"
                    disabled={busy}
                    onClick={() => act(() => adminDownloadBackup(lib.id), (r) => `"${lib.name}" 백업을 내려받았습니다: ${r.name}`)}
                  >
                    백업
                  </button>
                  {!mine && (
                    <button
                      className="btn danger btn-sm"
                      type="button"
                      disabled={busy}
                      onClick={() => setPending({ kind: "library", lib })}
                    >
                      도서관 삭제
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pending?.kind === "library" && (
        <ConfirmDialog
          message={`"${pending.lib.name}"을(를) 통째로 지웁니다 — 멤버 ${pending.lib.member_count}명의 계정과 책 ${pending.lib.book_count}권, 표지까지. 되돌리려면 지금 백업을 먼저 받아 두세요. 계속할까요?`}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const lib = pending.lib;
            setPending(null);
            act(() => adminDeleteLibrary(lib.id), `"${lib.name}"을(를) 지웠습니다.`);
          }}
        />
      )}
      {pending?.kind === "user" && (
        <ConfirmDialog
          message={`"${pending.name}" 계정을 지웁니다. 이 사람이 넣은 책은 "${pending.lib.name}"에 남습니다. 계속할까요?`}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const { name, lib } = pending;
            setPending(null);
            act(async () => {
              const { listUsers } = await import("../api/users");
              const target = (await listUsers()).find((u) => u.username === name && u.library_id === lib.id);
              if (!target) throw new Error("사용자를 찾지 못했습니다.");
              await adminDeleteUser(target.id);
            }, `"${name}" 계정을 지웠습니다.`);
          }}
        />
      )}
      {pending?.kind === "restore" && (
        <ConfirmDialog
          message={`"${pending.file.name}"으로 복구합니다. 백업 속 도서관이 지금도 있으면 그 도서관을 백업 시점으로 되돌립니다(그 뒤에 넣은 책은 사라집니다). 계속할까요?`}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const file = pending.file;
            setPending(null);
            act(
              () => adminRestore(file),
              (r) =>
                `복구했습니다: 도서관 ${r.libraries}곳 · 사용자 ${r.users}명 · 책 ${r.books}권 · 표지 ${r.covers}장` +
                (r.replaced.length ? ` (되돌린 도서관: ${r.replaced.join(", ")})` : ""),
            );
          }}
        />
      )}
    </div>
  );
}
