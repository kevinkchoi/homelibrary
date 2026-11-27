import "./Pagination.css";

export default function Pagination({ page, total, pageSize, onPage, onPageSize }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // 현재 10페이지 묶음(decade)의 시작·끝 페이지 계산
  const decadeStart = Math.floor((page - 1) / 10) * 10 + 1;
  const decadeEnd = Math.min(decadeStart + 9, totalPages);
  const decadePages = Array.from(
    { length: decadeEnd - decadeStart + 1 },
    (_, i) => decadeStart + i
  );

  // totalPages > 10일 때 decade 선택 목록
  function buildDecades() {
    const list = [];
    for (let s = 1; s <= totalPages; s += 10) {
      list.push({ start: s, end: Math.min(s + 9, totalPages) });
    }
    return list;
  }

  return (
    <div className="pagination">
      {/* 페이지 크기 선택 */}
      {[50, 100].map(n => (
        <button
          key={n}
          type="button"
          className={"pg-btn pg-size" + (pageSize === n ? " active" : "")}
          onClick={() => onPageSize(n)}
        >
          {n}권
        </button>
      ))}

      {totalPages > 1 && (
        <>
          <span className="pg-sep" />

          {/* decade 선택 드롭다운: 10페이지 초과일 때만 표시 */}
          {totalPages > 10 && (
            <select
              className="pg-decade-select"
              value={decadeStart}
              onChange={e => onPage(Number(e.target.value))}
              aria-label="페이지 구간 선택"
            >
              {buildDecades().map(d => (
                <option key={d.start} value={d.start}>
                  {d.start}~{d.end}페이지
                </option>
              ))}
            </select>
          )}

          {/* 이전 페이지 */}
          <button
            type="button"
            className="pg-btn pg-arrow"
            onClick={() => onPage(page - 1)}
            disabled={page === 1}
            aria-label="이전 페이지"
          >
            ◀
          </button>

          {/* 현재 decade의 개별 페이지 버튼 */}
          {decadePages.map(p => (
            <button
              key={p}
              type="button"
              className={"pg-btn" + (p === page ? " active" : "")}
              onClick={() => onPage(p)}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </button>
          ))}

          {/* 다음 페이지 */}
          <button
            type="button"
            className="pg-btn pg-arrow"
            onClick={() => onPage(page + 1)}
            disabled={page === totalPages}
            aria-label="다음 페이지"
          >
            ▶
          </button>
        </>
      )}
    </div>
  );
}
