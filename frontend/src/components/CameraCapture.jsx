import { useRef, useState } from "react";
import "./CameraCapture.css";

// iOS Safari/Chrome(WebKit)에서 실시간 미리보기(getUserMedia)는 HTTPS가 아닌 환경에서 막히거나,
// 되더라도 촬영(canvas 캡처)이 불안정한 사례가 있어 완전히 제거함. 대신 기기 카메라 앱을 그대로
// 여는 input[type=file][capture=environment] 방식만 사용 — 보안 컨텍스트가 필요 없고 더 안정적임.
// 여러 장을 연속으로 찍어 모았다가 [완료]를 누르면 한꺼번에 상위로 전달.
export default function CameraCapture({ onFinish, onCancel }) {
  const fileInputRef = useRef(null);
  const [shots, setShots] = useState([]); // [{ blob, url }]

  function addShot(blob) {
    const url = URL.createObjectURL(blob);
    setShots((prev) => [...prev, { blob, url }]);
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) addShot(file);
  }

  function removeShot(index) {
    setShots((prev) => prev.filter((_, i) => i !== index));
  }

  function handleFinish() {
    onFinish(shots.map((s) => s.blob));
  }

  return (
    <div className="camera-capture">
      <button className="btn shutter-btn-standalone" type="button" onClick={() => fileInputRef.current?.click()}>
        📷 촬영하기
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={handleFile}
      />

      {shots.length > 0 && (
        <div className="shot-strip">
          {shots.map((s, i) => (
            <div key={s.url} className="shot-thumb">
              <img src={s.url} alt={`촬영 ${i + 1}`} />
              <button type="button" className="shot-remove" onClick={() => removeShot(i)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="camera-batch-actions">
        <span className="shot-count">{shots.length}장 촬영됨</span>
        <button className="btn secondary" type="button" onClick={onCancel}>
          취소
        </button>
        <button className="btn" type="button" disabled={shots.length === 0} onClick={handleFinish}>
          완료 ({shots.length}장)
        </button>
      </div>
    </div>
  );
}
