import client from "./client";

export async function sendFeedback(category, body) {
  const { data } = await client.post("/feedback", { category, body });
  return data;
}
export async function myFeedback() {
  const { data } = await client.get("/feedback/mine");
  return data;
}
