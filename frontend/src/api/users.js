import client from "./client";

export async function listUsers() {
  const { data } = await client.get("/users");
  return data;
}

export async function deleteUser(id) {
  await client.delete(`/users/${id}`);
}

export async function setAdmin(id, isAdmin) {
  const { data } = await client.put(`/users/${id}/admin`, { is_admin: isAdmin });
  return data;
}

export async function createUser({ username, email, password }) {
  const { data } = await client.post("/users", { username, email, password });
  return data;
}

export async function resetPassword(id, password) {
  await client.put(`/users/${id}/password`, { password });
}
