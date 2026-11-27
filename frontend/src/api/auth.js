import client from "./client";

export async function register({ username, email, password, inviteCode }) {
  const { data } = await client.post("/auth/register", {
    username,
    email,
    password,
    invite_code: inviteCode || null,
  });
  return data;
}

export async function login({ username, password }) {
  const form = new URLSearchParams();
  form.set("username", username);
  form.set("password", password);
  const { data } = await client.post("/auth/login", form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return data;
}

export async function fetchMe() {
  const { data } = await client.get("/auth/me");
  return data;
}

export async function markWelcomeSeen() {
  await client.put("/me/welcome-seen");
}
