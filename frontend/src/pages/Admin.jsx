import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { isPersonal, useServerConfig } from "../utils/serverConfig.js";
import { canEdit } from "../utils/permissions.js";
import "./Admin.css";

export default function Admin() {
  const { user } = useAuth();
  const personal = isPersonal(useServerConfig());
  const editor = canEdit(user, personal);

  return (
    <div className="admin-page">
      <h1>관리</h1>
      <div className="admin-menu">
        <Link to="/admin/import-export" className="card admin-card">
          <h2>가져오기 / 내보내기</h2>
          <p>Excel/CSV로 책 목록과 표지 이미지를 내보내거나 가져옵니다.</p>
        </Link>
        {editor && (
          <Link to="/admin/manage" className="card admin-card">
            <h2>책 관리</h2>
            <p>책을 개별적으로 또는 여러 권을 한꺼번에 선택하여 삭제합니다.</p>
          </Link>
        )}
        {editor && (
          <Link to="/admin/cleanup" className="card admin-card">
            <h2>서재 점검</h2>
            <p>같은 책이 여러 번 등록됐는지, 표지 이미지가 깨진 책이 있는지 찾아서 정리합니다.</p>
          </Link>
        )}
        {editor && (
          <Link to="/admin/categories" className="card admin-card">
            <h2>카테고리 정리</h2>
            <p>서점마다 다른 분류를 큰 갈래로 합칩니다. 권수가 많은 것부터 정리하면 빨리 줄어듭니다.</p>
          </Link>
        )}
        <Link to="/install" className="card admin-card">
          <h2>앱 설치</h2>
          <p>안드로이드 앱을 내려받거나, 아이폰 홈 화면에 추가하는 방법을 안내합니다.</p>
        </Link>
        {editor && (
          <Link to="/add" className="card admin-card">
            <h2>새책 추가</h2>
            <p>새로운 책을 직접 입력하거나 사진으로 스캔하여 추가합니다.</p>
          </Link>
        )}
        {personal && (
          <Link to="/library" className="card admin-card">
            <h2>우리 도서관</h2>
            <p>가족·친구를 멤버로 넣어 같은 책을 함께 봅니다. 멤버 권한과 초대 코드를 관리합니다.</p>
          </Link>
        )}
        <Link to="/help" className="card admin-card">
          <h2>도움말 · 의견 보내기</h2>
          <p>사용법을 자세히 보고, 불편한 점이나 바라는 기능을 운영자에게 알립니다.</p>
        </Link>
        {user?.is_admin && personal && (
          <Link to="/admin/site" className="card admin-card admin-card-operator">
            <h2>도서관 관리 (운영자)</h2>
            <p>모든 도서관의 현황, 암호화 백업·복구, 말썽 사용자·도서관 삭제. 개인정보·책 내용은 보이지 않습니다.</p>
          </Link>
        )}
        {user?.is_admin && (
          <Link to="/admin/feedback" className="card admin-card admin-card-operator">
            <h2>의견함 (운영자)</h2>
            <p>사용자가 보낸 의견을 보고 상태와 답을 남깁니다.</p>
          </Link>
        )}
        {user?.is_admin && !personal && (
          <Link to="/admin/users" className="card admin-card">
            <h2>사용자 관리</h2>
            <p>같은 책 목록을 공유할 가족/구성원 계정을 확인하고 관리자 권한을 부여하거나 삭제합니다.</p>
          </Link>
        )}
      </div>
    </div>
  );
}
