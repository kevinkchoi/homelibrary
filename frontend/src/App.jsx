import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import NavBar from "./components/NavBar.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Home from "./pages/Home.jsx";
import BookSearch from "./pages/BookSearch.jsx";
import AddBook from "./pages/AddBook.jsx";
import Admin from "./pages/Admin.jsx";
import AdminManageBooks from "./pages/AdminManageBooks.jsx";
import AdminImportExport from "./pages/AdminImportExport.jsx";
import AdminCleanup from "./pages/AdminCleanup.jsx";
import AdminCategories from "./pages/AdminCategories.jsx";
import AdminUsers from "./pages/AdminUsers.jsx";
import Scan from "./pages/Scan.jsx";
import Recommend from "./pages/Recommend.jsx";
import BookReview from "./pages/BookReview.jsx";
import Install from "./pages/Install.jsx";
import Settings from "./pages/Settings.jsx";
import Help from "./pages/Help.jsx";
import Library from "./pages/Library.jsx";
import AdminSite from "./pages/AdminSite.jsx";
import AdminFeedback from "./pages/AdminFeedback.jsx";
import WelcomeModal from "./components/WelcomeModal.jsx";

// wide: 책 목록처럼 **표**가 나오는 화면. 화면 폭을 다 써야 열이 안 눌린다.
// 폼이나 안내 글은 좁게 두는 편이 읽기 좋아 기본은 1100px 그대로다.
function ProtectedLayout({ children, wide = false }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return (
    <>
      <NavBar />
      <main className={"container" + (wide ? " container-wide" : "")}>{children}</main>
      {/* 처음 로그인한 사람에게 한 번 — 닫으면 서버에 적혀 다른 기기에서도 다시 안 뜬다 */}
      <WelcomeModal />
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      {/* 설치 안내는 **로그인 없이** 볼 수 있어야 한다 — 가족에게 링크만 보내면 되도록.
          APK에는 비밀이 들어 있지 않다(서버 주소뿐이고 그건 이미 알고 접속하는 주소다). */}
      <Route
        path="/install"
        element={
          <main className="container">
            <Install />
          </main>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedLayout wide>
            <Home />
          </ProtectedLayout>
        }
      />
      <Route
        path="/search"
        element={
          <ProtectedLayout wide>
            <BookSearch />
          </ProtectedLayout>
        }
      />
      <Route
        path="/add"
        element={
          <ProtectedLayout>
            <AddBook />
          </ProtectedLayout>
        }
      />
      <Route
        path="/recommend"
        element={
          <ProtectedLayout wide>
            <Recommend />
          </ProtectedLayout>
        }
      />
      <Route
        path="/books/:id/review"
        element={
          <ProtectedLayout>
            <BookReview />
          </ProtectedLayout>
        }
      />
      <Route
        path="/scan"
        element={
          <ProtectedLayout>
            <Scan />
          </ProtectedLayout>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedLayout>
            <Admin />
          </ProtectedLayout>
        }
      />
      <Route
        path="/admin/manage"
        element={
          <ProtectedLayout wide>
            <AdminManageBooks />
          </ProtectedLayout>
        }
      />
      <Route
        path="/admin/import-export"
        element={
          <ProtectedLayout>
            <AdminImportExport />
          </ProtectedLayout>
        }
      />
      <Route
        path="/admin/cleanup"
        element={
          <ProtectedLayout>
            <AdminCleanup />
          </ProtectedLayout>
        }
      />
      <Route
        path="/admin/categories"
        element={
          <ProtectedLayout>
            <AdminCategories />
          </ProtectedLayout>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedLayout>
            <AdminUsers />
          </ProtectedLayout>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedLayout>
            <Settings />
          </ProtectedLayout>
        }
      />
      <Route
        path="/help"
        element={
          <ProtectedLayout>
            <Help />
          </ProtectedLayout>
        }
      />
      <Route
        path="/library"
        element={
          <ProtectedLayout>
            <Library />
          </ProtectedLayout>
        }
      />
      <Route
        path="/admin/site"
        element={
          <ProtectedLayout>
            <AdminSite />
          </ProtectedLayout>
        }
      />
      <Route
        path="/admin/feedback"
        element={
          <ProtectedLayout>
            <AdminFeedback />
          </ProtectedLayout>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
