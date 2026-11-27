import { useEffect, useState } from "react";
import "./ImageLightbox.css";

// 이미지 둘레에 남길 여백(px). 사진이 화면에 꽉 차 버리면 **닫으려고 누를 배경**이 없어진다.
const MARGIN = 16;

/**
 * 이미지를 화면에 꽉 차게(단, 화면을 넘지 않게) 보여주는 오버레이.
 * 아무 곳이나 누르거나 Esc를 누르면 닫히고 원래 화면으로 돌아간다.
 *
 * **왜 크기를 JS로 재서 넣는가**: 책 목록 화면은 표가 화면보다 넓어 페이지가 가로로도
 * 스크롤된다. 그 상태에서는 `position: fixed` 오버레이가 화면 폭이 아니라 **문서 폭**으로
 * 잡히는 경우가 있어(실측 375px 화면에서 656px), CSS의 `max-width: 100%`만으로는
 * 사진이 화면 밖으로 삐져나간다. 그래서 화면 크기를 직접 재서 픽셀로 못박는다.
 */
export default function ImageLightbox({ src, alt = "", onClose }) {
  const [limit, setLimit] = useState(() => readViewport());

  useEffect(() => {
    if (!src) return undefined;

    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    const resize = () => setLimit(readViewport());

    resize(); // 열릴 때의 화면 크기로 맞춘다(가로로 돌렸을 수 있다)
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);

    // 오버레이가 떠 있는 동안 뒤 배경 스크롤 방지
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      document.body.style.overflow = prev;
    };
  }, [src, onClose]);

  if (!src) return null;

  return (
    // 사진을 포함해 아무 데나 누르면 닫힌다. 확대 같은 다른 조작이 없으므로 누를 곳을
    // 가려 둘 이유가 없다 — 닫을 방법을 못 찾는 쪽이 훨씬 나쁘다.
    // onMouseDown 전파를 막는 이유: 책 상세 팝업 안에서 쓰므로, 닫는 클릭이 팝업까지
    // 닫아 버리지 않게 한다.
    <div
      className="lightbox-overlay"
      onClick={onClose}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <img
        className="lightbox-img"
        style={{ maxWidth: limit.width, maxHeight: limit.height }}
        src={src}
        alt={alt}
        draggable={false}
      />
      <p className="lightbox-hint">아무 곳이나 누르면 닫힙니다</p>
    </div>
  );
}

/** 지금 실제로 보이는 화면 크기. 폰에서 주소창이 접히는 것까지 반영하려고 visualViewport를 먼저 본다. */
function readViewport() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const width = Math.round(vv?.width || document.documentElement.clientWidth || 0);
  const height = Math.round(vv?.height || document.documentElement.clientHeight || 0);
  return {
    width: Math.max(80, width - MARGIN * 2),
    // 아래쪽 안내 문구 자리를 빼 둔다
    height: Math.max(80, height - MARGIN * 2 - 28),
  };
}
