import { useCallback, useEffect, useRef, useState } from "react";
import "./ImageEditor.css";

// 내가 찍은 책 사진을 편집하는 전체화면 오버레이.
// - 90° 좌/우 회전
// - 네 꼭짓점(모서리 핸들)을 책의 각 귀퉁이에 맞추면, 그 사각형 영역을 원근 보정(perspective warp)해
//   직사각형으로 펴서 출력 이미지에 꽉 차게 만든다. (책 밖 테두리는 자동으로 잘려나간다)
// 적용하면 편집된 JPEG File을 onApply(file)로 돌려준다.

const BASE_MAX = 2400; // 샘플링용 기준 캔버스 최대 변(픽셀). 폰 원본이 크면 여기로 축소해 워핑 속도 확보.
const OUT_MAX = 1600; // 출력 이미지 최대 변(서버 저장 한도와 동일)
const HANDLE_HIT = 28; // 핸들 잡기 허용 반경(화면 px)

export default function ImageEditor({ src, onApply, onCancel }) {
  const canvasRef = useRef(null);
  const imgElRef = useRef(null);
  const baseCanvasRef = useRef(null); // 회전이 반영된 전체해상도 오프스크린 캔버스(샘플링 원본)
  const displayBaseRef = useRef(null); // 밝기/대비까지 반영된 표시용 캔버스(드래그마다 재계산 안 하려고 캐시)
  const draggingRef = useRef(-1);

  const [baseDims, setBaseDims] = useState({ w: 0, h: 0 });
  const [corners, setCorners] = useState(null); // [TL, TR, BR, BL], base 좌표
  const [rotation, setRotation] = useState(0);
  const [brightness, setBrightness] = useState(0); // -100 ~ 100
  const [contrast, setContrast] = useState(0); // -100 ~ 100
  const [baseVersion, setBaseVersion] = useState(0); // 표시용 캔버스가 바뀌면 다시 그리도록
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  // 회전을 반영한 기준 캔버스를 다시 만들고, 네 모서리를 전체 영역(약간 안쪽)으로 초기화한다.
  const buildBase = useCallback((rot) => {
    const img = imgElRef.current;
    if (!img) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const scale = Math.min(1, BASE_MAX / Math.max(nw, nh));
    const dw = Math.round(nw * scale);
    const dh = Math.round(nh * scale);
    const rotated = rot === 90 || rot === 270;
    const w = rotated ? dh : dw;
    const h = rotated ? dw : dh;

    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d");
    cx.translate(w / 2, h / 2);
    cx.rotate((rot * Math.PI) / 180);
    cx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    baseCanvasRef.current = c;

    const mx = w * 0.06;
    const my = h * 0.06;
    setBaseDims({ w, h });
    setCorners([
      { x: mx, y: my },
      { x: w - mx, y: my },
      { x: w - mx, y: h - my },
      { x: mx, y: h - my },
    ]);
  }, []);

  useEffect(() => {
    if (!src) return undefined;
    setError("");
    const img = new Image();
    img.onload = () => {
      imgElRef.current = img;
      setRotation(0);
      setBrightness(0);
      setContrast(0);
      buildBase(0);
    };
    img.onerror = () => setError("이미지를 불러오지 못했습니다.");
    img.src = src;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src, buildBase]);

  // Esc로 닫기 + 배경 스크롤 잠금
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel]);

  // 화면에 표시할 크기 계산(뷰포트에 맞춤)
  function displaySize() {
    const { w, h } = baseDims;
    if (!w || !h) return { dispW: 0, dispH: 0 };
    const maxW = Math.min(window.innerWidth - 24, 820);
    const maxH = window.innerHeight - 180;
    const scale = Math.min(maxW / w, maxH / h);
    return { dispW: Math.round(w * scale), dispH: Math.round(h * scale) };
  }

  // 밝기/대비를 반영한 "표시용 캔버스"를 만든다(CSS 픽셀 크기, dpr 배율 없음).
  // 모서리 드래그와 분리해, 슬라이더/회전이 바뀔 때만 재계산한다(고해상도 backing store에서
  // 매 드래그마다 LUT를 돌리면 느려지므로).
  useEffect(() => {
    const base = baseCanvasRef.current;
    if (!base || !baseDims.w) return;
    const { dispW, dispH } = displaySize();
    if (!dispW || !dispH) return;
    const off = document.createElement("canvas");
    off.width = dispW;
    off.height = dispH;
    const octx = off.getContext("2d");
    octx.drawImage(base, 0, 0, dispW, dispH);
    if (brightness !== 0 || contrast !== 0) {
      const lut = makeLut(brightness, contrast);
      const im = octx.getImageData(0, 0, dispW, dispH);
      const d = im.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = lut[d[i]];
        d[i + 1] = lut[d[i + 1]];
        d[i + 2] = lut[d[i + 2]];
      }
      octx.putImageData(im, 0, 0);
    }
    displayBaseRef.current = { canvas: off, dispW, dispH };
    setBaseVersion((v) => v + 1);
  }, [baseDims, rotation, brightness, contrast]);

  // 표시용 캔버스 + 모서리 오버레이를 다시 그린다(드래그 중엔 이쪽만 돈다).
  useEffect(() => {
    const canvas = canvasRef.current;
    const db = displayBaseRef.current;
    if (!canvas || !db || !corners) return;
    const { w, h } = baseDims;
    const { canvas: off, dispW, dispH } = db;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(dispW * dpr);
    canvas.height = Math.round(dispH * dpr);
    canvas.style.width = `${dispW}px`;
    canvas.style.height = `${dispH}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.drawImage(off, 0, 0, dispW, dispH);

    const sx = dispW / w;
    const sy = dispH / h;
    const dc = corners.map((p) => ({ x: p.x * sx, y: p.y * sy }));

    // 사각형 바깥 영역 어둡게(테두리로 잘려나갈 부분)
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.rect(0, 0, dispW, dispH);
    ctx.moveTo(dc[0].x, dc[0].y);
    ctx.lineTo(dc[1].x, dc[1].y);
    ctx.lineTo(dc[2].x, dc[2].y);
    ctx.lineTo(dc[3].x, dc[3].y);
    ctx.closePath();
    ctx.fill("evenodd");
    ctx.restore();

    // 사각형 외곽선
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dc[0].x, dc[0].y);
    ctx.lineTo(dc[1].x, dc[1].y);
    ctx.lineTo(dc[2].x, dc[2].y);
    ctx.lineTo(dc[3].x, dc[3].y);
    ctx.closePath();
    ctx.stroke();

    // 모서리 핸들
    dc.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#0284c7";
      ctx.stroke();
    });
  }, [corners, baseVersion, baseDims]);

  function pointerToBase(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const { w, h } = baseDims;
    return {
      cssX: e.clientX - rect.left,
      cssY: e.clientY - rect.top,
      x: ((e.clientX - rect.left) / rect.width) * w,
      y: ((e.clientY - rect.top) / rect.height) * h,
      rect,
    };
  }

  function onPointerDown(e) {
    if (!corners) return;
    const { cssX, cssY, rect } = pointerToBase(e);
    const { w, h } = baseDims;
    let best = -1;
    let bestD = Infinity;
    corners.forEach((pt, i) => {
      const hx = (pt.x / w) * rect.width;
      const hy = (pt.y / h) * rect.height;
      const d = Math.hypot(cssX - hx, cssY - hy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (bestD <= HANDLE_HIT) {
      draggingRef.current = best;
      canvasRef.current.setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e) {
    const idx = draggingRef.current;
    if (idx < 0) return;
    const { x, y } = pointerToBase(e);
    const { w, h } = baseDims;
    const cx = Math.max(0, Math.min(w, x));
    const cy = Math.max(0, Math.min(h, y));
    setCorners((prev) => prev.map((p, i) => (i === idx ? { x: cx, y: cy } : p)));
  }

  function onPointerUp(e) {
    if (draggingRef.current >= 0) {
      draggingRef.current = -1;
      try {
        canvasRef.current.releasePointerCapture(e.pointerId);
      } catch {
        // capture가 이미 해제된 경우 무시
      }
    }
  }

  function rotate(delta) {
    const next = (((rotation + delta) % 360) + 360) % 360;
    setRotation(next);
    buildBase(next);
  }

  function handleApply() {
    if (!corners) return;
    setProcessing(true);
    setError("");
    // "처리 중" 표시가 먼저 그려지도록 다음 틱에 무거운 워핑 실행
    setTimeout(() => {
      try {
        warpToBlob((file) => {
          setProcessing(false);
          onApply(file);
        });
      } catch (err) {
        setProcessing(false);
        setError(err.message || "이미지를 편집하지 못했습니다. 네 모서리 위치를 확인해주세요.");
      }
    }, 30);
  }

  // 네 꼭짓점 → 직사각형 원근 변환 후 JPEG File로 콜백.
  function warpToBlob(done) {
    const base = baseCanvasRef.current;
    const bw = base.width;
    const bh = base.height;
    const [s0, s1, s2, s3] = corners; // TL, TR, BR, BL
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let outW = Math.round(Math.max(dist(s0, s1), dist(s3, s2)));
    let outH = Math.round(Math.max(dist(s0, s3), dist(s1, s2)));
    if (outW < 10 || outH < 10) {
      throw new Error("선택한 영역이 너무 작습니다.");
    }
    const m = Math.max(outW, outH);
    if (m > OUT_MAX) {
      const k = OUT_MAX / m;
      outW = Math.max(1, Math.round(outW * k));
      outH = Math.max(1, Math.round(outH * k));
    }

    // dest(직사각형) → source(원본 사각형) 호모그래피. 출력 픽셀마다 원본을 역방향 샘플링(구멍 방지).
    const H = computeHomography(
      [
        [0, 0],
        [outW, 0],
        [outW, outH],
        [0, outH],
      ],
      [
        [s0.x, s0.y],
        [s1.x, s1.y],
        [s2.x, s2.y],
        [s3.x, s3.y],
      ]
    );
    const [a, b, c, d, e, f, g, h] = H;

    const bctx = base.getContext("2d");
    const src = bctx.getImageData(0, 0, bw, bh).data;
    // 미리보기와 동일하게 밝기/대비를 출력에도 반영
    if (brightness !== 0 || contrast !== 0) {
      const lut = makeLut(brightness, contrast);
      for (let i = 0; i < src.length; i += 4) {
        src[i] = lut[src[i]];
        src[i + 1] = lut[src[i + 1]];
        src[i + 2] = lut[src[i + 2]];
      }
    }
    const out = document.createElement("canvas");
    out.width = outW;
    out.height = outH;
    const octx = out.getContext("2d");
    const outImg = octx.createImageData(outW, outH);
    const od = outImg.data;

    for (let v = 0; v < outH; v++) {
      for (let u = 0; u < outW; u++) {
        const denom = g * u + h * v + 1;
        let fx = (a * u + b * v + c) / denom;
        let fy = (d * u + e * v + f) / denom;
        if (fx < 0) fx = 0;
        else if (fx > bw - 1) fx = bw - 1;
        if (fy < 0) fy = 0;
        else if (fy > bh - 1) fy = bh - 1;
        const x0 = fx | 0;
        const y0 = fy | 0;
        const x1 = x0 < bw - 1 ? x0 + 1 : x0;
        const y1 = y0 < bh - 1 ? y0 + 1 : y0;
        const dx = fx - x0;
        const dy = fy - y0;
        const i00 = (y0 * bw + x0) * 4;
        const i10 = (y0 * bw + x1) * 4;
        const i01 = (y1 * bw + x0) * 4;
        const i11 = (y1 * bw + x1) * 4;
        const oi = (v * outW + u) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const top = src[i00 + ch] * (1 - dx) + src[i10 + ch] * dx;
          const bot = src[i01 + ch] * (1 - dx) + src[i11 + ch] * dx;
          od[oi + ch] = top * (1 - dy) + bot * dy;
        }
        od[oi + 3] = 255;
      }
    }
    octx.putImageData(outImg, 0, 0);
    out.toBlob(
      (blob) => {
        if (!blob) {
          setProcessing(false);
          setError("이미지를 저장하지 못했습니다.");
          return;
        }
        done(new File([blob], "edited-cover.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.92
    );
  }

  return (
    <div className="image-editor-overlay">
      <div className="image-editor-toolbar">
        <button type="button" className="btn secondary" onClick={() => rotate(-90)} disabled={processing}>
          ↺ 왼쪽 회전
        </button>
        <button type="button" className="btn secondary" onClick={() => rotate(90)} disabled={processing}>
          ↻ 오른쪽 회전
        </button>
        <span className="image-editor-hint">네 모서리를 책의 각 귀퉁이에 맞추세요</span>
      </div>

      <div className="image-editor-adjust">
        <label className="image-editor-slider">
          밝기
          <input
            type="range"
            min="-100"
            max="100"
            value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
            disabled={processing}
          />
          <span className="image-editor-slider-val">{brightness}</span>
        </label>
        <label className="image-editor-slider">
          대비
          <input
            type="range"
            min="-100"
            max="100"
            value={contrast}
            onChange={(e) => setContrast(Number(e.target.value))}
            disabled={processing}
          />
          <span className="image-editor-slider-val">{contrast}</span>
        </label>
        {(brightness !== 0 || contrast !== 0) && (
          <button
            type="button"
            className="image-editor-reset"
            onClick={() => {
              setBrightness(0);
              setContrast(0);
            }}
            disabled={processing}
          >
            초기화
          </button>
        )}
      </div>

      <div className="image-editor-stage">
        {error ? (
          <p className="image-editor-error">{error}</p>
        ) : (
          <canvas
            ref={canvasRef}
            className="image-editor-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        )}
        {processing && <div className="image-editor-processing">처리 중...</div>}
      </div>

      <div className="image-editor-actions">
        <button type="button" className="btn secondary" onClick={onCancel} disabled={processing}>
          취소
        </button>
        <button type="button" className="btn" onClick={handleApply} disabled={processing || !!error}>
          {processing ? "처리 중..." : "이 영역으로 자르기"}
        </button>
      </div>
    </div>
  );
}

// 밝기/대비(-100~100)를 0~255 값에 매핑하는 256칸 룩업테이블.
// CSS filter와 같은 순서/의미: 밝기는 곱(1+b/100), 대비는 128 기준 확대((v-128)*(1+c/100)+128).
function makeLut(b, c) {
  const bMult = 1 + b / 100;
  const cMult = 1 + c / 100;
  const lut = new Uint8ClampedArray(256); // Uint8ClampedArray가 0~255로 자동 클램프
  for (let i = 0; i < 256; i++) {
    lut[i] = (i * bMult - 128) * cMult + 128;
  }
  return lut;
}

// dest 4점 → source 4점으로 매핑하는 3x3 호모그래피를 구한다.
// 반환: [a,b,c,d,e,f,g,h] where  x = (a*u+b*v+c)/(g*u+h*v+1), y = (d*u+e*v+f)/(g*u+h*v+1)
function computeHomography(dst, src) {
  const A = [];
  const B = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = dst[i];
    const [x, y] = src[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    B.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    B.push(y);
  }
  return solveLinear(A, B, 8);
}

// 부분 피벗을 사용한 가우스 소거법으로 n원 연립방정식 A x = B 를 푼다.
function solveLinear(A, B, n) {
  const M = A.map((row, i) => [...row, B[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-9) {
      throw new Error("네 모서리가 일직선에 가깝습니다. 위치를 다시 잡아주세요.");
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) M[r][j] -= factor * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}
