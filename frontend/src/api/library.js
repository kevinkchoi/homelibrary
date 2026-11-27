import client from "./client";

// [우리 도서관] — personal 모드에서 도서관 정보·멤버 관리
export async function fetchLibrary() {
  const { data } = await client.get("/library");
  return data;
}
export async function renameLibrary(name) {
  const { data } = await client.put("/library", { name });
  return data;
}
export async function createMember({ username, password, email, role }) {
  const { data } = await client.post("/library/members", { username, password, email, role });
  return data;
}
export async function setMemberRole(id, role) {
  const { data } = await client.put(`/library/members/${id}/role`, { role });
  return data;
}
export async function resetMemberPassword(id, password) {
  await client.put(`/library/members/${id}/password`, { password });
}
export async function removeMember(id) {
  const { data } = await client.delete(`/library/members/${id}`);
  return data;
}
export async function makeInviteCode(role) {
  const { data } = await client.post("/library/invite-code", { role });
  return data;
}
export async function disableInviteCode() {
  const { data } = await client.delete("/library/invite-code");
  return data;
}
