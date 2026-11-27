import client from "./client";

export async function fetchServerConfig() {
  const { data } = await client.get("/auth/config");
  return data;
}

export async function fetchAiKey() {
  const { data } = await client.get("/me/ai-key");
  return data;
}

export async function saveAiKey(apiKey) {
  const { data } = await client.put("/me/ai-key", { api_key: apiKey });
  return data;
}

export async function deleteAiKey() {
  const { data } = await client.delete("/me/ai-key");
  return data;
}

export async function changePassword(currentPassword, newPassword) {
  await client.put("/me/password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
}
