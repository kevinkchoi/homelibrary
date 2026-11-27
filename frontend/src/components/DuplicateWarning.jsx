import CoverThumb from "./CoverThumb.jsx";
import "./DuplicateWarning.css";

// 이미 등록된 책 한 권을 한 줄로 보여준다. 책꽂이 위치를 함께 띄우는 게 핵심 —
// "집에 이미 있다"를 알았을 때 다음 질문이 항상 "그럼 어디 있지?"이기 때문.
function MatchRow({ book }) {
  const details = [
    book.author,
    book.publisher,
    book.pub_year ? `${book.pub_year}년` : null,
  ].filter(Boolean);

  return (
    <li className="dupe-row">
      <CoverThumb path={book.cover_image_path} className="dupe-thumb" placeholderClassName="dupe-thumb-empty" />
      <span className="dupe-info">
        <strong>{book.title}</strong>
        <span className="dupe-sub">{details.join(" · ")}</span>
        <span className="dupe-shelf">
          📍 책꽂이 위치: {book.shelf_location || "기록 안 됨"}
        </span>
      </span>
    </li>
  );
}

/**
 * 중복 등록 경고. `result`는 GET /api/books/check-duplicate 응답.
 *
 * ISBN 일치와 제목 일치를 나눠서 보여준다 — ISBN이 같으면 판까지 같은 확실한 중복이지만,
 * 제목만 같으면 다른 판이거나 동명의 다른 책일 수 있어 사용자가 판단해야 한다.
 * `onConfirm`이 주어질 때만(=저장을 막고 물어보는 상황) 진행/취소 버튼을 낸다.
 */
export default function DuplicateWarning({ result, onConfirm, onDismiss, busy }) {
  const isbnMatches = result?.isbn_matches || [];
  const titleMatches = result?.title_matches || [];
  if (isbnMatches.length === 0 && titleMatches.length === 0) return null;

  return (
    <div className="dupe-warning" role="alert">
      <p className="dupe-heading">
        {isbnMatches.length > 0
          ? "⚠️ 이미 서재에 있는 책입니다 (ISBN 일치)"
          : "⚠️ 제목이 같은 책이 이미 서재에 있습니다"}
      </p>

      {isbnMatches.length > 0 && <ul className="dupe-list">{isbnMatches.map((b) => <MatchRow key={b.id} book={b} />)}</ul>}

      {titleMatches.length > 0 && (
        <>
          {isbnMatches.length > 0 && <p className="dupe-subheading">제목이 같은 다른 책</p>}
          <ul className="dupe-list">{titleMatches.map((b) => <MatchRow key={b.id} book={b} />)}</ul>
          <p className="dupe-note">
            판이 다르거나 같은 제목의 다른 책일 수 있습니다. 확인 후 진행해주세요.
          </p>
        </>
      )}

      {onConfirm && (
        <div className="dupe-actions">
          <button type="button" className="btn secondary" onClick={onDismiss} disabled={busy}>
            닫기
          </button>
          <button type="button" className="btn" onClick={onConfirm} disabled={busy}>
            {busy ? "추가 중..." : "중복이 아님 · 그래도 추가"}
          </button>
        </div>
      )}
    </div>
  );
}
