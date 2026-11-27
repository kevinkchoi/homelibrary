import { useEffect } from "react";
import { beginBusy } from "../utils/appBusy.js";

/**
 * `active`인 동안 "입력 중"으로 표시한다(그동안에는 새 버전이 조용히 반영되지 않는다).
 *
 * 화면이 사라질 때 반드시 내려가야 하므로 정리 함수에서 풀어 준다 — 안 그러면 한 번
 * 올라간 바쁨이 영원히 남아 **다시는 자동 갱신이 되지 않는다.**
 */
export default function useBusyWhile(active) {
  useEffect(() => {
    if (!active) return undefined;
    const done = beginBusy();
    return done;
  }, [active]);
}
