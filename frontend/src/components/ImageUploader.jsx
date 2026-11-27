import { useEffect, useState } from "react";
import "./ImageUploader.css";

export default function ImageUploader({ existingUrl, onFileSelected, onRemoveExisting }) {
  const [preview, setPreview] = useState(existingUrl || null);
  const [removed, setRemoved] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    setPreview(existingUrl || null);
    setRemoved(false);
    setPreviewFailed(false);
  }, [existingUrl]);

  function handleChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRemoved(false);
    setPreviewFailed(false);
    setPreview(URL.createObjectURL(file));
    onFileSelected(file);
  }

  function handleRemove() {
    setPreview(null);
    setRemoved(true);
    setPreviewFailed(false);
    onFileSelected(null);
    onRemoveExisting?.();
  }

  return (
    <div className="image-uploader">
      {preview ? (
        <div className="image-preview">
          {/* 크롬/파이어폭스는 HEIC를 화면에 못 그린다. 파일 자체는 정상이고
              서버에서 JPEG로 변환되므로, 미리보기만 안내 문구로 대체한다 */}
          {previewFailed ? (
            <p className="image-placeholder">
              이 형식(HEIC 등)은 미리보기를 지원하지 않습니다. 저장하면 정상 등록됩니다.
            </p>
          ) : (
            <img src={preview} alt="표지 미리보기" onError={() => setPreviewFailed(true)} />
          )}
          <button type="button" className="btn secondary" onClick={handleRemove}>
            이미지 제거
          </button>
        </div>
      ) : (
        <p className="image-placeholder">{removed ? "이미지가 제거됩니다." : "표지 이미지가 없습니다."}</p>
      )}
      <input
        type="file"
        accept="image/*,.heic,.heif,.HEIC,.HEIF"
        onChange={handleChange}
      />
    </div>
  );
}
