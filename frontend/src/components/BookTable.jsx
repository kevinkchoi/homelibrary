import CoverThumb from "./CoverThumb.jsx";
import { formatDate } from "../utils/date.js";
import "./BookTable.css";

const COLUMNS = [
  { key: "title", label: "제목", className: "col-title" },
  { key: "author", label: "저자", className: "col-author" },
  { key: "publisher", label: "출판사", className: "col-publisher" },
  { key: "category", label: "카테고리", className: "col-category" },
  { key: "shelf_location", label: "책꽂이 위치", className: "col-shelf" },
  // 좁은 화면에서는 CSS로 숨긴다(폰에서 6열은 너무 빽빽하다)
  { key: "created_at", label: "등록일", className: "col-added" },
];

/** "홍길동, 김철수, 이영희, …" → ["홍길동", "김철수", …] */
function splitAuthors(value) {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "소설, 프랑스, 고전" → ["소설", "프랑스", "고전"] */
function splitCategories(value) {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 폰에서 쓰는 카드 한 장.
 *
 * 예전에는 폰에서도 표를 그리고 **화면보다 넓게(min-width: 640px)** 두어 가로로 밀어
 * 보게 했다. 그 가로 넘침이 레이아웃 뷰포트를 부풀려 `position: fixed`·`vw`·미디어쿼리를
 * 줄줄이 망가뜨린 **모든 폭 버그의 뿌리**였다.
 * 카드로 바꾸면 문서가 가로로 넘치지 않아 그 문제 전체가 사라지고, 덤으로 표에서 …로
 * 잘리던 저자·출판사가 **다 보인다.**
 */
function BookCard({ book, onSelect, selectable, selectedIds, onToggleSelect }) {
  const categories = splitCategories(book.category);
  return (
    <li className="book-card">
      {selectable && (
        <input
          className="book-card-check"
          type="checkbox"
          checked={selectedIds.includes(book.id)}
          onChange={() => onToggleSelect(book.id)}
          aria-label={`${book.title} 선택`}
        />
      )}
      <CoverThumb
        path={book.cover_image_path}
        className="book-card-cover"
        placeholderClassName="book-card-cover-empty"
      />
      <div className="book-card-main">
        <button className="book-card-title" onClick={() => onSelect(book.id)}>
          {book.title}
        </button>
        {/* 표에서는 자리가 없어 …로 잘리던 것들이다. 카드에서는 줄바꿈해 전부 보여준다. */}
        <div className="book-card-meta">
          {book.author && <div>{book.author}</div>}
          <div>
            {[book.publisher, book.pub_year ? `${book.pub_year}` : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        {(categories.length > 0 || book.shelf_location) && (
          <div className="book-card-tags">
            {categories.map((c) => (
              <span className="book-tag" key={c}>
                {c}
              </span>
            ))}
            {/* 책꽂이 위치는 이 앱의 존재 이유라 눈에 띄게 둔다 */}
            {book.shelf_location && (
              <span className="book-tag shelf">📍 {book.shelf_location}</span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export default function BookTable({
  books,
  sortBy,
  order,
  onSort,
  onSelect,
  selectable,
  selectedIds,
  onToggleSelect,
  // 정렬을 쓰지 않는 화면(책 관리)은 false. 카드 화면의 정렬 막대를 감춘다 —
  // 눌러도 아무 일이 안 일어나는 단추를 보여주는 것이 더 나쁘다.
  sortable = true,
}) {
  function handleHeaderClick(key) {
    if (sortBy === key) {
      onSort(key, order === "asc" ? "desc" : "asc");
    } else {
      onSort(key, "asc");
    }
  }

  function sortIndicator(key) {
    if (sortBy !== key) return "";
    return order === "asc" ? " ▲" : " ▼";
  }

  return (
    <>
      {/* 좁은 화면용 카드 목록. 표와 **둘 중 하나만** CSS로 보인다(760px 기준).
          둘 다 그리는 이유: 세 화면(홈·책 찾기·책 관리)이 이 컴포넌트를 그대로 쓰고
          있어서, 바깥 인터페이스를 건드리지 않고 안에서만 갈라내는 편이 안전하다. */}

      {/* ⚠️ 카드에는 누를 머리글이 없다. 표에서는 `제목`·`저자` 같은 **머리글을 눌러**
          정렬하는데, 폰에서 표를 카드로 바꾸면서 정렬 수단이 통째로 사라졌었다.
          그래서 카드 화면에는 이 막대를 따로 둔다(표 화면에서는 CSS로 숨긴다). */}
      {sortable && (
        <div className="cards-sort">
          <label className="cards-sort-label">
            정렬
            <select value={sortBy} onChange={(e) => onSort(e.target.value, order)}>
              {COLUMNS.map((col) => (
                <option key={col.key} value={col.key}>
                  {col.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="cards-sort-dir"
            onClick={() => onSort(sortBy, order === "asc" ? "desc" : "asc")}
          >
            {order === "asc" ? "▲ 오름차순" : "▼ 내림차순"}
          </button>
        </div>
      )}

      <ul className="book-cards">
        {books.length === 0 && <li className="book-cards-empty">책이 없습니다.</li>}
        {books.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            onSelect={onSelect}
            selectable={selectable}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </ul>

    <table className="book-table">
      <thead>
        <tr>
          {selectable && <th className="select-col"></th>}
          {COLUMNS.map((col) => (
            <th
              key={col.key}
              className={col.className}
              onClick={() => handleHeaderClick(col.key)}
            >
              {col.label}
              {sortIndicator(col.key)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {books.length === 0 && (
          <tr>
            <td colSpan={selectable ? COLUMNS.length + 1 : COLUMNS.length} className="empty-row">
              책이 없습니다.
            </td>
          </tr>
        )}
        {books.map((book) => {
          const authors = splitAuthors(book.author);
          return (
            <tr key={book.id}>
              {selectable && (
                <td className="select-col">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(book.id)}
                    onChange={() => onToggleSelect(book.id)}
                  />
                </td>
              )}
              <td className="col-title">
                <button className="title-link" onClick={() => onSelect(book.id)}>
                  <CoverThumb
                    path={book.cover_image_path}
                    className="title-thumb"
                    placeholderClassName="title-thumb-placeholder"
                  />
                  <span className="title-text">{book.title}</span>
                </button>
              </td>
              {/* 저자가 14명인 책도 있다(실제로 있다). 좁은 화면에서는 첫 저자만 보이고
                  나머지는 …로 줄인다. 어느 쪽을 보일지는 CSS가 화면 폭으로 고른다 —
                  JS로 폭을 재면 창 크기를 바꿀 때마다 다시 그려야 한다.
                  title 속성에 전체를 담아 둬서 마우스를 올리면 다 볼 수 있다. */}
              <td className="col-author" title={book.author || undefined}>
                <span className="author-full">{book.author}</span>
                <span className="author-short">
                  {authors.length > 1 ? `${authors[0]} …` : book.author}
                </span>
              </td>
              <td className="col-publisher">{book.publisher}</td>
              <td className="col-category">{book.category || "-"}</td>
              <td className="col-shelf">{book.shelf_location || "-"}</td>
              <td className="col-added">{formatDate(book.created_at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </>
  );
}
