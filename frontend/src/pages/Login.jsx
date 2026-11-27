import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { describeApiError } from "../utils/apiError.js";
import { useServerConfig } from "../utils/serverConfig.js";
import "./Login.css";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const config = useServerConfig();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login({ username, password });
      navigate("/");
    } catch (err) {
      // 연결 문제와 아이디·비밀번호 오류를 구분해서 알려준다(서로 대처법이 다르다)
      setError(describeApiError(err, "로그인에 실패했습니다."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card card" onSubmit={handleSubmit}>
        <h1>Home Library 로그인</h1>
        {error && <p className="auth-error">{error}</p>}
        <label>
          아이디
          {/* iOS는 텍스트 입력의 첫 글자를 자동으로 대문자로 바꾼다("alice" → "Alice").
              아이디는 대소문자를 구분하므로 그대로 두면 휴대폰에서만 로그인이 실패한다. */}
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            required
          />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button className="btn" type="submit" disabled={loading}>
          로그인
        </button>
        {/* family(가족 공용): 공개 가입은 닫혀 있다(2026-10-11). 계정은 관리자가 [사용자 관리]에서 만든다.
            personal(homelibrary.kr): 초대 코드가 있으면 스스로 가입한다. */}
        {config.signup_enabled ? (
          <p className="auth-switch">
            처음이신가요? <Link to="/register">초대 코드로 가입하기</Link>
          </p>
        ) : (
          <p className="auth-switch">계정은 관리자에게 요청해주세요.</p>
        )}
        <p className="auth-switch">
          휴대폰에서 쓰시려면 <Link to="/install">앱 설치 안내</Link>
        </p>
      </form>
    </div>
  );
}
