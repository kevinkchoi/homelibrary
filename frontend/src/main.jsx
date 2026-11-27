import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import UpdatePrompt from "./components/UpdatePrompt.jsx";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
      {/* 새 버전 알림 + 현재 버전 표시. 로그인 여부와 무관하게 항상 동작해야 하므로
          라우터 안, AuthProvider 밖에 둔다. */}
      <UpdatePrompt />
    </BrowserRouter>
  </React.StrictMode>
);
