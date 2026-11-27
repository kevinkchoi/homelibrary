import { createContext, useContext, useMemo, useState } from "react";
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

  function logout() {
    resetAiStatus();
    localStorage.removeItem("hl_token");
    localStorage.removeItem("hl_user");
    setUser(null);
  }

  const value = useMemo(
    () => ({ user, isAuthenticated: !!user, login, register, logout }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
