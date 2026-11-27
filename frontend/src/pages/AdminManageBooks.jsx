import { useEffect, useState } from "react";
import useSelectedBook from "../hooks/useSelectedBook.js";
import { listBooks, bulkDeleteBooks, bulkSetShelf } from "../api/books";
import BookTable from "../components/BookTable.jsx";
import BookDetailModal from "../components/BookDetailModal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import "./Home.css";

export default function AdminManageBooks() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  // 팝업 열림 여부를 주소(?book=)에 싣는다 — 서평을 보고 돌아왔을 때 제자리로.
  const [selectedBookId, setSelectedBookId] = useSelectedBook();
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  // 책꽂이 위치 일괄 지정 — 한 권씩 열어 고치면 수백 권을 도저히 채울 수 없다
  const [shelfInput, setShelfInput] = useState("");
  const [shelfBusy, setShelfBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await listBooks({ sort_by: "title", order: "asc", limit: 1000 });
      setBooks(data.items);
      setSelectedIds([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function toggleSelect(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAll() {
    setSelectedIds(selectedIds.length === books.length ? [] : books.map((b) => b.id));
  }

  async function handleBulkShelf() {
    setShelfBusy(true);
    setMessage("");
    try {
      const r = await bulkSetShelf(selectedIds, shelfInput);
      const where = shelfInput.trim() || "(위치 없음)";
      setMessage(`${r.updated}권의 책꽂이 위치를 “${where}”(으)로 지정했습니다.`);
      setShelfInput("");
      load();
    } catch {
      setMessage("변경하지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setShelfBusy(false);
    }
  }

  async function handleBulkDelete() {
    await bulkDeleteBooks(selectedIds);
    setConfirmingBulkDelete(false);
    load();
  }

  return (
    <div className="home-page">
      <div className="home-header">
        <h1>책 관리</h1>
        <div>
          <button className="btn secondary" onClick={toggleSelectAll} disabled={books.length === 0}>
            {selectedIds.length === books.length && books.length > 0 ? "전체 해제" : "전체 선택"}
          </button>{" "}
          <button
            className="btn danger"
            disabled={selectedIds.length === 0}
            onClick={() => setConfirmingBulkDelete(true)}
          >
            선택 삭제 ({selectedIds.length})
          </button>
        </div>
      </div>

      {/* 고른 책이 있을 때만 나타난다 — 평소엔 화면을 어지럽히지 않도록 */}
      {selectedIds.length > 0 && (
        <div className="bulk-shelf card">
          <label>
            선택한 {selectedIds.length}권의 책꽂이 위치
            <div className="bulk-shelf-row">
              <input
                value={shelfInput}
                onChange={(e) => setShelfInput(e.target.value)}
                placeholder="예: 거실 책장 3칸"
                onKeyDown={(e) => e.key === "Enter" && handleBulkShelf()}
              />
              <button className="btn" disabled={shelfBusy} onClick={handleBulkShelf}>
                {shelfBusy ? "지정 중..." : "일괄 지정"}
              </button>
            </div>
          </label>
          <p className="bulk-shelf-hint">
            비워 두고 [일괄 지정]을 누르면 위치를 지웁니다.
          </p>
        </div>
      )}

      {message && <p className="bulk-shelf-message">{message}</p>}

      {loading ? (
        <p>불러오는 중...</p>
      ) : (
        <BookTable
          books={books}
          sortBy=""
          order="asc"
          onSort={() => {}}
          sortable={false}
          onSelect={setSelectedBookId}
          selectable
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
        />
      )}

      {selectedBookId && (
        <BookDetailModal
          bookId={selectedBookId}
          onClose={() => setSelectedBookId(null)}
          onUpdated={load}
          onDeleted={load}
        />
      )}

      {confirmingBulkDelete && (
        <ConfirmDialog
          message={`선택한 ${selectedIds.length}권을 삭제하시겠습니까?`}
          onCancel={() => setConfirmingBulkDelete(false)}
          onConfirm={handleBulkDelete}
        />
      )}
    </div>
  );
}
