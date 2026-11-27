import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./Install.css";
import { isPersonal, useServerConfig } from "../utils/serverConfig.js";

// 기기별로 설치 방법이 완전히 다르다. 안드로이드는 APK, 아이폰은 PWA(홈 화면에 추가).
// 엉뚱한 안내를 먼저 보여주면 그대로 따라 하다 막히므로, 기기를 먼저 판별한다.
function detectPlatform() {
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  // 아이패드는 최근 iPadOS에서 Mac으로 위장하므로 터치 지원 여부로 한 번 더 본다.
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  return "desktop";
}

// 집 밖에서도 열리는 공개 주소(Cloudflare 터널, 2026-10-11~) — **가족(family) 서버**의 주소.
// 개인 서재 서버(homelibrary.kr)는 이 페이지를 그 서버 주소(location.origin) 기준으로 보여 준다.
const PUBLIC_URL = typeof location !== "undefined" ? location.origin : "";

export default function Install() {
  const [platform, setPlatform] = useState("desktop");
  const [info, setInfo] = useState(null);
  // 이미 앱/홈화면 앱으로 보고 있다면 또 설치할 필요가 없다.
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setStandalone(
      window.matchMedia?.("(display-mode: standalone)").matches ||
        window.navigator.standalone === true
    );
    fetch("/app/app-info.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo)
      .catch(() => {});
  }, []);

  // 개인 서재(homelibrary.kr): 안드로이드 APK는 **가족 서버 주소가 박힌 앱**이라 주면 안 된다.
  // 대신 아이폰처럼 PWA(홈 화면에 추가)로 안내한다 — 크롬에서도 전체화면 앱처럼 뜬다.
  const config = useServerConfig();
  const personal = isPersonal(config);
  const here = typeof location !== "undefined" ? location.host : "";
  const shownHost = personal ? here : PUBLIC_URL.replace("https://", "");

  const androidPwa = (
    <section className="install-card">
      <h2>🤖 안드로이드</h2>
      <p className="install-lead">
        <b>Chrome</b>으로 이 페이지를 열고 <b>홈 화면에 추가</b>하면 아이콘을 눌러 앱처럼 씁니다.
      </p>
      <ol>
        <li><b>Chrome</b>으로 <b>{here}</b>를 엽니다.</li>
        <li>오른쪽 위 <b>⋮ 메뉴</b>를 누릅니다.</li>
        <li><b>홈 화면에 추가</b>(또는 <b>앱 설치</b>)를 누릅니다.</li>
        <li><b>설치</b>/<b>추가</b>를 누르면 끝입니다.</li>
      </ol>
    </section>
  );

  const android = (
    <section className="install-card">
      <h2>🤖 안드로이드</h2>
      <a className="btn install-download" href="/app/HomeLibrary.apk" download>
        앱 내려받기
        {info && <span className="install-meta">v{info.version} · {info.sizeMB}MB · {info.builtOn}</span>}
      </a>
      <ol>
        <li>위 버튼을 누르면 <b>HomeLibrary.apk</b> 파일이 내려받아집니다.</li>
        <li>
          알림을 누르거나 <b>파일 앱 → 다운로드</b>에서 그 파일을 엽니다.
        </li>
        <li>
          “이 출처의 앱 설치”를 물으면 <b>허용</b>해 주세요. 스토어를 거치지 않는 앱이라
          안드로이드가 한 번 확인하는 절차입니다.
        </li>
        <li><b>설치</b>를 누르면 끝입니다.</li>
      </ol>
      <p className="install-note">
        이미 설치돼 있다면 그냥 덮어 설치하면 됩니다. 책 데이터는 서버에 있어 그대로입니다.
        (1.0 → 1.1은 주소가 바뀌어 <b>한 번 다시 로그인</b>해야 합니다)
      </p>
    </section>
  );

  const ios = (
    <section className="install-card">
      <h2>🍎 아이폰 · 아이패드</h2>
      <p className="install-lead">
        아이폰은 앱 파일 설치가 막혀 있어, <b>홈 화면에 추가</b>하는 방식을 씁니다.
        추가하면 아이콘과 전체화면으로 실행되는 건 앱과 똑같습니다.
      </p>
      <ol>
        <li><b>Safari</b>로 이 페이지를 엽니다. (Chrome에서는 메뉴가 다릅니다)</li>
        <li>아래쪽 <b>공유 버튼</b>(네모에 화살표)을 누릅니다.</li>
        <li>목록을 내려 <b>홈 화면에 추가</b>를 누릅니다.</li>
        <li>오른쪽 위 <b>추가</b>를 누르면 끝입니다.</li>
      </ol>
      <p className="install-note">
        추가할 때의 주소가 아이콘에 그대로 박힙니다. 주소창이 <b>{shownHost}</b>인지
        확인하고 추가해 주세요. 예전에 Tailscale 주소(…ts.net)로 추가한 아이콘은 지우고 다시 추가하면 됩니다.
      </p>
    </section>
  );

  return (
    <div className="install-page">
      <h1>📚 Home Library 설치</h1>

      {standalone && (
        <p className="install-already">✓ 이미 앱으로 실행 중입니다. 따로 설치하지 않아도 됩니다.</p>
      )}

      {/* 2026-10-11까지는 여기에 "먼저 Tailscale을 설치해 주세요"가 있었다. 공개 주소가 생겨
          필요 없어졌다 — 오히려 Tailscale VPN이 켜져 있으면 삼성페이·카드결제가 실패한다는 제보가 있었다. */}
      {!personal && (
      <section className="install-card install-prereq">
        <h2>✓ Tailscale은 필요 없습니다</h2>
        <p>
          이제 <b>{PUBLIC_URL.replace("https://", "")}</b> 주소로 집 밖 어디서든 열립니다.
          와이파이든 데이터든 인터넷만 되면 됩니다.
        </p>
        <p className="install-note">
          Tailscale을 서재 때문에 켜 두셨다면 꺼도 됩니다. 처음 한 번은 다시 로그인해야 합니다.
        </p>
      </section>
      )}

      {platform === "ios" ? ios : platform === "android" ? (personal ? androidPwa : android) : (
        <>
          {personal ? androidPwa : android}
          {ios}
        </>
      )}

      <p className="install-back">
        <Link to="/">← 서재로 돌아가기</Link>
      </p>
    </div>
  );
}
