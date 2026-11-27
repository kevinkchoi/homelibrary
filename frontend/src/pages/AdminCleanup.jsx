import { useEffect, useState } from "react";
import useSelectedBook from "../hooks/useSelectedBook.js";
import {
  acknowledgeAllDuplicates,
  acknowledgeDuplicate,
  deleteBook,
  fetchBrokenCovers,
  fetchDuplicates,
  fetchUnusedImages,
  purgeUnusedImages,
  repairCovers,
  unacknowledgeDuplicate,
} from "../api/books";
import BookDetailModal from "../components/BookDetailModal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import CoverThumb from "../components/CoverThumb.jsx";
import "./AdminCleanup.css";

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// 중복 묶음 안의 책 한 권. 어느 것을 남길지 판단하려면 표지·서지정보·책꽂이 위치가 다 보여야 한다.
function BookRow({ book, onOpen, onDelete }) {
  const details = [
    book.publisher,
    book.pub_year ? `${book.pub_year}년` : null,
    book.isbn ? `ISBN ${book.isbn}` : null,
  ].filter(Boolean);

  return (
    <li className="cleanup-row">
      <CoverThumb
        path={book.cover_image_path}
        className="cleanup-thumb"
        placeholderClassName="cleanup-thumb-empty"
      />
      <div className="cleanup-info">
        <button type="button" className="cleanup-title" onClick={() => onOpen(book.id)}>
          {book.title}
        </button>
        <span className="cleanup-sub">{book.author}</span>
        {details.length > 0 && <span className="cleanup-sub">{details.join(" · ")}</span>}
        <span className="cleanup-sub">
          📍 {book.shelf_location || "위치 기록 안 됨"} · 등록 #{book.id}
        </span>
      </div>
      {onDelete && (
        <button type="button" className="btn danger cleanup-del" onClick={() => onDelete(book)}>
          삭제
        </button>
      )}
    </li>
  );
}

