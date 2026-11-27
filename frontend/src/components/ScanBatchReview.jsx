import { useState } from "react";
import { coverImageUrl, createBook } from "../api/books";
import BookForm from "./BookForm.jsx";
import ImageLightbox from "./ImageLightbox.jsx";
import "./ScanBatchReview.css";

// items: [{ previewUrl, ok, error?, title?, author?, ..., cover_image_path?, source? }]
export default function ScanBatchReview({ items, defaultShelf = "", onAllDone }) {
  const [states, setStates] = useState(
    items.map((item) => ({ ...item, status: item.ok ? "pending" : "failed" }))
  );
  const [zoomSrc, setZoomSrc] = useState(null); // 확대해서 볼 이미지 URL

  async function handleSave(index, fields, opts) {
    const created = await createBook(fields, opts);
    setStates((prev) =>
      prev.map((s, i) =>
        i === index
          ? { ...s, status: "saved", savedTitle: created.title, savedCoverPath: created.cover_image_path }
          : s
      )
    );
  }

  function handleSkip(index) {
    setStates((prev) => prev.map((s, i) => (i === index ? { ...s, status: "skipped" } : s)));
  }

  const savedCount = states.filter((s) => s.status === "saved").length;
  const pendingCount = states.filter((s) => s.status === "pending" || s.status === "failed").length;

  return (
    <div className="scan-batch-review">
      <p className="scan-batch-summary">
        총 {states.length}장 중 {savedCount}권 추가됨
        {pendingCount > 0 && `, ${pendingCount}권 검토 대기 중`}
      </p>

      {states.map((item, index) => {
        // 추가된 뒤에는 "선택된 책 표지"를, 그 전에는 "내가 찍은 사진"을 보여준다.
        // 서버가 저장한 JPEG를 우선 사용(원본이 HEIC면 로컬 blob은 크롬에서 렌더링 안 됨).
        const photoUrl = coverImageUrl(item.photo_image_path) || item.previewUrl;
        const thumbUrl =
          item.status === "saved" ? coverImageUrl(item.savedCoverPath) || photoUrl : photoUrl;

        return (
          <div key={index} className="scan-batch-card card">
            <div className="scan-batch-card-body">
              {thumbUrl && (
                // 클릭하면 확대 — 작은 글씨(출판사/옮긴이)까지 읽을 수 있게
                <button
                  type="button"
                  className="scan-batch-thumb-btn"
                  onClick={() => setZoomSrc(thumbUrl)}
                  title="크게 보기"
                >
                  <img className="scan-batch-thumb" src={thumbUrl} alt="" />
                  <span className="scan-batch-thumb-zoom" aria-hidden="true">
                    🔍
                  </span>
                </button>
              )}

              <div className="scan-batch-form-area">
                {item.status === "failed" && (
                  <p className="form-error">{item.error || "이 사진에서는 정보를 읽지 못했습니다. 직접 입력해주세요."}</p>
                )}

                {(item.status === "pending" || item.status === "failed") && (
                  <BookForm
                    initialValues={
                      // 사진에서 읽어 온 값이 우선이고, 책꽂이만 비어 있을 때 채워 준다.
                      item.shelf_location ? item : { ...item, shelf_location: defaultShelf }
                    }
                    initialCoverImagePath={item.cover_image_path}
                    coverCandidates={
                      item.photo_image_path
                        ? { photoPath: item.photo_image_path, webPath: item.web_image_path }
                        : undefined
                    }
                    allowCoverSearch
                    allowIsbnLookup
                    checkDuplicates
                    submitLabel="추가"
                    onCancel={() => handleSkip(index)}
                    onSubmit={(fields, opts) => handleSave(index, fields, opts)}
                  />
                )}

                {item.status === "saved" && (
                  <p className="scan-batch-done">✓ "{item.savedTitle}" 추가됨</p>
                )}
                {item.status === "skipped" && <p className="scan-batch-skipped">이 사진은 건너뛰었습니다.</p>}
              </div>
            </div>
          </div>
        );
      })}

      <div className="scan-batch-footer">
        <button className="btn" type="button" onClick={onAllDone}>
          완료 ({savedCount}권 추가됨) → 홈으로
        </button>
      </div>

      <ImageLightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </div>
  );
}
