import client from "./client";

export async function extractFromPhoto(blob) {
  const form = new FormData();
  // 실제 파일명을 그대로 보낸다(HEIC를 cover.jpg로 위장하면 서버 로그에서 원인 파악이 어려움).
  // 카메라 촬영 blob처럼 이름이 없을 때만 기본값 사용.
  form.set("photo", blob, blob.name || "cover.jpg");
  const { data } = await client.post("/scan/extract", form);
  return data;
}
