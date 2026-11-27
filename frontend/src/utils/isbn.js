// ISBN 검증 — 백엔드 `booklookup_service.normalize_isbn/is_valid_isbn`과 같은 규칙을 프론트에도 둔다.
// 바코드 스캐너가 잘못 읽은 값을 서버까지 보내기 전에 걸러내기 위함이다.

export function normalizeIsbn(raw) {
  return (raw || "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

function isbn13ChecksumOk(isbn) {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === Number(isbn[12]);
}

function isbn10ChecksumOk(isbn) {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(isbn[i]) * (10 - i);
  }
  sum += isbn[9] === "X" ? 10 : Number(isbn[9]);
  return sum % 11 === 0;
}

export function isValidIsbn(raw) {
  const isbn = normalizeIsbn(raw);
  return isbn13ChecksumOk(isbn) || isbn10ChecksumOk(isbn);
}

/**
 * 스캔한 바코드가 **책** 바코드인지 확인한다.
 *
 * 체크섬만 보면 부족하다 — 과자 봉지의 EAN-13도 체크섬은 통과하기 때문이다.
 * 도서 바코드는 GS1 접두사 `978`(Bookland) 또는 `979`를 쓰므로 그 조건을 함께 건다.
 * (`9790`은 악보용 ISMN이지만 실제로 책과 함께 꽂혀 있는 경우가 있어 굳이 막지 않는다)
 */
export function isBookBarcode(raw) {
  const isbn = normalizeIsbn(raw);
  if (!/^97[89]\d{10}$/.test(isbn)) return false;
  return isbn13ChecksumOk(isbn);
}
