/**
 * axios 오류를 사용자가 행동할 수 있는 문구로 바꾼다.
 *
 * 왜 필요한가: 서버 응답이 아예 없을 때(네트워크 단절)도 "로그인에 실패했습니다"라고만 떠서,
 * 비밀번호가 틀린 건지 연결이 안 되는 건지 알 수 없었다. 실제로 아이폰이 Tailscale에서
 * 끊겨 있었는데 비밀번호를 의심하느라 시간을 썼다.
 *
 * 핵심 구분: `err.response`가 있으면 서버가 답한 것(인증 실패 등),
 * 없으면 요청이 서버에 닿지 못한 것(연결 문제).
 */
export function describeApiError(err, fallback = "요청을 처리하지 못했습니다.") {
  const status = err?.response?.status;

  // 5xx는 "서버 쪽 문제"다. 아이디·비밀번호 문제가 아닌데 그렇게 보이면 안 된다.
  // 실제로 배포 중에는 API 컨테이너가 재시작하는 동안 nginx가 502를 돌려준다.
  if (status >= 500) {
    return "서버가 응답하지 않습니다. 잠시 후(약 1분) 다시 시도해주세요.";
  }

  // nginx의 로그인 횟수 제한(nginx.conf limit_req). 본문이 nginx HTML이라 detail이 없다 —
  // 그대로 두면 "로그인에 실패했습니다"로만 보여 비밀번호를 의심하게 된다.
  if (status === 429) {
    return "시도가 너무 많습니다. 1분쯤 기다린 뒤 다시 해주세요.";
  }

  // 그 밖에 서버가 응답한 경우 — 서버가 준 설명을 그대로 보여준다(인증 실패 등)
  if (err?.response) {
    return err.response.data?.detail || fallback;
  }

  // 여기부터는 응답 자체가 없는 경우 = 서버에 닿지 못했다
  if (err?.code === "ECONNABORTED") {
    return "서버 응답이 너무 느립니다. 잠시 후 다시 시도해주세요.";
  }

  const onTailscale = typeof location !== "undefined" && location.hostname.endsWith(".ts.net");
  if (onTailscale) {
    return "서버에 연결할 수 없습니다. 휴대폰의 Tailscale 앱이 연결되어 있는지 확인해주세요.";
  }
  // 인터넷 공개 주소(예: homelibrary.kr)는 Tailscale이 필요 없다.
  // LAN 주소(사설 IP·localhost)일 때만 같은 WiFi/Tailscale을 안내한다.
  const host = typeof location !== "undefined" ? location.hostname : "";
  const onLan = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const onPublicDomain = !!host && !onLan;
  if (onPublicDomain) {
    return "서버에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.";
  }
  return "서버에 연결할 수 없습니다. 네트워크(같은 WiFi 또는 Tailscale) 연결을 확인해주세요.";
}
