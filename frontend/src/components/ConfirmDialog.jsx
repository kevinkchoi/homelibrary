import "./ConfirmDialog.css";

export default function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-box card" onClick={(e) => e.stopPropagation()}>
        <p>{message}</p>
        <div className="confirm-actions">
          <button className="btn secondary" onClick={onCancel}>
            취소
          </button>
          <button className="btn danger" onClick={onConfirm}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