export default function AdminCleanup() {
  const [duplicates, setDuplicates] = useState(null);
  // "다른 책"으로 표시해 둔 묶음까지 함께 볼지 (되돌리려면 이걸 켜야 한다)
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const [broken, setBroken] = useState(null);
  const [unusedImages, setUnusedImages] = useState(null);
  const [loading, setLoading] = useState(true);
  // 팝업 열림 여부를 주소(?book=)에 싣는다 — 서평을 보고 돌아왔을 때 제자리로.
  const [openBookId, setOpenBookId] = useSelectedBook();
  const [pendingDelete, setPendingDelete] = useState(null);
  const [repairing, setRepairing] = useState(false);
  const [repairMessage, setRepairMessage] = useState("");
  const [purging, setPurging] = useState(false);
  const [purgeMessage, setPurgeMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [dup, brk, img] = await Promise.all([
        fetchDuplicates(showAcknowledged),
        fetchBrokenCovers(),
        // 개인 서재(personal) 서버에서는 운영자만 볼 수 있다(모든 사용자의 파일을 보는 작업).
        // 하나가 실패했다고 점검 화면 전체가 오류가 되지 않게, 이것만 조용히 빼 둔다.
        fetchUnusedImages().catch(() => null),
      ]);
      setDuplicates(dup);
      setBroken(brk);
      setUnusedImages(img);
    } catch {
      setError("점검 결과를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAcknowledged]);

  // 집에 일부러 같은 책을 여러 권 두거나, 제목만 같은 다른 책인 경우가 있다.
  // 한 번 "다른 책"이라고 표시하면 서재 점검과 등록 경고 양쪽에서 빠진다.
  async function markNotDuplicate(group) {
    await acknowledgeDuplicate(group.reason, group.key);
    load();
  }

  async function markAllNotDuplicate() {
    await acknowledgeAllDuplicates();
    load();
  }

  async function undoNotDuplicate(group) {
    await unacknowledgeDuplicate(group.reason, group.key);
    load();
  }

  async function handleDelete() {
    const target = pendingDelete;
    setPendingDelete(null);
    await deleteBook(target.id);
    load();
  }

  async function handlePurgeImages() {
    setPurging(true);
    setPurgeMessage("");
    try {
      const r = await purgeUnusedImages();
      setPurgeMessage(
        `임시 이미지 ${r.temp_removed}개, 사용되지 않는 이미지 ${r.orphan_removed}개를 정리했습니다.`
      );
      await load();
    } catch {
      setPurgeMessage("정리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setPurging(false);
    }
  }

  async function handleRepair() {
    setRepairing(true);
    setRepairMessage("");
    try {
      const r = await repairCovers();
      setRepairMessage(
        `${r.checked}권을 점검해 ${r.refetched}권은 표지를 다시 찾아 붙였고, ` +
          `${r.cleared}권은 표지를 찾지 못해 '표지 없음'으로 정리했습니다.`
      );
      await load();
    } catch {
      setRepairMessage("복구 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setRepairing(false);
    }
  }

  return (
    <div className="home-page">
      <div className="home-header">
        <h1>서재 점검</h1>
        <button className="btn secondary" onClick={load} disabled={loading}>
          {loading ? "점검 중..." : "다시 점검"}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}
      {loading && <p>점검 중...</p>}

      {!loading && duplicates && (
        <section className="cleanup-section card">
          <h2>
            중복 등록된 책{" "}
            <span className="cleanup-count">
              {duplicates.groups.length}묶음
              {duplicates.redundant_count > 0 && ` · 정리하면 ${duplicates.redundant_count}권 줄어듦`}
            </span>
          </h2>
          <p className="cleanup-desc">
            같은 책이 여러 번 등록된 것으로 보입니다. 남길 한 권을 정하고 나머지를 삭제하거나,
            <b> 일부러 여러 권 두는 책이거나 제목만 같은 다른 책이면 [다른 책입니다]</b>를 눌러
            주세요. 표시해 두면 서재 점검과 등록 경고 양쪽에서 다시 나오지 않습니다.
          </p>

          {/* 표시해 둔 묶음이 있으면 언제든 되돌릴 수 있게 알려 준다 */}
          {(duplicates.acknowledged_count > 0 || showAcknowledged) && (
            <p className="cleanup-ack-line">
              {duplicates.acknowledged_count}묶음을 “다른 책”으로 표시해 두었습니다.{" "}
              <button
                type="button"
                className="cleanup-link"
                onClick={() => setShowAcknowledged((v) => !v)}
              >
                {showAcknowledged ? "숨기기" : "다시 보기"}
              </button>
            </p>
          )}

          {!showAcknowledged && duplicates.groups.length > 1 && (
            <button className="btn secondary cleanup-ack-all" onClick={markAllNotDuplicate}>
              전부 다른 책으로 표시 ({duplicates.groups.length}묶음)
            </button>
          )}

          {duplicates.groups.length === 0 ? (
            <p className="cleanup-empty">
              {showAcknowledged
                ? "표시해 둔 묶음이 없습니다."
                : "✓ 확인이 필요한 중복이 없습니다."}
            </p>
          ) : (
            duplicates.groups.map((group) => (
              <div key={`${group.reason}-${group.key}`} className="cleanup-group">
                <div className="cleanup-group-head">
                  <span className={"cleanup-badge " + group.reason}>
                    {group.reason === "isbn" ? "ISBN 일치 · 확실한 중복" : "제목 일치 · 확인 필요"}
                  </span>
                  <span className="cleanup-group-key">
                    {group.books.length}권
                    {group.reason === "isbn" && ` · ISBN ${group.key}`}
                  </span>
                </div>
                {group.reason === "title" && (
                  <p className="cleanup-note">
                    판이 다르거나 제목만 같은 다른 책일 수 있으니 확인 후 삭제하세요.
                  </p>
                )}
                <div className="cleanup-group-actions">
                  {showAcknowledged ? (
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => undoNotDuplicate(group)}
                    >
                      다시 중복으로 검사
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => markNotDuplicate(group)}
                    >
                      이건 다른 책입니다
                    </button>
                  )}
                </div>
                <ul className="cleanup-list">
                  {group.books.map((book) => (
                    <BookRow
                      key={book.id}
                      book={book}
                      onOpen={setOpenBookId}
                      onDelete={setPendingDelete}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      )}

      {!loading && broken && (
        <section className="cleanup-section card">
          <h2>
            표지가 깨진 책 <span className="cleanup-count">{broken.total}권</span>
          </h2>
          <p className="cleanup-desc">
            표지 정보는 있는데 이미지 파일이 사라진 책입니다. [표지 복구]를 누르면 인터넷에서
            표지를 다시 찾아 붙이고, 찾지 못하면 '표지 없음' 상태로 정리합니다.
          </p>

          {broken.total > 0 && (
            <button className="btn" onClick={handleRepair} disabled={repairing}>
              {repairing ? "복구 중..." : `표지 복구 (${broken.total}권)`}
            </button>
          )}
          {repairMessage && <p className="cleanup-result">{repairMessage}</p>}

          {broken.total === 0 ? (
            <p className="cleanup-empty">✓ 표지가 깨진 책이 없습니다.</p>
          ) : (
            <ul className="cleanup-list">
              {broken.items.map((book) => (
                <BookRow key={book.id} book={book} onOpen={setOpenBookId} />
              ))}
            </ul>
          )}
        </section>
      )}

      {!loading && unusedImages && (
        <section className="cleanup-section card">
          <h2>
            사용되지 않는 이미지{" "}
            <span className="cleanup-count">
              {unusedImages.orphan_count}개 · {formatBytes(unusedImages.orphan_bytes)}
            </span>
          </h2>
          <p className="cleanup-desc">
            어느 책도 쓰지 않는 표지 파일입니다. <strong>앱이 시작될 때 자동으로 정리</strong>되며,
            아래 버튼으로 지금 바로 정리할 수도 있습니다. 등록된 책이 쓰고 있는 표지와 최근 24시간
            이내에 만들어진 파일은 지우지 않습니다.
            {" "}현재 사용 중인 표지는 {unusedImages.referenced_count}개입니다.
          </p>

          {unusedImages.orphan_count > 0 ? (
            <button className="btn" onClick={handlePurgeImages} disabled={purging}>
              {purging ? "정리 중..." : `지금 정리 (${formatBytes(unusedImages.orphan_bytes)} 확보)`}
            </button>
          ) : (
            <p className="cleanup-empty">✓ 정리할 이미지가 없습니다.</p>
          )}
          {purgeMessage && <p className="cleanup-result">{purgeMessage}</p>}
        </section>
      )}

      {openBookId && (
        <BookDetailModal
          bookId={openBookId}
          onClose={() => setOpenBookId(null)}
          onUpdated={load}
          onDeleted={() => {
            setOpenBookId(null);
            load();
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          message={`"${pendingDelete.title}" (등록 #${pendingDelete.id})을 삭제하시겠습니까? 되돌릴 수 없습니다.`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
