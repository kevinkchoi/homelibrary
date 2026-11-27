/**
 * 새 책을 넣을 때 **책꽂이 위치를 미리 채워 주기 위한** 값.
 *
 * 집에서 쓰는 앱이고 책을 넣는 사람이 둘뿐인데, 둘 다 자기 책은 늘 같은 자리에 꽂는다
 * (가족 공용(family) 서버에서만 쓰인다 — 개인 서재(personal) 서버에서는 늘 빈칸).
 * 그래서 로그인한 사람에 따라 자주 쓰는 자리를 **기본값으로만** 채운다 — 화면에서 얼마든지
 * 바꿀 수 있으므로 강제가 아니다.
 *
 * ⚠️ 사용자 계정이 늘면 이 표에 한 줄 더하면 된다. 여기에 없는 사용자는 빈칸으로 두어
 *    (엉뚱한 자리를 미리 넣어 두는 것보다) 직접 고르게 한다.
 *
 * 서버가 아니라 화면에 둔 이유: 이걸 DB에 두려면 users 테이블에 칸을 더하고 마이그레이션을
 * 해야 하는데, 값이 둘뿐이고 바뀔 일이 드물어 그만한 값을 하지 못한다. 대신 **여기 한 곳만**
 * 보면 되도록 모아 두었다.
 */
const DEFAULT_SHELF_BY_USERNAME = {
  // 예: alice: "거실 책장",
};

export default function defaultShelfFor(user) {
  const name = (user?.username || "").trim().toLowerCase();
  return DEFAULT_SHELF_BY_USERNAME[name] || "";
}
