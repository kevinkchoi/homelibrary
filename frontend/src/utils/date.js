// 등록일 표시용. 서버는 UTC(타임존 포함)로 주고, 브라우저가 알아서 현지(한국) 시간으로 보여준다.

/** "2026-09-26" — 목록처럼 좁은 자리에 쓴다. */
export function formatDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-09-26 16:24" — 상세 화면처럼 자리가 있는 곳에 쓴다. */
export function formatDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const p = (n) => String(n).padStart(2, "0");
  return `${formatDate(iso)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
