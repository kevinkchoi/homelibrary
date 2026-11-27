import { useCallback, useEffect, useState } from "react";
import { getRecommendations, refreshRecommendations } from "../api/recommendations";
import "./Recommend.css";

function formatWhen(iso) {
  if (!iso) return "아직 만든 적 없음";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * [새책 추천] — 지난 3개월 신간 중 우리 서재의 결에 맞는 책.
 *
 * 목록은 서버가 **하루에 한 번만** 만든다(알라딘 여러 번 + Claude 한 번이라 몇 초 걸린다).
 * 그래서 이 화면은 보통 즉시 뜨고, 하루가 지난 첫 열람에서만 기다린다.
 */
export default function Recommend() {
  const [items, setItems] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [curated, setCurated] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const apply = useCallback((data) => {
    setItems(data.items || []);
    setGeneratedAt(data.generated_at || null);
    setCurated(data.curated !== false);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getRecommendations()
      .then((data) => alive && apply(data))
      .catch(() => alive && setError("추천 목록을 불러오지 못했습니다."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [apply]);

  async function handleRefresh() {
    setRefreshing(true);
    setError("");
    try {
      apply(await refreshRecommendations());
    } catch (e) {
      setError(
        e?.response?.data?.detail || "새로 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요."
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="page">
      <div className="home-header rec-header">
        <h1>새책 추천</h1>
        <div className="rec-head-right">
          <span className="rec-when">마지막 갱신 {formatWhen(generatedAt)}</span>
          <button className="btn secondary" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? "만드는 중... (1분 남짓)" : "↻ 지금 갱신"}
          </button>
        </div>
      </div>

      <p className="rec-intro">
        지난 3개월 사이에 나온 책 중에서, 우리 서재가 많이 가진 분야와 결이 맞는 것을 골랐습니다.
        <strong> 이미 가지고 있는 책은 빼고</strong> 보여 줍니다.
      </p>

      {!curated && items.length > 0 && (
        <p className="rec-warn">
          ⚠️ 이번 목록은 <strong>고르는 단계 없이</strong> 분야별 신간을 그대로 담은 것입니다
          (선별이 실패했습니다). [지금 갱신]을 눌러 다시 시도해 보세요.
        </p>
      )}

      {error && <p className="form-error">{error}</p>}
      {loading && <p>불러오는 중... (하루 만에 처음 열면 새로 만드느라 1분 남짓 걸립니다)</p>}
      {!loading && !error && items.length === 0 && (
        <p>추천할 만한 신간을 찾지 못했습니다. [지금 갱신]을 눌러 보세요.</p>
      )}

      <ul className="rec-list">
        {items.map((b) => (
          <li className="rec-card" key={b.id}>
            {b.cover_url ? (
              <img className="rec-cover" src={b.cover_url} alt="" loading="lazy" />
            ) : (
              <div className="rec-cover rec-cover-empty">표지 없음</div>
            )}
            <div className="rec-body">
              <div className="rec-title-row">
                <h2 className="rec-title">{b.title}</h2>
                {b.source && <span className="rec-badge">{b.source}</span>}
              </div>
              <p className="rec-meta">
                {[b.author, b.publisher, b.pub_date].filter(Boolean).join(" · ")}
              </p>
              {b.reason && <p className="rec-reason">{b.reason}</p>}
              <div className="rec-tags">
                {(b.matched_on || "")
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .map((t) => (
                    <span className="rec-tag" key={t}>
                      {t}
                    </span>
                  ))}
                {b.link && (
                  <a className="rec-link" href={b.link} target="_blank" rel="noreferrer">
                    알라딘에서 보기 ↗
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
