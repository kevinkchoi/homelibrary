import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSelectedBook from "../hooks/useSelectedBook.js";
import { searchBooks } from "../api/books";
import BookTable from "../components/BookTable.jsx";
import BookDetailModal from "../components/BookDetailModal.jsx";
import Pagination from "../components/Pagination.jsx";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_KEY } from "../constants.js";
import "./Home.css";

export default function BookSearch() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get("q") || "";
  const [books, setBooks] = useState([]);
  const [total, setTotal] = useState(0);
  // 검색어 그대로는 못 찾아 **단어를 나눠** 찾은 결과인지. 그 경우 단어들이 제각각 떨어져 있는
  // 책도 걸리므로, 왜 이런 게 나왔는지 화면에서 알려줘야 한다.
  const [relaxed, setRelaxed] = useState(false);
  // 저자 이름을 소리로 맞춰 찾았는지(`Laurent` → `로랑`). 왜 이런 결과가 나왔는지
  // 알려주지 않으면 엉뚱해 보인다.
  const [soundsLike, setSoundsLike] = useState(false);
  const [loading, setLoading] = useState(false);
  // 팝업 열림 여부를 주소(?book=)에 싣는다 — 서평을 보고 돌아왔을 때 제자리로.
  const [selectedBookId, setSelectedBookId] = useSelectedBook();
  const [sortBy, setSortBy] = useState("title");
  const [order, setOrder] = useState("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(
    () => Number(localStorage.getItem(PAGE_SIZE_KEY)) || DEFAULT_PAGE_SIZE
  );

  const requestIdRef = useRef(0);

  // 검색어가 바뀌면 이전 검색의 페이지 번호를 들고 가면 안 된다(결과 수가 달라지므로)
  useEffect(() => {
    setPage(1);
  }, [q]);

  function handlePageSize(n) {
    localStorage.setItem(PAGE_SIZE_KEY, String(n));
    setPageSize(n);
    setPage(1);
  }

  function handleSort(key, nextOrder) {
    setSortBy(key);
    setOrder(nextOrder);
    setPage(1);
  }

  useEffect(() => {
    if (!q) {
      setBooks([]);
      setTotal(0);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    searchBooks({
      q,
      sort_by: sortBy,
      order,
      skip: (page - 1) * pageSize,
      limit: pageSize,
    })
      .then((data) => {
        if (requestId !== requestIdRef.current) return; // 더 새로운 검색이 떠났으므로 버린다
        setBooks(data.items);
        setTotal(data.total);
        setRelaxed(Boolean(data.relaxed));
        setSoundsLike(Boolean(data.sounds_like));
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [q, sortBy, order, page, pageSize]);

  return (
    <div className="home-page">
      <div className="home-header">
        <h1>책 찾기</h1>
        {q && (
          <span className="home-total">
            "{q}" 검색결과 총 {total}건
          </span>
        )}
      </div>

      {q && !loading && soundsLike && (
        <p className="search-relaxed">
          글자가 같은 책에 이어, <b>이름의 소리가 같은</b> 책도 함께 보여 줍니다
          (예: <code>Robert</code> → <code>로버트</code>, <code>einstein</code> → <code>아인슈타인</code>).
          저자와 제목을 모두 봅니다. 소리가 비슷한 다른 책도 섞여 있습니다.
        </p>
      )}

      {q && !loading && relaxed && !soundsLike && (
        <p className="search-relaxed">
          “{q}”가 그대로 들어간 책은 없어서 <b>단어를 나눠</b> 찾았습니다. 단어들이 제목·저자 등에
          떨어져 있는 책도 함께 나옵니다.
        </p>
      )}

      {!q && <p>상단 검색창에 제목, 저자, 출판사, 번역자, ISBN 키워드를 입력해 책을 찾아보세요.</p>}
      {q && loading && <p>검색 중...</p>}
      {q && !loading && (
        <>
          <div className="view-toolbar">
            <Pagination
              page={page}
              total={total}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={handlePageSize}
            />
          </div>
          <BookTable
            books={books}
            sortBy={sortBy}
            order={order}
            onSort={handleSort}
            onSelect={setSelectedBookId}
          />
        </>
      )}

      {selectedBookId && (
        <BookDetailModal bookId={selectedBookId} onClose={() => setSelectedBookId(null)} />
      )}
    </div>
  );
}
