import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getBook, updateBook, coverImageUrl } from "../api/books";
import ReviewMarkdown from "../components/ReviewMarkdown.jsx";
import MarkdownToolbar from "../components/MarkdownToolbar.jsx";
import { REVIEW_SAVED_MESSAGE } from "../constants.js";
import useBusyWhile from "../hooks/useBusyWhile.js";
import "./BookReview.css";

/**
 * 서평 전용 화면 — 보기와 편집을 한 자리에서.
 *
 * **왜 따로 창을 두는가**: 책 상세 팝업은 서지정보를 보는 곳이다. A4 한두 쪽짜리 서평을
 * 거기 펼치면 정작 책 정보가 스크롤 밖으로 밀려 **둘 다 못 보게 된다.** 그래서 팝업에서는
 * 서평을 세 줄만 보여 주고, 제대로 읽고 쓰는 일은 이 화면으로 넘긴다.
 *
 * **다른 창에서 열렸을 때**(`window.open`) 저장하면 원래 창에 알린다 — 그래야 열어 둔
 * 수정 폼이 **옛 서평을 그대로 다시 저장해 덮어쓰는** 일이 없다.
 */
export default function BookReview() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [book, setBook] = useState(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(params.get("edit") === "1");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(null);

  // 저장하지 않은 변경이 있는지 — 창을 닫으려 할 때 붙잡기 위해.
  const savedTextRef = useRef("");
  const textareaRef = useRef(null);
  // 이 화면에 **앱 안에서** 들어왔는지. 새 창/새 탭으로 바로 열린 경우에는
  // 뒤로 갈 곳이 없으므로 [돌아가기]의 행선지를 달리해야 한다.
  const cameFromAppRef = useRef(typeof window !== "undefined" && window.history.length > 1);
  const dirty = editing && text !== savedTextRef.current;

  // 서평을 쓰는 중에는 조용한 갱신을 막는다 — A4 한두 쪽을 날릴 수는 없다.
  useBusyWhile(editing);

  useEffect(() => {
    let alive = true;
    getBook(id)
      .then((b) => {
        if (!alive) return;
        setBook(b);
        setText(b.comment || "");
        savedTextRef.current = b.comment || "";
      })
      .catch(() => alive && setError("책을 불러오지 못했습니다."));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    document.title = book ? `서평 — ${book.title}` : "서평";
  }, [book]);

  // 쓰던 글을 창 닫기로 잃지 않게. 저장했으면 묻지 않는다.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!book) return;
    setSaving(true);
    setError("");
    try {
      // ⚠️ 이 엔드포인트는 multipart라 **전체 필드를 함께** 보내야 한다.
      //    comment만 보내면 title/author/publisher가 없다고 422가 난다.
      const updated = await updateBook(book.id, {
        title: book.title,
        author: book.author,
        publisher: book.publisher,
        pub_year: book.pub_year ?? "",
        shelf_location: book.shelf_location ?? "",
        category: book.category ?? "",
        isbn: book.isbn ?? "",
        translator: book.translator ?? "",
        original_publisher: book.original_publisher ?? "",
        original_pub_year: book.original_pub_year ?? "",
        comment: text,
      }, { coverImagePath: book.cover_image_path || undefined });
      setBook(updated);
      savedTextRef.current = updated.comment || "";
      setText(updated.comment || "");
      setSavedAt(new Date());
      setEditing(false);
      // 이 창을 연 쪽(책 수정 폼)에 알린다 — 그쪽이 옛 값으로 덮어쓰지 않도록.
      window.opener?.postMessage(
        { type: REVIEW_SAVED_MESSAGE, bookId: updated.id, comment: updated.comment || "" },
        window.location.origin
      );
    } catch (e) {
      setError(e?.response?.data?.detail || "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }, [book, text]);

  /**
   * 책 정보로 돌아간다.
   *
   * 앱 안에서 들어왔으면 **뒤로 가기**가 정답이다 — 보고 있던 목록의 스크롤 위치까지
   * 그대로 돌아가고, 주소에 실린 `?book=`이 팝업을 다시 열어 준다.
   * 새 창/새 탭으로 바로 열린 경우(외부 에디터)에는 뒤로 갈 곳이 없으므로,
   * 창을 닫을 수 있으면 닫고 아니면 그 책의 팝업이 열린 홈으로 보낸다.
   */
  function goBack() {
    if (dirty && !window.confirm("저장하지 않은 서평이 있습니다. 그래도 나갈까요?")) return;
    if (cameFromAppRef.current) {
      navigate(-1);
      return;
    }
    if (window.opener && !window.opener.closed) {
      window.close();
      return;
    }
    navigate(`/?book=${id}`, { replace: true });
  }

  function cancel() {
    setText(savedTextRef.current);
    setEditing(false);
    setPreview(false);
  }

  if (error && !book) return <div className="page"><p className="form-error">{error}</p></div>;
  if (!book) return <div className="page"><p>불러오는 중...</p></div>;

  return (
    <div className="page review-page">
      <div className="review-top">
        {book.cover_image_path && (
          <img className="review-cover" src={coverImageUrl(book.cover_image_path)} alt="" />
        )}
        <div className="review-bookinfo">
          <h1 className="review-title">{book.title}</h1>
          <p className="review-meta">
            {[book.author, book.publisher, book.pub_year].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="review-actions">
          {/* 폰에서 서평을 읽고 **책 정보로 돌아갈 길**이 없다는 제보를 받고 넣었다.
              팝업 열림 여부가 주소(`?book=`)에 실려 있어 뒤로 가면 그 팝업이 그대로 열린다. */}
          <button className="btn secondary" onClick={goBack} disabled={saving}>
            ← 돌아가기
          </button>
          {!editing ? (
            <button className="btn" onClick={() => setEditing(true)}>
              ✎ 서평 쓰기
            </button>
          ) : (
            <>
              <button className="btn secondary" onClick={() => setPreview((v) => !v)}>
                {preview ? "✎ 계속 쓰기" : "👁 미리보기"}
              </button>
              <button className="btn secondary" onClick={cancel} disabled={saving}>
                취소
              </button>
              <button className="btn" onClick={save} disabled={saving}>
                {saving ? "저장 중..." : "저장"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      {savedAt && !editing && (
        <p className="review-saved">저장했습니다 ({savedAt.toLocaleTimeString("ko-KR")}).</p>
      )}

      {editing && !preview && (
        <>
          <p className="review-hint">
            <b>마크다운</b>으로 씁니다 — <code># 큰제목</code> <code>## 중간제목</code>{" "}
            <code>- 목록</code> <code>1. 번호목록</code> <code>**굵게**</code>{" "}
            <code>*기울임*</code>. 빈 줄 하나가 문단을 나눕니다.
            <br />
            {/* 사람은 `#제목`처럼 붙여 쓴다. 규칙은 칸을 요구하지만 이 앱은 둘 다 알아듣는다 —
                그 사실을 알려 주지 않으면 "왜 제목이 안 되지" 하고 헤맨다(실제 제보). */}
            <b>#</b> 이나 <b>*</b> 뒤에 칸을 띄우지 않아도(<code>#제목</code>,{" "}
            <code>*항목</code>) 알아서 제목·목록으로 그립니다. [미리보기]로 확인하세요.
          </p>
          <MarkdownToolbar textareaRef={textareaRef} value={text} onChange={setText} />
          <textarea
            ref={textareaRef}
            className="review-editor"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"# 책 제목\n\n## 첫인상\n\n- 읽은 날:\n- 한 줄 평:\n\n본문을 적으세요."}
            autoFocus
          />
          <p className="review-count">{text.length.toLocaleString()}자</p>
        </>
      )}

      {(!editing || preview) && (
        <div className="review-view">
          <ReviewMarkdown text={text} />
        </div>
      )}
    </div>
  );
}
