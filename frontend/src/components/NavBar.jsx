import { useState } from "react";
import { NavLink } from "react-router-dom";
import SearchBox from "./SearchBox.jsx";
import Sidebar from "./Sidebar.jsx";
import "./NavBar.css";

/**
 * 상단 바 — **한 줄**: ☰ · 앱 이름 · 검색창 · [검색]. 왼쪽 정렬이라 화면이 넓어져도
 * 자리가 움직이지 않는다. 화면 이동 메뉴와 사용자/로그아웃은 Sidebar에 있다.
 *
 * ## `fixed`가 아니라 `sticky`인 이유 (여기가 핵심)
 *
 * 예전에는 `position: fixed` + **JS로 잰 높이(`--nav-h`)만큼 body에 위쪽 여백**을 주는
 * 구조였다. 이 방식은 잰 값이 한 번만 어긋나면 **헤더가 본문을 덮는다.** 실제로
 * 2026-09-27에 제목과 필터가 상단 바와 겹쳐 보인다는 제보를 받았다.
 *
 * `fixed`를 썼던 이유는 하나뿐이었다 — 폰에서 표가 화면보다 넓어 **페이지가 가로로도**
 * 스크롤되는데, `sticky`는 세로만 잡아 주기 때문이다. 그런데 지금은 폰에서 표 대신
 * **카드 목록**을 쓰므로(BookTable.css) 문서가 가로로 넘치지 않는다. 그 이유가 사라졌다.
 *
 * `sticky`는 문서 흐름 안에 있어 **본문을 덮는 것이 원리적으로 불가능**하고,
 * 높이를 잴 필요도 없다. 그래서 `--nav-h`와 `utils/screenSize.js`를 전부 걷어냈다.
 */
export default function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className="navbar">
        <div className="navbar-inner">
          <button
            className="navbar-toggle"
            onClick={() => setMenuOpen(true)}
            aria-label="메뉴 열기"
            aria-expanded={menuOpen}
          >
            ☰
          </button>
          <NavLink to="/" className="navbar-brand">
            <span className="navbar-logo" aria-hidden="true">📚</span>
            {/* 아주 좁은 화면에서는 글자를 숨기고 아이콘만 남긴다(CSS). 검색창을 같은 줄에
                두려면 자리가 모자라는데, 한 줄 유지가 더 중요하다. */}
            <span className="navbar-brand-text">Home Library</span>
          </NavLink>
          <SearchBox />
        </div>
      </header>
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
