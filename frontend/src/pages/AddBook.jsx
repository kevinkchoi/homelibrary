import { useNavigate, useLocation, Link } from "react-router-dom";
import { createBook } from "../api/books";
import { useAuth } from "../context/AuthContext.jsx";
import defaultShelfFor from "../utils/defaultShelf.js";
import { isPersonal, useServerConfig } from "../utils/serverConfig.js";
import BookForm from "../components/BookForm.jsx";
import ScanBatchReview from "../components/ScanBatchReview.jsx";
import "./Home.css";

export default function AddBook() {
  const navigate = useNavigate();
  const location = useLocation();
  const scanResults = location.state?.scanResults;
  const { user } = useAuth();
  // 누가 넣느냐에 따라 자기 책꽂이를 미리 채워 준다(바꿀 수 있는 기본값일 뿐이다).
  // ⚠️ 가족(family) 서버에서만. 표가 아이디로 되어 있어, 개인 서재(homelibrary.kr)에
  //    같은 아이디로 가입한 **남**에게 우리 집 책꽂이 이름이 채워지면 안 된다.
  const config = useServerConfig();
  const shelf = isPersonal(config) ? "" : defaultShelfFor(user);

  // 폼의 책꽂이 초기값은 처음 한 번만 정해진다 — 운영 형태를 알기 전에 그리면 안 된다(위 주석).
  if (!config.loaded) return null;

  async function handleSubmit(fields, opts) {
    const created = await createBook(fields, opts);
    navigate("/", { state: { justAdded: created.id } });
  }

  if (scanResults && scanResults.length > 0) {
    return (
      <div className="home-page">
        <div className="home-header">
          <h1>스캔한 책 확인 및 추가</h1>
          <Link to="/scan" className="btn secondary">
            📷 다시 스캔
          </Link>
        </div>
        <ScanBatchReview items={scanResults} defaultShelf={shelf} onAllDone={() => navigate("/")} />
      </div>
    );
  }

  return (
    <div className="home-page">
      <div className="home-header">
        <h1>새책 추가</h1>
        <Link to="/scan" className="btn secondary">
          📷 사진으로 스캔
        </Link>
      </div>

      <div className="card">
        <BookForm
          initialValues={{ shelf_location: shelf }}
          allowCoverSearch
          allowIsbnLookup
          checkDuplicates
          prominentIsbnEntry
          submitLabel="책 추가"
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
