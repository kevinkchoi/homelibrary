import client from "./client";

export async function getRecommendations() {
  const { data } = await client.get("/recommendations");
  return data;
}

export async function refreshRecommendations() {
  // 알라딘 여러 번 + Claude 한 번이라 수 초 걸린다. 기본 타임아웃으로는 끊긴다.
  const { data } = await client.post("/recommendations/refresh", null, { timeout: 180000 });
  return data;
}
