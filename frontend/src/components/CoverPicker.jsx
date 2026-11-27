import { useRef, useState } from "react";
import { coverImageUrl } from "../api/books";
import ImageLightbox from "./ImageLightbox.jsx";
import ImageEditor from "./ImageEditor.jsx";
import "./CoverPicker.css";

// 표지를 고르는 컴포넌트.
// - 스캔 검토 화면: "내 사진(배경을 잘라낸 버전)" vs "인터넷에서 찾은 이미지" 비교
// - 이미 등록된 책 수정 화면: "현재 표지" vs [인터넷에서 표지 찾기]로 가져온 후보들 비교
// 어느 경우든 후보 목록은 baseCandidates(처음부터 있는 것) + 검색으로 찾은 것으로 구성되고,
// 직접 파일을 올리는 것도 계속 가능하다.
export default function CoverPicker({
  currentUrl,
  selectedPath, // 지금 선택돼 있는 이미지 경로 (직접 올린 파일을 쓰는 중이면 null)
  baseCandidates = [], // [{ key, path, label }]
  onSearch, // 있으면 [인터넷에서 표지 찾기] 버튼 표시. async () => [{ key, path, label, sub }]
  onSelect, // (path) => void
  onFileSelected, // (file) => void
  onRemove, // () => void
  editablePath, // 내가 찍은 사진의 경로(있으면 회전·자르기 편집 가능). 스캔 흐름에서만 전달됨.
  onEdited, // (file) => void — 편집된 이미지(File)를 표지로 사용
}) {
  const [comparing, setComparing] = useState(false);
  const [webCandidates, setWebCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [zoomSrc, setZoomSrc] = useState(null);
  const [editing, setEditing] = useState(false);
  const fileInputRef = useRef(null);

  const options = [...baseCandidates.filter((c) => c.path), ...webCandidates];
  // 지금 표시 중인 이미지가 "내가 찍은 사진"이면 확대 클릭 시 편집기를 연다(그 외 표지는 단순 확대).
  const currentIsEditable = Boolean(editablePath) && selectedPath === editablePath;

  function handleCurrentClick() {
    if (currentIsEditable) setEditing(true);
    else setZoomSrc(currentUrl);
  }

  function handleEditApply(file) {
    setEditing(false);
    setPreviewFailed(false);
    onEdited?.(file);
    setComparing(false);
  }

  function pick(option) {
    setPreviewFailed(false);
    onSelect(option.path, option.meta); // meta는 검색으로 찾은 후보에만 있음(내 사진/현재 표지엔 없음)
    setComparing(false);
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) {
      setPreviewFailed(false);
      onFileSelected(file);
      setComparing(false);
    }
  }

  async function handleSearch() {
    setSearching(true);
    setMessage("");
    setComparing(true);
    try {
      const found = await onSearch();
      setWebCandidates(found);
      if (found.length === 0) {
        setMessage("인터넷에서 이 책의 표지를 찾지 못했습니다. 제목/저자를 확인하거나 직접 올려주세요.");
      }
    } catch (err) {
      setWebCandidates([]);
      setMessage(
        err?.info || err?.response?.data?.detail || "표지를 찾는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
      );
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="cover-picker">
      <div className="cover-picker-row">
        {currentUrl && !previewFailed ? (
          // 크롬/파이어폭스는 HEIC를 못 그린다. 파일 자체는 정상이고 서버에서 JPEG로 변환되므로
          // 미리보기만 안내 문구로 대체한다. 클릭하면 확대해서 표지 글씨를 읽을 수 있다.
          <img
            className="cover-picker-current cover-picker-zoomable"
            src={currentUrl}
            alt=""
            title={currentIsEditable ? "크게 보고 편집(회전·자르기)" : "크게 보기"}
            onClick={handleCurrentClick}
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <div className="cover-picker-current cover-picker-empty">
            {previewFailed ? "미리보기를 지원하지 않는 형식입니다. 저장하면 정상 등록됩니다." : "표지 없음"}
          </div>
        )}
        <div className="cover-picker-actions">
          {editablePath && (
            <button type="button" className="btn secondary" onClick={() => setEditing(true)}>
              ✏️ 내 사진 편집(회전·자르기)
            </button>
          )}
          {onSearch && (
            <button type="button" className="btn secondary" onClick={handleSearch} disabled={searching}>
              {searching ? "찾는 중..." : "🔍 인터넷에서 표지 찾기"}
            </button>
          )}
          {options.length > 1 && (
            <button type="button" className="btn secondary" onClick={() => setComparing((v) => !v)}>
              {comparing ? "접기" : "표지 비교해서 고르기"}
            </button>
          )}
          <button type="button" className="btn secondary" onClick={() => fileInputRef.current?.click()}>
            직접 올리기
          </button>
          {currentUrl && (
            <button type="button" className="btn secondary" onClick={onRemove}>
              제거
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.heic,.heif,.HEIC,.HEIF"
          hidden
          onChange={handleFile}
        />
      </div>

      {message && <p className="cover-picker-message">{message}</p>}

      {comparing && options.length > 0 && (
        <div className="cover-picker-options">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              className={"cover-option" + (selectedPath && selectedPath === option.path ? " selected" : "")}
              onClick={() => pick(option)}
            >
              <span className="cover-option-imgwrap">
                <img src={coverImageUrl(option.path)} alt={option.label} />
                {/* 고르기 전에 크게 보고 확인 — 클릭은 선택으로 전파되지 않게 막는다 */}
                <span
                  className="cover-option-zoom"
                  title="크게 보기"
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoomSrc(coverImageUrl(option.path));
                  }}
                >
                  🔍
                </span>
              </span>
              <span>{option.label}</span>
              {option.sub && <span className="cover-option-sub">{option.sub}</span>}
            </button>
          ))}
        </div>
      )}

      <ImageLightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />

      {editing && editablePath && (
        <ImageEditor
          src={coverImageUrl(editablePath)}
          onApply={handleEditApply}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}
