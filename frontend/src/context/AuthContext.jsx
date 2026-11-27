import { createContext, useContext, useEffect, useMemo, useState } from "react";
import * as authApi from "../api/auth";
import { resetAiStatus } from "../utils/serverConfig.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("hl_user");
    return raw ? JSON.parse(raw) : null;
  });

  function persist(token, user) {
    // 다른 계정으로 들어오면 앞사람의 Claude 키 상태가 남지 않게 비운다(personal 모드)
    resetAiStatus();
    localStorage.setItem("hl_token", token);
    localStorage.setItem("hl_user", JSON.stringify(user));
    setUser(user);
  }

  async function login(credentials) {
    const data = await authApi.login(credentials);
    persist(data.access_token, data.user);
    return data.user;
  }

  async function register(payload) {
    const data = await authApi.register(payload);
    persist(data.access_token, data.user);
    return data.user;
  }

  // 저장해 둔 사용자 정보는 로그인한 그 순간의 것이다. 역할(도서관 주인이 바꿀 수 있다)·환영 안내 여부가
  // 바뀌었을 수 있으므로 앱이 뜰 때 한 번 서버에 다시 묻는다.
  useEffect(() => {
    if (!localStorage.getItem("hl_token")) return;
    authApi
      .fetchMe()
      .then((fresh) => {
        localStorage.setItem("hl_user", JSON.stringify(fresh));
        setUser(fresh);
      })
      .catch(() => {}); // 401이면 client.js가 로그아웃시킨다
  }, []);

  /** 환영 안내를 닫았을 때 — 서버에도 적고(다른 기기), 화면 상태도 바로 바꾼다. */
  async function markWelcomeSeen() {
    try {
      await authApi.markWelcomeSeen();
    } catch {
      // 실패해도 이번에는 닫는다. 다음 로그인 때 다시 뜰 뿐이다.
    }
    setUser((u) => {
      const next = u ? { ...u, welcome_seen_at: new Date().toISOString() } : u;
      if (next) localStorage.setItem("hl_user", JSON.stringify(next));
      return next;
    });
  }

  function logout() {
    resetAiStatus();
    localStorage.removeItem("hl_token");
    localStorage.removeItem("hl_user");
    setUser(null);
  }

  const value = useMemo(
    () => ({ user, isAuthenticated: !!user, login, register, logout, markWelcomeSeen }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
