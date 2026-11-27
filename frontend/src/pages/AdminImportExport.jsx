import { useRef, useState } from "react";
import useBusyWhile from "../hooks/useBusyWhile.js";
import {
  exportExcel,
  exportCsv,
  exportExcelList,
  exportCsvList,
  importExcel,
  importCsv,
} from "../api/importExport";
import "./AdminImportExport.css";

// 서버는 {created, updated}를 준다. "몇 권이 새로 들어왔고 몇 권이 고쳐졌는지"를
// 정확히 알려줘야 일괄 수정이 의도대로 됐는지 사용자가 확인할 수 있다.
function describeImport(result) {
  const created = result?.created ?? 0;
  const updated = result?.updated ?? 0;
  if (created && updated) return `${updated}권을 수정하고 ${created}권을 새로 추가했습니다.`;
  if (updated) return `${updated}권을 수정했습니다.`;
  if (created) return `${created}권을 새로 추가했습니다.`;
  return "변경된 책이 없습니다. (제목·저자·출판사가 비어 있는 줄은 건너뜁니다)";
}

export default function AdminImportExport() {
  const [busy, setBusy] = useState(false);
  // 파일을 올리거나 받는 중에 새로고침되면 그 작업이 끊긴다.
  useBusyWhile(busy);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const excelInputRef = useRef(null);
  const csvInputRef = useRef(null);

  async function run(action) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err.response?.data?.detail || "작업 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportExcel(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await run(async () => {
      const result = await importExcel(file);
      setMessage(describeImport(result));
    });
    e.target.value = "";
  }

  async function handleImportCsv(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await run(async () => {
      const result = await importCsv(file);
      setMessage(describeImport(result));
    });
    e.target.value = "";
  }

  return (
    <div className="import-export-page">
      <h1>가져오기 / 내보내기</h1>

      {message && <p className="ie-message success">{message}</p>}
      {error && <p className="ie-message error">{error}</p>}

      <div className="ie-grid">
        {/* 일괄 편집이 주 용도라 목록만 내보내기를 위에, 크게 뒀다.
            표지까지 담으면 845권에 150MB라 엑셀에서 열기도 힘들다. */}
        <section className="card">
          <h2>목록만 내보내기 (일괄 수정용)</h2>
          <p>
            표지 없이 책 목록만 내려받습니다(가볍습니다). 엑셀에서 <b>책꽂이 위치</b>나
            <b> 카테고리</b>를 채운 뒤 아래 [가져오기]로 올리면 <b>기존 책이 수정</b>됩니다.
            <br />
            <b>⚠️ 맨 앞의 “번호” 열은 지우지 마세요.</b> 어느 책을 고칠지 찾는 열쇠입니다
            (지우면 새 책으로 추가됩니다).
          </p>
          <div className="ie-actions">
            <button className="btn" disabled={busy} onClick={() => run(exportExcelList)}>
              목록만 엑셀로
            </button>
            <button className="btn" disabled={busy} onClick={() => run(exportCsvList)}>
              목록만 CSV로
            </button>
          </div>
        </section>

        <section className="card">
          <h2>전체 내보내기 (표지 포함)</h2>
          <p>
            책 목록과 표지 이미지를 zip으로 내려받습니다. 백업·이사용입니다.
            표지가 들어가 파일이 큽니다(엑셀 약 150MB).
          </p>
          <div className="ie-actions">
            <button className="btn secondary" disabled={busy} onClick={() => run(exportExcel)}>
              Export to Excel
            </button>
            <button className="btn secondary" disabled={busy} onClick={() => run(exportCsv)}>
              Export to CSV
            </button>
          </div>
        </section>

        <section className="card">
          <h2>가져오기</h2>
          <p>
            내보내기로 받은 파일을 올립니다. <b>“번호”가 있는 줄은 그 책을 수정</b>하고,
            번호가 없는 줄은 새 책으로 추가합니다.
          </p>
          <div className="ie-actions">
            <button className="btn secondary" disabled={busy} onClick={() => excelInputRef.current?.click()}>
              Import from Excel
            </button>
            <input
              ref={excelInputRef}
              type="file"
              accept=".xlsx,.zip"
              hidden
              onChange={handleImportExcel}
            />
            <button className="btn secondary" disabled={busy} onClick={() => csvInputRef.current?.click()}>
              Import from CSV
            </button>
            <input ref={csvInputRef} type="file" accept=".csv,.zip" hidden onChange={handleImportCsv} />
          </div>
        </section>
      </div>
    </div>
  );
}
