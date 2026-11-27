/**
 * "지금 사용자가 무언가를 입력·처리하는 중인가"를 앱 전체가 공유하는 자리.
 *
 * **무엇에 쓰는가**: 새 버전이 나왔을 때 조용히 갱신할지(= 새로고침) 물어볼지를 가른다.
 * 목록을 보고 있을 때 새로고침되는 것은 아무 손해가 없지만, 책을 입력하던 중이라면
 * **쓰던 내용이 통째로 날아간다.** 그 둘을 구분하지 못해 지금까지는 무조건 물어봤고,
 * 그래서 사용자가 배너를 누르지 않으면 **폰이 계속 옛 버전에 머물렀다**
 * (2026-09-27에 "서평이 3줄로 안 접힌다"는 제보의 진짜 원인이었다).
 *
 * 세는 방식이 불리언이 아니라 **카운터**인 이유: 입력 화면 위에 또 다른 입력 화면이
 * 뜰 수 있다(예: 수정 폼 위의 바코드 스캐너). 안쪽이 닫혔다고 바깥까지 한가한 것으로
 * 잘못 판단하면 안 된다.
 */

let count = 0;
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => fn(count > 0));
}

export function isAppBusy() {
  return count > 0;
}

/** 바쁨 하나를 올린다. 돌려받은 함수를 부르면 내려간다(두 번 불러도 안전). */
export function beginBusy() {
  count += 1;
  notify();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    count = Math.max(0, count - 1);
    notify();
  };
}

export function subscribeBusy(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
