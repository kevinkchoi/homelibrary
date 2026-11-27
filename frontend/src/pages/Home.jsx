import { useEffect, useRef, useState } from "react";
import useSelectedBook from "../hooks/useSelectedBook.js";
import { listBooks, listShelves } from "../api/books";
import BookFilterBar from "../components/BookFilterBar.jsx";
import BookTable from "../components/BookTable.jsx";
import BookGrid from "../components/BookGrid.jsx";
import BookDetailModal from "../components/BookDetailModal.jsx";
import Pagination from "../components/Pagination.jsx";
import useDebouncedValue from "../hooks/useDebouncedValue.js";
import {
  DEFAULT_PAGE_SIZE,
  FILTER_DEBOUNCE_MS,
  PAGE_SIZE_KEY,
  VIEW_MODE_KEY,
} from "../constants.js";
import "./Home.css";

export default function Home() {
  const [filters, setFilters] = useState({
    title: "",
    author: "",
    publisher: "",
    category: "",
    shelf: [],   // 여러 곳을 동시에 고를 수 있다. 빈 문자열 하나가 "미지정"을 뜻한다.
  });
  const [shelves, setShelves] = useState([]);
  const [sortBy, setSortBy] = useState("created_at");
  const [order, setOrder] = useState("desc");
  const [books, setBooks] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // 팝업 열림 여부를 주소(?book=)에 싣는다 — 서평을 보고 돌아왔을 때 제자리로.
  const [selectedBookId, setSelectedBookId] = useSelectedBook();
  const [viewMode, setViewMode] = useState(() => localStorage.getItem(VIEW_MODE_KEY) || "list");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(
    () => Number(localStorage.getItem(PAGE_SIZE_KEY)) || DEFAULT_PAGE_SIZE
  );

  // 입력창은 즉시 반응해야 하므로 filters는 그대로 두고, 서버에 넘길 값만 늦춘다.
  const debouncedFilters = useDebouncedValue(filters, FILTER_DEBOUNCE_MS);

  // 응답이 보낸 순서대로 돌아오지 않을 수 있어(빠르게 타이핑하면 흔함) 가장 최신 요청의 응답만 반영한다.
  const requestIdRef = useRef(0);

  function changeView(mode) {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

  function handlePageSize(n) {
    localStorage.setItem(PAGE_SIZE_KEY, String(n));
    setPageSize(n);
    setPage(1);
  }

  function handleFilters(newFilters) {
    setFilters(newFilters);
    setPage(1);
  }

  function handleSort(key, nextOrder) {
    setSortBy(key);
    setOrder(nextOrder);
    setPage(1);
  }

  async function load() {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const data = await listBooks({
        sort_by: sortBy,
        order,
        ...debouncedFilters,
        skip: (page - 1) * pageSize,
        limit: pageSize,
      });
      if (requestId !== requestIdRef.current) return; // 더 새로운 요청이 떠났으므로 이 응답은 버린다
      setBooks(data.items);
      setTotal(data.total);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, order, debouncedFilters, page, pageSize]);

  // 책꽂이 목록(고를 거리)은 화면에 들어올 때 한 번 받는다. 자주 바뀌지 않고,
  // 매 필터 변경마다 다시 부르면 타이핑할 때마다 요청이 두 배가 된다.
  useEffect(() => {
    let alive = true;
    listShelves()
      .then((rows) => alive && setShelves(rows))
      .catch(() => {
        /* 책꽂이 목록을 못 받아도 나머지 필터는 그대로 쓸 수 있어야 한다 */
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="home-page">
      <BookFilterBar filters={filters} onChange={handleFilters} shelves={shelves} />

      <div className="view-toolbar">
        <Pagination
          page={page}
          total={total}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={handlePageSize}
        />
        <div className="view-toggle">
          <button
            type="button"
            className={"view-toggle-btn" + (viewMode === "list" ? " active" : "")}
            onClick={() => changeView("list")}
            aria-pressed={viewMode === "list"}
          >
            ☰ 리스트
          </button>
          <button
            type="button"
            className={"view-toggle-btn" + (viewMode === "grid" ? " active" : "")}
            onClick={() => changeView("grid")}
            aria-pressed={viewMode === "grid"}
          >
            ▦ 큰 아이콘
          </button>
        </div>
      </div>

      {loading ? (
        <p>불러오는 중...</p>
      ) : viewMode === "grid" ? (
        <BookGrid books={books} onSelect={setSelectedBookId} />
      ) : (
        <BookTable
          books={books}
          sortBy={sortBy}
          order={order}
          onSort={handleSort}
          onSelect={setSelectedBookId}
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
    </div>
  );
}
