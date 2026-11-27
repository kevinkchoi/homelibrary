import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import CameraCapture from "../components/CameraCapture.jsx";
import BarcodeScanner from "../components/BarcodeScanner.jsx";
import { extractFromPhoto } from "../api/scan";
import { lookupIsbn } from "../api/books";
import useBusyWhile from "../hooks/useBusyWhile.js";
import { aiAvailable, useAiStatus } from "../utils/serverConfig.js";
import "./Scan.css";

export default function Scan() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [mode, setMode] = useState("select"); // select | camera | barcode | processing
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // 연속 바코드 스캔으로 담은 책들 [{ isbn, status: loading|ok|fail, title, error, data }]
  const [scanned, setScanned] = useState([]);
  // 표지 **사진** 인식은 Claude가 한다. personal 모드에서 자기 키가 없으면 바코드만 보여 준다.
  const canReadPhotos = aiAvailable(useAiStatus());

  // 카메라·바코드가 도는 중이거나 **담아 둔 스캔 결과가 있으면** 입력 중이다.
  // 새로고침되면 그 목록이 통째로 사라진다(서버에 저장되기 전 상태다).
  useBusyWhile(mode !== "select" || scanned.length > 0);

  function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length > 0) processPhotos(files);
  }

  function handleCameraFinish(blobs) {
    setMode("select");
    if (blobs.length > 0) processPhotos(blobs);
  }

  // 바코드 한 건을 인식할 때마다 바로 ISBN 조회를 걸어 둔다(스캔은 계속 진행된다).
  // 이미 담은 ISBN이면 조용히 무시 — 목록에 이미 보이므로 사용자가 알 수 있다.
  async function handleBarcode(isbn) {
    let isNew = false;
    setScanned((prev) => {
      if (prev.some((item) => item.isbn === isbn)) return prev;
      isNew = true;
      return [...prev, { isbn, status: "loading" }];
    });
    if (!isNew) return;

    try {
      const data = await lookupIsbn(isbn);
      setScanned((prev) =>
        prev.map((item) =>
          item.isbn !== isbn
            ? item
            : data.found
              ? { ...item, status: "ok", title: data.title, data }
              : { ...item, status: "fail", error: "책 정보를 찾지 못함" }
        )
      );
    } catch {
      setScanned((prev) =>
        prev.map((item) =>
          item.isbn === isbn ? { ...item, status: "fail", error: "조회 실패" } : item
        )
      );
    }
  }

  // 스캔을 마치면 표지 사진 스캔과 **같은 검토 화면**으로 넘긴다(저장 흐름을 공유한다).
  function finishBarcodeScan() {
    setMode("select");
    const results = scanned.map((item) =>
      item.status === "ok"
        ? { ...item.data, ok: true }
        : {
            ok: false,
            isbn: item.isbn,
            error: `ISBN ${item.isbn}의 정보를 찾지 못했습니다. 직접 입력해주세요.`,
          }
    );
    setScanned([]);
    if (results.length > 0) {
      navigate("/add", { state: { scanResults: results } });
    }
  }

  async function processPhotos(photos) {
    setMode("processing");
    setProgress({ done: 0, total: photos.length });

    const results = [];
    for (const photo of photos) {
      const previewUrl = URL.createObjectURL(photo);
      try {
        const result = await extractFromPhoto(photo);
        results.push({ ...result, previewUrl, ok: true });
      } catch (err) {
        results.push({
          previewUrl,
          ok: false,
          error: err.response?.data?.detail || "정보를 읽는 데 실패했습니다.",
        });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    navigate("/add", { state: { scanResults: results } });
  }

  return (
    <div className="scan-page">
      <h1>책 스캔</h1>
      <p className="scan-desc">
        <strong>ISBN 바코드</strong>를 비추면 가장 빠르고 정확합니다(책 뒤표지의 줄무늬 바코드).
        바코드가 없는 옛날 책은 표지 사진으로 스캔하세요 — 여러 권을 한꺼번에 찍어도 됩니다.
      </p>

      {mode === "select" && (
        <div className="scan-mode-select">
          {/* 바코드가 가장 빠르고 정확하다(ISBN 정확 조회) — 그래서 맨 위에 둔다 */}
          <button className="btn scan-mode-btn" type="button" onClick={() => setMode("barcode")}>
            📖 ISBN 바코드로 스캔
          </button>
          {canReadPhotos ? (
            <>
              <button
                className="btn secondary scan-mode-btn"
                type="button"
                onClick={() => setMode("camera")}
              >
                📷 표지 사진찍기
              </button>
              <button
                className="btn secondary scan-mode-btn"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                🖼 표지 사진 파일 선택
              </button>
            </>
          ) : (
            <p className="scan-ai-hint">
              표지 <b>사진</b>으로 책을 읽으려면 <Link to="/settings">내 설정</Link>에서 Claude API 키를
              넣어 주세요. 바코드 스캔과 직접 입력은 키 없이 됩니다.
            </p>
          )}
          {/* 데스크톱 파일 선택창에서 아이폰 HEIC 사진이 회색으로 비활성화되지 않도록
              확장자를 명시한다 (브라우저에 따라 image/* 만으로는 HEIC를 못 고른다) */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.heic,.heif,.HEIC,.HEIF"
            multiple
            hidden
            onChange={handleFileChange}
          />
        </div>
      )}

      {mode === "camera" && (
        <CameraCapture onFinish={handleCameraFinish} onCancel={() => setMode("select")} />
      )}

      {mode === "barcode" && (
        <BarcodeScanner
          title="ISBN 바코드로 여러 권 담기"
          queue={scanned}
          closeLabel="검토하러 가기"
          onDetected={handleBarcode}
          onClose={finishBarcodeScan}
        />
      )}

      {mode === "processing" && (
        <div className="scan-processing">
          <p>
            사진 분석 중... ({progress.done}/{progress.total})
          </p>
        </div>
      )}
    </div>
  );
}
