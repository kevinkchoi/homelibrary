import axios from "axios";

const client = axios.create({
  baseURL: "/api",
  // 배열을 `shelf=A&shelf=B` 로 보낸다. axios 기본값은 `shelf[]=A&shelf[]=B` 인데
  // FastAPI의 `list[str] = Query(None)` 은 **대괄호 없는 반복 키**를 읽는다.
  // 이걸 안 맞추면 필터를 걸어도 서버가 조용히 무시해 **전체가 돌아온다**(원인을 찾기 어렵다).
  paramsSerializer: { indexes: null },
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("hl_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem("hl_token");
      localStorage.removeItem("hl_user");
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default client;
