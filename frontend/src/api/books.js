import client from "./client";

export async function listBooks(params) {
  const { data } = await client.get("/books", { params });
  return data;
}

// 통합검색. 홈 목록과 같은 { items, total } 형태를 돌려주므로 페이지네이션·정렬을 그대로 쓸 수 있다.
export async function searchBooks(params) {
  const { data } = await client.get("/books/search", { params });
  return data;
}

// 이미 등록된 같은 책이 있는지 확인한다(중복 구매 방지 — 이 앱의 존재 이유).
// 반환: { isbn_matches: [...], title_matches: [...] }
export async function checkDuplicate({ isbn, title, author, excludeId }) {
  const { data } = await client.get("/books/check-duplicate", {
    params: {
      isbn: isbn || undefined,
      title: title || undefined,
      author: author || undefined,
      exclude_id: excludeId ?? undefined,
    },
  });
  return data;
}

// 책꽂이별 권수. 다중 선택 필터가 고를 거리를 만들기 위해 쓴다.
export async function listShelves() {
  const { data } = await client.get("/books/shelves");
  return data;
}

export async function getBook(id) {
  const { data } = await client.get(`/books/${id}`);
  return data;
}

function toFormData(fields, { coverFile, coverImagePath } = {}) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      form.set(key, value);
    }
  });
  if (coverFile) {
    form.set("cover_image", coverFile);
  }
  if (coverImagePath) {
    form.set("cover_image_path", coverImagePath);
  }
  return form;
}

export async function createBook(fields, opts) {
  const form = toFormData(fields, opts);
  const { data } = await client.post("/books", form);
  return data;
}

export async function updateBook(id, fields, opts) {
  const form = toFormData(fields, opts);
  if (opts?.removeImage) {
    form.set("remove_image", "true");
  }
  const { data } = await client.put(`/books/${id}`, form);
  return data;
}

// 제목/저자로 인터넷에서 표지 후보를 찾는다. 서버가 이미지를 내려받아 임시 저장하므로
// 응답의 image_path는 coverImageUrl()로 바로 미리보기할 수 있다.
// 반환: { candidates: [...], metadata: {...}|null } — metadata는 폼 빈 칸을 채우는 데 쓴다.
export async function fetchCoverCandidates({ title, author, limit }) {
  const { data } = await client.get("/books/cover-candidates", {
    params: { title, author: author || undefined, limit },
  });
  return { candidates: data.candidates, metadata: data.metadata };
}

// ISBN으로 책 정보를 조회한다(새책 추가 시 ISBN만 넣으면 나머지를 채우는 용도).
// 반환: { found, title, author, translator, publisher, pub_year, category, isbn, cover_image_path }
export async function lookupIsbn(isbn) {
  const { data } = await client.get("/books/lookup-isbn", { params: { isbn } });
  return data;
}

// 이미 등록된 중복 책을 묶음으로 찾는다(관리 → 서재 점검).
// 반환: { groups, redundant_count, acknowledged_count }
// includeAcknowledged=true면 "다른 책"으로 표시해 둔 묶음까지 함께 돌려준다.
export async function fetchDuplicates(includeAcknowledged = false) {
  const { data } = await client.get("/books/duplicates", {
    params: { include_acknowledged: includeAcknowledged },
  });
  return data;
}

// 이 묶음은 중복이 아니라고 표시한다(서재 점검과 등록 경고 양쪽에서 빠진다).
export async function acknowledgeDuplicate(reason, key) {
  const { data } = await client.post("/books/duplicates/acknowledge", { reason, key });
  return data;
}

// 지금 중복으로 잡힌 묶음을 전부 "다른 책"으로 표시한다.
export async function acknowledgeAllDuplicates() {
  const { data } = await client.post("/books/duplicates/acknowledge-all");
  return data;
}

// "다른 책" 표시를 되돌려 다시 중복 검사 대상으로 만든다.
export async function unacknowledgeDuplicate(reason, key) {
  const { data } = await client.post("/books/duplicates/unacknowledge", { reason, key });
  return data;
}

// DB에는 표지 경로가 있는데 파일이 없는 책 목록. 반환: { items, total }
export async function fetchBrokenCovers() {
  const { data } = await client.get("/books/broken-covers");
  return data;
}

// 깨진 표지를 인터넷에서 다시 찾아 붙이고, 못 찾으면 '표지 없음'으로 정리한다.
// 반환: { checked, refetched, cleared }
export async function repairCovers() {
  const { data } = await client.post("/books/repair-covers");
  return data;
}

// 어느 책도 쓰지 않는 표지 이미지 현황(지우지 않고 보기만 한다).
// 반환: { orphan_count, orphan_bytes, referenced_count, sample }
export async function fetchUnusedImages() {
  const { data } = await client.get("/books/unused-images");
  return data;
}

// 사용되지 않는 이미지를 지금 정리한다(앱 시작 시 자동 실행되는 것과 같은 작업).
// 반환: { temp_removed, orphan_removed }
export async function purgeUnusedImages() {
  const { data } = await client.post("/books/purge-unused-images");
  return data;
}

// 카테고리별 권수 (많은 순). 반환: [{ name, count }] — name이 null이면 '분류 없음'
export async function fetchCategories() {
  const { data } = await client.get("/books/categories");
  return data;
}

// 카테고리 이름 바꾸기. 이미 있는 이름으로 바꾸면 합쳐진다. toName이 비면 분류를 지운다.
export async function renameCategory(fromName, toName) {
  const { data } = await client.post("/books/categories/rename", {
    from_name: fromName,
    to_name: toName,
  });
  return data;
}

// 고른 책들의 책꽂이 위치를 한꺼번에 지정. 빈 값이면 위치를 지운다.
export async function bulkSetShelf(ids, shelfLocation) {
  const { data } = await client.post("/books/bulk-shelf", {
    ids,
    shelf_location: shelfLocation,
  });
  return data;
}

export async function deleteBook(id) {
  await client.delete(`/books/${id}`);
}

export async function bulkDeleteBooks(ids) {
  await client.delete("/books/bulk", { data: { ids } });
}

export function coverImageUrl(path) {
  if (!path) return null;
  return `/api/images/${path}`;
}
