import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { describeApiError } from "../utils/apiError.js";
import { isPersonal, useServerConfig } from "../utils/serverConfig.js";
import "./Login.css";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", email: "", password: "", inviteCode: "" });
  // personal(homelibrary.kr): 초대 코드 필수, 이메일 선택. family(가족 공용): 첫 계정을 만들 때만 쓰이고 이메일 필수.
  const config = useServerConfig();
  const personal = isPersonal(config);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(form);
      navigate("/");
    } catch (err) {
      setError(describeApiError(err, "회원가입에 실패했습니다."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card card" onSubmit={handleSubmit}>
        <h1>Home Library 계정 만들기</h1>
        {personal && (
          <p className="auth-lead">
            나만의 서재가 새로 만들어집니다. 다른 사람의 책은 보이지 않고, 내 책도 다른 사람에게 보이지 않습니다.
          </p>
        )}
        {error && <p className="auth-error">{error}</p>}
        {config.signup_requires_invite && (
          <label>
            초대 코드
            <input
              value={form.inviteCode}
              onChange={(e) => update("inviteCode", e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              required
            />
          </label>
        )}
        <label>
          아이디
          {/* 휴대폰 키보드의 자동 대문자/자동수정을 끈다 — 아이디는 대소문자를 구분하므로
              "alice"가 "Alice"로 만들어지면 이후 로그인에서 계속 헷갈린다. */}
          <input
            value={form.username}
            onChange={(e) => update("username", e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            minLength={3}
            required
          />
        </label>
        <label>
          {personal ? "이메일 (선택)" : "이메일"}
          <input
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="email"
            required={!personal}
          />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            value={form.password}
            onChange={(e) => update("password", e.target.value)}
            minLength={6}
            autoComplete="new-password"
            required
          />
        </label>
        {personal && (
          <p className="auth-note">
            비밀번호를 잊으면 운영자에게 재설정을 요청해야 합니다(아직 메일로 찾는 기능이 없습니다).
          </p>
        )}
        <button className="btn" type="submit" disabled={loading}>
          회원가입
        </button>
        <p className="auth-switch">
          이미 계정이 있으신가요? <Link to="/login">로그인</Link>
        </p>
      </form>
    </div>
  );
}
