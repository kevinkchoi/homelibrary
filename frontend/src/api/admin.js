import client from "./client";

// 운영자 전용 — 도서관 목록(개인정보 없음), 도서관 삭제, 암호화 백업·복구, 의견함
export async function adminLibraries() {
  const { data } = await client.get("/admin/libraries");
  return data;
}
export async function adminDeleteLibrary(id) {
  await client.delete(`/admin/libraries/${id}`);
}
export async function adminDeleteUser(id) {
  await client.delete(`/users/${id}`);
}
/** 암호화된 백업 파일을 내려받는다. 파일 이름과 요약(도서관·사용자·책 수)을 돌려준다. */
export async function adminDownloadBackup(libraryId) {
  const res = await client.get("/admin/backup", {
    params: libraryId ? { library_id: libraryId } : {},
    responseType: "blob",
  });
  const disposition = res.headers["content-disposition"] || "";
  const name = (disposition.match(/filename="([^"]+)"/) || [])[1] || "homelibrary.hlbak";
  const [libs, users, books] = (res.headers["x-backup-summary"] || "0,0,0").split(",").map(Number);
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { name, libs, users, books };
}
export async function adminRestore(file) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await client.post("/admin/restore", form, { timeout: 300000 });
  return data;
}
export async function adminFeedback(status) {
  const { data } = await client.get("/admin/feedback", { params: status ? { status } : {} });
  return data;
}
export async function adminUpdateFeedback(id, patch) {
  const { data } = await client.put(`/admin/feedback/${id}`, patch);
  return data;
}
