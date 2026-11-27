import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { BUILD_ID } from "../buildInfo.js";
import { isAppBusy, subscribeBusy } from "../utils/appBusy.js";
import "./UpdatePrompt.css";

// 오래 켜둔 PWA도 새 버전을 알아채도록 주기적으로 확인한다.
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30분
// 배너를 띄워 두는 시간. 더 길면 입력칸을 가리고, 더 짧으면 읽을 틈이 없다.
const BANNER_VISIBLE_MS = 12 * 1000;

/**
 * 새 버전 반영 + 현재 버전 표시.
 *
 * **왜 이게 필요한가**: vite-plugin-pwa가 자동 생성하는 registerSW.js는 서비스워커를
 * **등록만** 하고 갱신 확인/반영을 하지 않는다. 그래서 아이폰 홈화면 앱이 몇 주씩 옛 버전에
 * 머물렀다. 여기서 직접 확인·반영한다.
 *
 * ## 언제 조용히 갱신하고 언제 물어보는가 (2026-09-27 개편)
 *
 * 예전에는 **무조건 배너로 물어봤다.** 입력하던 내용을 새로고침으로 날리지 않으려는
 * 것이었는데, 대가로 **사용자가 배너를 누르지 않으면 폰이 계속 옛 버전에 머물렀다.**
 * 실제로 "고친 것이 폰에서 안 보인다"가 하루에 두 번 났다.
 *
 * 그래서 둘로 나눴다:
 *
 * - **입력 중이면**(`appBusy`: 책 입력 폼·바코드 스캔·서평 쓰기·가져오기)
 *   → 예전처럼 **배너로 묻는다.** 쓰던 것을 날릴 수는 없다.
 * - **그냥 보고 있으면** → 조용히 반영한다. 다만 **보고 있는 화면을 갑자기 새로고침하지는
 *   않는다**(스크롤 위치와 필터가 날아가면 그것대로 성가시다). 대신
 *   - **화면을 옮길 때** 그 이동과 함께 새로고침한다 — 어차피 화면이 바뀌는 순간이라
 *     사용자가 잃는 것이 없다.
 *   - **앱을 덮거나 다른 앱으로 갈 때** 새 워커만 활성화해 둔다. 다음에 열면 새 버전이다.
 *     (폰에서 가장 흔한 경로 — 보다가 그냥 덮는다)
 */
export default function UpdatePrompt() {
  // 새 버전이 받아져 반영을 기다리는 중인지
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(() => isAppBusy());
  // 배너를 [나중에]로 닫았는지 — 닫아도 "조용히 반영" 경로는 그대로 살아 있다
  const [dismissed, setDismissed] = useState(false);

  const location = useLocation();
  const updateRef = useRef(null);
  const appliedRef = useRef(false);
  // 새 버전을 알아챈 시점의 **history 항목 키**. 여기서 **한 번이라도 옮겼을 때** 반영한다
  // (이 값이 없으면 알아챈 즉시 보고 있던 화면을 새로고침해 버린다).
  //
  // ⚠️ 경로(pathname)로 비교하면 안 된다. `홈 → 새책 추가 → 홈`처럼 **제자리로 돌아오면
  //    경로가 같아져** 반영이 영영 걸리지 않는다(실제로 그래서 안 됐다).
  //    react-router는 이동할 때마다 새 `key`를 주므로 "옮겼는가"를 정확히 알 수 있다.
  const pendingAtRef = useRef(null);

  useEffect(() => {
    const update = registerSW({
      immediate: true,
      onNeedRefresh() {
        setPending(true);
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        // 앱을 계속 열어두면 load 이벤트가 다시 오지 않으므로 주기적으로 직접 확인한다.
        setInterval(() => {
          registration.update().catch(() => {});
        }, UPDATE_CHECK_INTERVAL_MS);
      },
    });
    updateRef.current = update;
  }, []);

  useEffect(() => subscribeBusy(setBusy), []);

  // 새 버전을 알아챈 순간의 history 항목을 기억해 둔다.
  useEffect(() => {
    if (pending && pendingAtRef.current === null) {
      pendingAtRef.current = location.key;
    }
  }, [pending, location]);

  /**
   * @param reload true면 새로고침까지, false면 **새 워커만 활성화**한다.
   *   화면을 덮은 상태에서 새로고침을 걸면 브라우저가 미루거나 조용히 무시할 수 있어,
   *   그때는 활성화만 해 두고 다음 열람이 새 버전을 받게 한다.
   */
  function apply(reload) {
    if (appliedRef.current) return;
    appliedRef.current = true;
    updateRef.current?.(reload);
  }

  // (1) 화면을 옮길 때 — 그 이동과 함께 반영한다.
  //
  // ⚠️ 여기서는 `busy` **상태 변수를 보면 안 된다.** 상태는 한 렌더 늦으므로,
  //    입력 폼으로 들어가는 그 순간에는 아직 false다. 그대로 두면 폼이 뜨자마자
  //    새로고침되어 **가장 하면 안 되는 때에 화면을 날린다.**
  //    등록부의 **현재 값**(`isAppBusy()`)을 직접 읽는다.
  useEffect(() => {
    if (!pending || isAppBusy()) return;
    if (pendingAtRef.current !== null && location.key !== pendingAtRef.current) {
      apply(true);
    }
  }, [pending, busy, location]);

  // (2) 앱을 덮거나 다른 앱으로 갈 때 — 다음에 열면 새 버전이 되도록 활성화만 해 둔다.
  useEffect(() => {
    if (!pending || busy) return undefined;
    function onVisibility() {
      // 여기서도 상태가 아니라 현재 값을 본다(위와 같은 이유).
      if (document.visibilityState === "hidden" && !isAppBusy()) apply(false);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pending, busy]);

  // 배너는 **입력 중일 때만** 뜬다. 그 외에는 위 두 경로로 조용히 반영된다.
  const showBanner = pending && busy && !dismissed;

  // 잠깐 알리고 스스로 접힌다. 입력 중에만 뜨는 배너라 화면 아래에 계속 떠 있으면
  // **입력칸을 가려 글을 쓸 수 없다**(실제로 새책 추가 폼의 출판사 칸을 덮었다).
  // 놓쳐도 괜찮다 — 폼에서 빠져나오는 순간 조용히 반영되기 때문이다.
  useEffect(() => {
    if (!showBanner) return undefined;
    const t = setTimeout(() => setDismissed(true), BANNER_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [showBanner]);

  if (!showBanner) {
    // 평소에는 현재 버전만 아주 작게 보여준다 — "지금 어느 버전을 보고 있나"를
    // 확인할 수 있어야 캐시 문제를 즉시 판별할 수 있다(이것 때문에 두 번 헤맸다).
    return <span className="build-badge" title={`빌드 ${BUILD_ID}`}>v{BUILD_ID}</span>;
  }

  return (
    <div className="update-prompt" role="status">
      <span>새 버전 — 저장 후 갱신</span>
      <button type="button" className="btn" onClick={() => apply(true)}>
        지금 갱신
      </button>
      <button type="button" className="btn secondary" onClick={() => setDismissed(true)}>
        나중에
      </button>
    </div>
  );
}
