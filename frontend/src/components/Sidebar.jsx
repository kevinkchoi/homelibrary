import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { listBooks } from "../api/books";
import { aiAvailable, isPersonal, useAiStatus, useServerConfig } from "../utils/serverConfig.js";
import { canEdit } from "../utils/permissions.js";
import "./Sidebar.css";

// 한 곳에서만 고치면 되도록 링크를 표로 뽑아 둔다.
const LINKS = [
  { to: "/", label: "홈", icon: "🏠", end: true },
  { to: "/search", label: "책 찾기", icon: "🔍" },
  { to: "/add", label: "새책 추가", icon: "➕", needsEdit: true },
  { to: "/scan", label: "바코드 스캔", icon: "📷", needsEdit: true },
  // Claude가 필요한 기능 — personal 모드(homelibrary.kr)에서 자기 키가 없으면 숨긴다
  { to: "/recommend", label: "새책 추천", icon: "✨", needsAi: true },
  // 가족·친구와 함께 쓰는 도서관(개인 서재 서버에서만)
  { to: "/library", label: "우리 도서관", icon: "👪", personalOnly: true },
  { to: "/admin", label: "관리", icon: "⚙️" },
  { to: "/settings", label: "내 설정", icon: "👤" },
  { to: "/help", label: "도움말 · 의견", icon: "❓" },
];

/**
 * 왼쪽에서 나오는 주 메뉴.
 *
 * - **패널만 어둡게** 하고 뒤 화면은 덮지 않는다. 화면 전체를 어둡게 하면 목록이 안 보여
 *   "어디로 가는 중이었는지"를 잃는다. 바깥은 투명한 클릭 감지막만 둔다.
 * - **총 권수**를 여기에 둔다(예전에는 홈 화면 제목 옆). 어느 화면에서든 볼 수 있고,
 *   홈 화면 위쪽 자리를 목록에 돌려준다.
 */
export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();
  const [total, setTotal] = useState(null);
  const ai = useAiStatus();
  const personal = isPersonal(useServerConfig());
  const links = LINKS.filter(
    (link) =>
      (!link.needsAi || aiAvailable(ai)) &&
      (!link.personalOnly || personal) &&
      // '보기만' 멤버에게는 책을 넣는 메뉴를 감춘다(서버도 막는다)
      (!link.needsEdit || canEdit(user, personal)),
  );

  useEffect(() => {
    if (!open) return undefined;

    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);

    // 열려 있는 동안 뒤 배경 스크롤 방지 (다른 오버레이들과 같은 관례)
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // 총 권수는 **열 때만** 받아 온다. 메뉴를 안 여는 사람에게는 요청이 아예 안 나가고,
  // 책을 넣거나 지운 뒤 다시 열면 최신 값이 된다. limit=1이라 목록은 실어 오지 않는다.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    listBooks({ skip: 0, limit: 1 })
      .then((data) => {
        if (!cancelled) setTotal(data.total);
      })
      .catch(() => {
        // 권수는 곁가지다. 실패해도 메뉴는 멀쩡히 열려 있어야 한다.
        if (!cancelled) setTotal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* 어둡게 덮지 않는다 — 바깥을 눌러 닫기 위한 투명한 막일 뿐이다 */}
      <div className="sidebar-scrim" onClick={onClose} />
      <nav className="sidebar" aria-label="주 메뉴">
        <div className="sidebar-head">
          <span className="sidebar-title">메뉴</span>
          <button className="sidebar-close" onClick={onClose} aria-label="메뉴 닫기">
            ✕
          </button>
        </div>

        <div className="sidebar-stat">
          <div className="sidebar-stat-n">{total === null ? "…" : `${total}권`}</div>
          <div className="sidebar-stat-l">내 서재에 등록된 책</div>
        </div>

        <ul className="sidebar-links">
          {links.map((link) => (
            <li key={link.to}>
              {/* 링크를 누르면 화면이 바뀌므로 메뉴도 같이 닫는다 */}
              <NavLink to={link.to} end={link.end} onClick={onClose}>
                <span className="sidebar-icon" aria-hidden="true">
                  {link.icon}
                </span>
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>

        {user && (
          <div className="sidebar-user">
            <span className="sidebar-username">{user.username}</span>
            <button className="sidebar-logout" onClick={logout}>
              로그아웃
            </button>
          </div>
        )}
      </nav>
    </>
  );
}
