import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { isPersonal, useServerConfig } from "../utils/serverConfig.js";
import "./WelcomeModal.css";

/**
 * 처음 로그인한 사람에게 한 번 띄우는 환영 안내(사용자 요구, 2026-11-27).
 *
 * 닫으면 서버에 "봤다"를 적는다(users.welcome_seen_at) — 브라우저 저장소에 두면 폰·컴퓨터마다 또 뜬다.
 * 자세한 사용법은 [도움말]로 넘긴다. 여기서는 "무엇부터 하면 되는지" 세 가지만.
 */
export default function WelcomeModal() {
  const { user, markWelcomeSeen } = useAuth();
  const navigate = useNavigate();
  const config = useServerConfig();
  const personal = isPersonal(config);

  if (!user || user.welcome_seen_at || !config.loaded) return null;

  const isOwner = personal && user.library_role === "owner";
  const isViewer = personal && user.library_role === "viewer";

  async function close(goHelp) {
    await markWelcomeSeen();
    if (goHelp) navigate("/help");
  }

  return (
    <div className="welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-card">
        <div className="welcome-emoji" aria-hidden="true">
          📚
        </div>
        <h2 id="welcome-title">{user.username}님, 환영합니다!</h2>
        <p className="welcome-lead">
          Home Library는 집에 있는 책을 휴대폰으로 관리하는 도서관입니다. 서점에서 바코드를 비추면
          <b> 이미 가진 책인지, 어느 책꽂이에 있는지</b> 바로 알려 줍니다.
        </p>

        <ol className="welcome-steps">
          {isViewer ? (
            <>
              <li>
                <b>책 찾기</b> — 위 검색창에 제목·저자를 넣어 보세요.
              </li>
              <li>
                <b>서점에서</b> — 검색창에 제목이나 ISBN(책 뒤표지 바코드 아래 숫자)을 넣으면 이미 있는지 바로
                보입니다. (이 도서관에서는 '보기만' 권한이라 책을 넣거나 고치지는 못합니다)
              </li>
            </>
          ) : (
            <>
              <li>
                <b>책 넣기</b> — ☰ 메뉴 → <b>[바코드 스캔]</b>에서 책 뒤표지의 바코드를 비추면 정보와 표지가
                저절로 채워집니다. 여러 권을 연속으로 찍을 수 있어요.
              </li>
              <li>
                <b>책꽂이 적기</b> — 넣을 때 책꽂이 위치를 적어 두면 나중에 "어디 있지?"가 바로 풀립니다.
              </li>
            </>
          )}
          {isOwner && (
            <li>
              <b>가족·친구와 함께</b> — ☰ 메뉴 → <b>[우리 도서관]</b>에서 멤버를 만들거나 초대 코드를 나눠 주면
              같은 책을 함께 봅니다.
            </li>
          )}
          <li>
            <b>휴대폰 홈 화면에 추가</b>하면 앱처럼 쓸 수 있어요. 방법은 [도움말]에 있습니다.
          </li>
        </ol>

        <p className="welcome-foot">
          궁금한 점이나 바라는 기능은 ☰ 메뉴 → <b>[도움말]</b> → <b>[의견 보내기]</b>로 알려 주세요.
        </p>

        <div className="welcome-actions">
          <button className="btn" type="button" onClick={() => close(true)}>
            사용법 자세히 보기
          </button>
          <button className="btn secondary" type="button" onClick={() => close(false)}>
            바로 시작하기
          </button>
        </div>
      </div>
    </div>
  );
}
