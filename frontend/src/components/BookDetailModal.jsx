import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteBook, getBook, updateBook, coverImageUrl } from "../api/books";
import BookForm from "./BookForm.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import ImageLightbox from "./ImageLightbox.jsx";
import ReviewMarkdown from "./ReviewMarkdown.jsx";
import { formatDateTime } from "../utils/date.js";
import { REVIEW_SAVED_MESSAGE } from "../constants.js";
import "./BookDetailModal.css";

export default function BookDetailModal({ bookId, onClose, onUpdated, onDeleted }) {
  const navigate = useNavigate();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  // 표지 파일이 사라진 책은 깨진 이미지 대신 "표지 없음"으로 보여준다(관리 → 서재 점검에서 복구)
  const [coverFailed, setCoverFailed] = useState(false);
  // 표지를 눌러 크게 보는 중인지. 표지의 작은 글씨(옮긴이·원제 등)를 읽으려면 확대가 필요하다.
  const [zoomingCover, setZoomingCover] = useState(false);

  const overlayRef = useRef(null);
  // 누르기가 **오버레이에서 시작했는지**. 아래 handleOverlayClick의 설명 참고.
  const pressStartedOnOverlay = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCoverFailed(false);
    setZoomingCover(false); // 다른 책으로 넘어갈 때 확대창이 남아 있지 않게
    getBook(bookId)
      .then((data) => {
        if (!cancelled) setBook(data);
      })
      .catch(() => {
        if (!cancelled) setError("책 정보를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  async function handleUpdate(fields, opts) {
    const updated = await updateBook(bookId, fields, opts);
    setBook(updated);
    setEditing(false);
    onUpdated?.(updated);
  }

  async function handleDelete() {
    await deleteBook(bookId);
    onDeleted?.(bookId);
    onClose();
  }

  /**
   * 바깥을 눌러 닫기 — **두 가지를 모두 만족해야** 닫는다.
   *
   * 1. 누르기가 오버레이에서 **시작**했을 것.
   *    `click`은 누른 곳과 뗀 곳의 **공통 조상**에서 발생한다. 그래서 입력칸 안에서
   *    글자를 드래그해 고르다가 **창 밖에서 손을 떼면** click의 대상이 오버레이가 되어
   *    창이 닫혔다. 적어 둔 서평이 통째로 날아가는 사고였다(제보받은 증상).
   * 2. **수정 중이 아닐 것.** 수정 중에는 [취소]나 [업데이트]로만 빠져나간다.
   *    긴 서평을 쓰다가 손이 스쳐 닫히면 잃는 것이 너무 크다.
   */
  /**
   * 서평 전용 화면으로 **같은 탭에서** 이동한다.
   *
   * 예전에는 `window.open`으로 새 창을 띄웠는데, **폰에서는 새 탭이 되어 돌아올 길이
   * 사실상 없었다**(탭 전환기를 뒤져야 하고, 홈화면 앱에서는 앱 밖으로 나가 버린다).
   * 제보받은 문제다.
   *
   * 지금은 팝업 열림 여부가 주소(`?book=`)에 실려 있어(useSelectedBook) **뒤로 가기 한 번이면
   * 이 팝업이 그대로 다시 열린다.** 서평 화면의 [← 돌아가기]도 같은 일을 한다.
   *
   * ⚠️ 수정 폼의 [외부 에디터]는 사정이 다르다 — 거기서 같은 탭으로 이동하면 **쓰던 폼이
   *    날아간다.** 그쪽은 새 창을 유지한다(BookForm.jsx).
   */
  function openReviewWindow() {
    navigate(`/books/${bookId}/review`);
  }

  // 서평 창이 저장하면 이쪽 내용도 즉시 맞춘다. 안 그러면 여기 남아 있는 옛 서평이
  // 화면에 계속 보이고, [내용 업데이트]로 저장하면 **옛 값으로 덮어쓴다.**
  useEffect(() => {
    function onMessage(e) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== REVIEW_SAVED_MESSAGE) return;
      if (String(e.data.bookId) !== String(bookId)) return;
      setBook((prev) => (prev ? { ...prev, comment: e.data.comment } : prev));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bookId]);

  function handleOverlayMouseDown(e) {
    pressStartedOnOverlay.current = e.target === overlayRef.current;
  }

  function handleOverlayClick(e) {
    const started = pressStartedOnOverlay.current;
    pressStartedOnOverlay.current = false;
    if (editing) return;
    if (!started) return;
    if (e.target !== overlayRef.current) return;
    onClose();
  }

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
    >
      <div className="modal-box card">
        {/* 수정 중에는 ✕도 감춘다 — 나가는 길을 [취소]/[업데이트] 둘로만 둬야
            "눌렀더니 쓰던 게 날아갔다"가 생기지 않는다. */}
        {!editing && (
          <button className="modal-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        )}

        {loading && <p>불러오는 중...</p>}
        {error && <p className="form-error">{error}</p>}

        {book && !editing && (
          <div className="book-detail">
            {book.cover_image_path && !coverFailed ? (
              /* 누르면 크게 볼 수 있다 — 표지에 적힌 작은 글씨를 확인하려는 용도 */
              <button
                type="button"
                className="book-detail-cover-zoom"
                onClick={() => setZoomingCover(true)}
                title="표지를 크게 보기"
              >
                <img
                  className="book-detail-cover"
                  src={coverImageUrl(book.cover_image_path)}
                  alt={book.title}
                  onError={() => setCoverFailed(true)}
                />
                <span className="book-detail-cover-hint">🔍 크게 보기</span>
              </button>
            ) : (
              <div className="book-detail-cover book-detail-cover-empty">표지 없음</div>
            )}
            {/* 표지만 바꾸고 싶은 경우가 잦아서 수정 화면으로 바로 가는 버튼을 따로 뒀다 */}
            <button className="btn secondary book-detail-cover-btn" onClick={() => setEditing(true)}>
              🖼 표지 바꾸기
            </button>
            <h2>{book.title}</h2>
            <dl>
              <dt>저자</dt>
              <dd>{book.author}</dd>
              <dt>출판사</dt>
              <dd>{book.publisher}</dd>
              <dt>출판연도</dt>
              <dd>{book.pub_year || "-"}</dd>
              <dt>카테고리</dt>
              <dd>{book.category || "-"}</dd>
              <dt>ISBN</dt>
              <dd>{book.isbn || "-"}</dd>
              <dt>책꽂이 위치</dt>
              <dd>{book.shelf_location || "-"}</dd>
              <dt>번역자</dt>
              <dd>{book.translator || "-"}</dd>
              <dt>원서 출판사</dt>
              <dd>{book.original_publisher || "-"}</dd>
              <dt>원서 출판연도</dt>
              <dd>{book.original_pub_year || "-"}</dd>
              <dt>등록일</dt>
              <dd>{formatDateTime(book.created_at)}</dd>
            </dl>

            {/* 서평은 A4 1~2쪽까지 들어온다. 여기 통째로 펼치면 **정작 책 정보가
                스크롤 밖으로 밀려** 둘 다 못 보게 된다. 그래서 세 줄만 맛보기로 보여 주고
                읽고 쓰는 일은 서평 전용 화면으로 넘긴다. */}
            <section className="book-review">
              <div className="book-review-head">
                <h3>서평</h3>
                <button className="btn secondary btn-sm" onClick={openReviewWindow}>
                  {book.comment ? "서평 전체 보기" : "서평 쓰기"}
                </button>
              </div>
              {book.comment ? (
                /* 서평은 **마크다운으로 그린다** — 제목은 제목답게, 굵은 글씨는 굵게.
                   예전에는 마크다운 기호를 벗겨 평문으로 이어 붙였는데, 그러면
                   `# 제목`과 본문이 한 덩어리로 붙어 무슨 글인지 알 수 없었다
                   ("나의 첫 서평 — 첫인상 처음 읽었을 때는…").
                   대신 높이를 제한하고 아래를 흐리게 해 "이어진다"는 것을 보여 준다. */
                <div
                  className="book-review-peek"
                  role="button"
                  tabIndex={0}
                  title="눌러서 전체 보기"
                  onClick={openReviewWindow}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openReviewWindow();
                    }
                  }}
                >
                  <ReviewMarkdown text={book.comment} />
                </div>
              ) : (
                <p className="book-review-empty">아직 적은 서평이 없습니다.</p>
              )}
            </section>

            <div className="modal-actions">
              <button className="btn" onClick={() => setEditing(true)}>
                내용 업데이트
              </button>
              <button className="btn danger" onClick={() => setConfirmingDelete(true)}>
                책 제거
              </button>
            </div>
          </div>
        )}

        {book && zoomingCover && book.cover_image_path && !coverFailed && (
          <ImageLightbox
            src={coverImageUrl(book.cover_image_path)}
            alt={book.title}
            onClose={() => setZoomingCover(false)}
          />
        )}

        {book && editing && (
          <BookForm
            initialValues={book}
            initialCoverImagePath={book.cover_image_path}
            allowCoverSearch
            checkDuplicates
            excludeDuplicateId={book.id}
            bookId={book.id}
            submitLabel="업데이트"
            onCancel={() => setEditing(false)}
            onSubmit={handleUpdate}
          />
        )}
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          message={`"${book?.title}" 책을 삭제하시겠습니까?`}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
