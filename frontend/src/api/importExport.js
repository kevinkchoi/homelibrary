import client from "./client";

async function downloadFile(path, filename) {
  const { data } = await client.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportExcel() {
  return downloadFile("/export/excel", "homelibrary_export_excel.zip");
}

export function exportCsv() {
  return downloadFile("/export/csv", "homelibrary_export_csv.zip");
}

// 표지 없이 목록만 — 일괄 편집용. 표지를 넣으면 845권에 150MB라 엑셀에서 열기 힘들다.
export function exportExcelList() {
  return downloadFile("/export/excel/list", "homelibrary_list.xlsx");
}

export function exportCsvList() {
  return downloadFile("/export/csv/list", "homelibrary_list.csv");
}

export async function importExcel(file) {
  const form = new FormData();
  form.set("file", file);
  const { data } = await client.post("/import/excel", form);
  return data;
}

export async function importCsv(file) {
  const form = new FormData();
  form.set("file", file);
  const { data } = await client.post("/import/csv", form);
  return data;
}
