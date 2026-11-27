import CoverThumb from "./CoverThumb.jsx";
import "./BookGrid.css";

// 책을 큰 아이콘(표지) 격자로 보여준다. 표지 아래에 제목/저자만 작게 표시.
// (리스트 보기 BookTable의 대안 — Home에서 토글로 선택)
export default function BookGrid({ books, onSelect }) {
  if (books.length === 0) {
    return <p className="book-grid-empty">책이 없습니다.</p>;
  }

  return (
    <div className="book-grid">
      {books.map((book) => (
        <button
          key={book.id}
          type="button"
          className="book-grid-card"
          onClick={() => onSelect(book.id)}
          title={book.title}
        >
          <span className="book-grid-cover-wrap">
            <CoverThumb
              path={book.cover_image_path}
              className="book-grid-cover"
              placeholderClassName="book-grid-cover-placeholder"
            />
          </span>
          <span className="book-grid-title">{book.title}</span>
          <span className="book-grid-author">{book.author}</span>
        </button>
      ))}
    </div>
  );
}
