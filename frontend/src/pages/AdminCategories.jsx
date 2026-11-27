import { useEffect, useState } from "react";
import { fetchCategories, renameCategory } from "../api/books";
import "./AdminCategories.css";

// 자주 쓰는 큰 분류. 한 번 눌러 적용할 수 있게 해 두면 233종을 빠르게 줄일 수 있다.
const PRESETS = ["소설", "시", "에세이", "인문", "사회", "과학", "경제경영", "자기계발", "예술", "종교", "기타"];

export default function AdminCategories() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // 어느 줄을 편집 중인지 (null = 없음). 키는 카테고리 이름, 빈 것은 "" 로 표현
  const [editingKey, setEditingKey] = useState(null);
  const [draft, setDraft] = useState("");

  async function load() {
    setLoading(true);
    try {
      setRows(await fetchCategories());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const keyOf = (row) => (row.name === null ? "" : row.name);

  function startEdit(row) {
    setEditingKey(keyOf(row));
    setDraft(row.name ?? "");
    setMessage("");
  }

  async function apply(row, toName) {
    setBusy(true);
    setMessage("");
    try {
      const r = await renameCategory(row.name, toName);
      const label = row.name ?? "분류 없음";
      const target = (toName || "").trim() || "분류 없음";
      setMessage(`“${label}” → “${target}” · ${r.updated}권 변경`);
      setEditingKey(null);
      await load();
    } catch {
      setMessage("변경하지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  // 한 권에 카테고리가 여러 개 붙으므로 이 합계는 **권수가 아니다**(한 책이 여러 번 세어진다).
  // "총 461권"처럼 쓰면 257권짜리 서재가 461권으로 보인다 — 실제로 그렇게 보였다.
  const assignments = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="cat-page">
      <div className="home-header">
        <h1>카테고리 정리</h1>
        <span className="home-total">{rows.length}종 · 분류 지정 {assignments}건</span>
      </div>

      <p className="cat-desc">
        카테고리는 서점마다 제각각이라(알라딘 “프랑스소설”, Google Books “Fiction”) 종류가
        많아집니다. <b>이름을 바꿔 큰 분류로 합치세요.</b> 이미 있는 이름으로 바꾸면 자연스럽게
        합쳐집니다. 권수가 많은 것부터 정리하면 빨리 줄어듭니다.
        <br />
        책 한 권에 카테고리를 <b>여러 개</b> 붙일 수 있으므로(“소설, 프랑스”), 아래 권수는
        <b> 키워드별</b>로 센 것입니다. 이름을 바꾸면 그 키워드만 바뀌고 같이 붙어 있던 다른
        카테고리는 그대로 남습니다.
      </p>

      {message && <p className="cat-message">{message}</p>}
      {loading && <p>불러오는 중...</p>}

      {!loading && (
        <ul className="cat-list">
          {rows.map((row) => {
            const k = keyOf(row);
            const editing = editingKey === k;
            return (
              <li key={k || "__none__"} className="cat-row">
                <div className="cat-main">
                  <span className={"cat-name" + (row.name === null ? " none" : "")}>
                    {row.name ?? "(분류 없음)"}
                  </span>
                  <span className="cat-count">{row.count}권</span>
                </div>

                {editing ? (
                  <div className="cat-edit">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="새 카테고리 이름 (비우면 분류 없음)"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") apply(row, draft);
                        if (e.key === "Escape") setEditingKey(null);
                      }}
                    />
                    <div className="cat-presets">
                      {PRESETS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          className="cat-preset"
                          disabled={busy}
                          onClick={() => apply(row, p)}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <div className="cat-edit-actions">
                      <button className="btn secondary" onClick={() => setEditingKey(null)}>
                        취소
                      </button>
                      <button className="btn" disabled={busy} onClick={() => apply(row, draft)}>
                        {busy ? "변경 중..." : "변경"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn secondary cat-edit-btn" onClick={() => startEdit(row)}>
                    이름 바꾸기
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
