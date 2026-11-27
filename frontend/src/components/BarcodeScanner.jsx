import { useCallback, useEffect, useRef, useState } from "react";
import { isBookBarcode, normalizeIsbn } from "../utils/isbn.js";
import "./BarcodeScanner.css";

// ZXing은 번들이 큰 편이라(수백 KB) **스캐너를 실제로 열 때만** 동적으로 불러온다.
// 이렇게 하면 목록/검색만 쓰는 대다수 화면의 첫 로딩이 느려지지 않는다.
let readerModulePromise = null;
function loadReader() {
  if (!readerModulePromise) {
    readerModulePromise = Promise.all([
      import("@zxing/browser"),
      import("@zxing/library"),
    ]).then(([browser, library]) => {
      // 책 바코드는 EAN-13(978/979로 시작)이다. 포맷을 좁혀야 오인식이 줄고 속도도 빨라진다.
      // EAN-8은 일부 소책자에서 쓰여 함께 허용한다.
      const hints = new Map();
      hints.set(library.DecodeHintType.POSSIBLE_FORMATS, [
        library.BarcodeFormat.EAN_13,
        library.BarcodeFormat.EAN_8,
      ]);
      hints.set(library.DecodeHintType.TRY_HARDER, true);
      return { BrowserMultiFormatReader: browser.BrowserMultiFormatReader, hints };
    });
  }
  return readerModulePromise;
}

/**
 * 기기에 내장된 바코드 인식기(Shape Detection API).
 *
 * **왜 이걸 먼저 쓰는가**: 안드로이드 WebView/크롬에는 구글의 ML 바코드 인식기가 들어 있고,
 * 흐릿하거나 비스듬하거나 작게 찍힌 바코드에 ZXing보다 훨씬 강하다. 네이티브 코드라 빠르기도 하다.
 * 없는 기기(iOS Safari 등)에서는 `null`이 나오고 ZXing으로 넘어간다.
 */
async function loadNativeDetector() {
  try {
    if (typeof window === "undefined" || !("BarcodeDetector" in window)) return null;
    // 지원 포맷을 물어봐야 한다 — API는 있는데 EAN을 못 읽는 기기가 있다.
    const supported = await window.BarcodeDetector.getSupportedFormats?.();
    const want = ["ean_13", "ean_8"].filter((f) => !supported || supported.includes(f));
    if (want.length === 0) return null;
    return new window.BarcodeDetector({ formats: want });
  } catch {
    return null;
  }
}

/** 사진을 이미지 요소로 읽어 온다. */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// 결과 캔버스의 최대 가로폭. 요즘 폰 사진은 4000px가 넘어서, 그대로 키우면
// 메모리도 시간도 크게 든다. 바코드는 1600px면 충분히 읽힌다.
const MAX_CANVAS_W = 1600;

/**
 * 원본(사진 또는 비디오)의 가운데를 잘라 키운 캔버스를 만든다. 필요하면 흑백·대비 보정까지.
 *
 * **왜 필요한가**: 멀리서 비추면 바코드가 화면 한가운데 **작게** 들어간다. 그대로 넘기면
 * 줄 간격이 1픽셀도 안 돼 인식이 안 된다. 가운데를 잘라 키우면 같은 화면에서도 읽힌다.
 *
 * `into`를 주면 그 캔버스를 재사용한다 — 라이브에서는 초당 대여섯 번 부르므로
 * 매번 새 캔버스를 만들면 메모리가 출렁인다.
 */
function cropSource(src, srcW, srcH, ratio, { boost = false, maxW = MAX_CANVAS_W, into } = {}) {
  // `ratio`는 숫자(가로·세로 같은 비율) 또는 `{ w, h }`(따로). 바코드는 **가로로 길기** 때문에
  // 정사각형으로 자르면 위아래의 쓸모없는 부분까지 들고 와 정작 줄은 덜 키우게 된다.
  const rw = typeof ratio === "number" ? ratio : ratio.w;
  const rh = typeof ratio === "number" ? ratio : ratio.h;
  const cw = Math.max(1, Math.round(srcW * rw));
  const ch = Math.max(1, Math.round(srcH * rh));
  const sx = Math.round((srcW - cw) / 2);
  const sy = Math.round((srcH - ch) / 2);

  const scale = Math.min(3, Math.max(1, maxW / cw));
  const canvas = into || document.createElement("canvas");
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: boost });
  ctx.drawImage(src, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);

  if (boost) {
    // 흑백으로 바꾸고 가운데 밝기를 기준으로 대비를 세게 준다.
    // 그늘지거나 누렇게 찍힌 화면에서 줄과 바탕을 갈라 준다.
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }
    const mid = sum / (px.length / 4);
    for (let i = 0; i < px.length; i += 4) {
      const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const v = g > mid ? 255 : 0;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
  }
  return canvas;
}

const cropAndScale = (img, ratio, opts) =>
  cropSource(img, img.naturalWidth, img.naturalHeight, ratio, opts);

/** 캔버스 하나에서 바코드를 찾아본다. 내장 인식기를 먼저, 없으면/못 찾으면 ZXing. */
async function decodeCanvas(canvas, detector, reader) {
  if (detector) {
    try {
      const found = await detector.detect(canvas);
      if (found?.length) {
        const hit = found.find((b) => /^97[89]/.test(b.rawValue || "")) || found[0];
        if (hit?.rawValue) return hit.rawValue;
      }
    } catch {
      /* 내장 인식기가 이 프레임을 못 다루면 ZXing으로 */
    }
  }
  if (reader) {
    try {
      return reader.decodeFromCanvas(canvas).getText();
    } catch {
      /* 못 찾음 */
    }
  }
  return null;
}

/**
 * 한 장(사진이든 정지 프레임이든)에서 바코드를 **여러 방법으로** 찾아본다.
 *
 * 한 번 실패했다고 포기하면, 멀리서 찍어 바코드가 작게 들어간 사진을 전부 놓친다.
 * 실제로 "카메라 앱에서 2배 당겨 찍으면 된다"는 것이 곧 **가운데를 잘라 키우면 읽힌다**는
 * 뜻이라, 그 일을 앱이 대신 해 준다.
 */
async function decodePhoto({ detector, reader }, url) {
  let img;
  try {
    img = await loadImage(url);
  } catch {
    return null;
  }
  const attempts = [
    () => cropAndScale(img, 1),
    () => cropAndScale(img, 0.6),
    () => cropAndScale(img, 0.4),
    () => cropAndScale(img, 0.6, { boost: true }),
    () => cropAndScale(img, 1, { boost: true }),
  ];
  for (const make of attempts) {
    const text = await decodeCanvas(make(), detector, reader);
    if (text) return text;
  }
  return null;
}

// 라이브에서 한 번에 한 가지씩 **돌아가며** 시도한다. 매 프레임 다섯 가지를 다 해 보면
// 폰이 버거워 화면이 끊기고, 오히려 초점 맞출 시간을 뺏는다. 1초면 한 바퀴를 돈다.
const LIVE_PLAN = [
  { ratio: 1, boost: false },                        // 화면 전체
  { ratio: { w: 0.9, h: 0.45 }, boost: false },      // 가운데 가로 띠 — 가늠자가 가리키는 곳
  { ratio: { w: 0.6, h: 0.3 }, boost: false },       // 멀리서 비출 때(더 크게 키운다)
  { ratio: { w: 0.9, h: 0.45 }, boost: true },       // 그늘지거나 대비가 약할 때
];
const LIVE_INTERVAL = 160;  // ms
const LIVE_MAX_W = 1280;    // 라이브는 사진보다 작게 — 대비 보정이 픽셀을 훑기 때문

/**
 * ISBN 바코드 스캐너.
 *
 * 두 가지 방식을 모두 제공하는 이유: 이 프로젝트는 과거 iOS WebKit에서 `getUserMedia` 실시간
 * 미리보기가 불안정해 표지 촬영에서 그 방식을 걷어낸 이력이 있다(`CameraCapture.jsx` 주석).
 * 바코드는 연속 인식이 훨씬 편해서 라이브를 기본으로 쓰되, **카메라를 못 열면 기기 카메라 앱을
 * 그대로 여는 사진 방식으로 자동 전환**한다. 사진 방식은 보안 컨텍스트가 필요 없어 어디서나 된다.
 *
 * `onDetected(isbn)`은 **연속 스캔 중 여러 번** 불릴 수 있다(여러 권 담기).
 * 같은 책을 연달아 잡는 것은 이 컴포넌트가 걸러낸다.
 */
export default function BarcodeScanner({
  onDetected,
  onClose,
  title = "ISBN 바코드 스캔",
  queue = null, // 연속 스캔 모드에서 지금까지 담은 목록 [{ isbn, status, title, error }]
  closeLabel = "완료",
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastCodeRef = useRef({ code: null, at: 0 });
  const trackRef = useRef(null);
  const enginesRef = useRef(null); // { detector, reader }

  const [status, setStatus] = useState("starting"); // starting | live | photo | error
  const [message, setMessage] = useState("카메라를 여는 중...");
  const [lastAccepted, setLastAccepted] = useState(null);
  // 어떤 인식기로 몇 번 훑었는지. **아무 일도 안 일어나는 것처럼 보이는** 상황에서
  // 정말 돌고 있는지 알 수 있어야 한다(제보를 받을 때도 이 숫자가 단서가 된다).
  const [engineName, setEngineName] = useState("");
  const [looks, setLooks] = useState(0);

  // 카메라가 할 수 있는 것들(기기마다 다르다). 못 하는 것은 단추를 아예 띄우지 않는다.
  const [zoomRange, setZoomRange] = useState(null); // { min, max, step }
  const [zoom, setZoom] = useState(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  // 후면 카메라가 여러 개인 기기(폴드·플립 등)에서 바꿔 가며 쓸 수 있게.
  const [cameras, setCameras] = useState([]);
  const [deviceId, setDeviceId] = useState(null);
  // 라이브 카메라를 다시 열어 보게 하는 열쇠. 권한을 허용하고 돌아왔을 때
  // **사진 모드에 갇히지 않도록** 되돌아갈 길을 준다.
  const [retryKey, setRetryKey] = useState(0);

  // 같은 바코드가 초당 수십 번 잡히므로, 직전과 같은 코드는 3초간 무시한다.
  // (연속 스캔에서 같은 책이 여러 번 담기는 것을 막되, 일부러 다시 찍는 것은 허용)
  const accept = useCallback(
    (raw) => {
      const isbn = normalizeIsbn(raw);
      // 체크섬만 보면 과자 봉지 바코드도 통과하므로, 도서 접두사(978/979)까지 확인한다
      if (!isBookBarcode(isbn)) {
        setMessage(`책 바코드가 아닙니다 (${raw}). 뒤표지의 ISBN 바코드를 비춰주세요.`);
        return false;
      }
      const now = Date.now();
      if (lastCodeRef.current.code === isbn && now - lastCodeRef.current.at < 3000) {
        return false;
      }
      lastCodeRef.current = { code: isbn, at: now };
      setLastAccepted(isbn);
      setMessage(`✓ ${isbn} 인식됨`);
      onDetected(isbn);
      return true;
    },
    [onDetected]
  );

  const startPhotoMode = useCallback((reason) => {
    setStatus("photo");
    setMessage(reason);
  }, []);

  /** 내장 인식기와 ZXing을 한 번만 준비해 둔다(사진·라이브가 같이 쓴다). */
  const engines = useCallback(async () => {
    if (!enginesRef.current) {
      const [detector, mod] = await Promise.all([loadNativeDetector(), loadReader()]);
      enginesRef.current = {
        detector,
        reader: new mod.BrowserMultiFormatReader(mod.hints),
      };
    }
    return enginesRef.current;
  }, []);

  // ── 카메라 열기 ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        // ⚠️ 브라우저 탓이 아닌 경우가 대부분이다. 브라우저는 **보안 컨텍스트(HTTPS)** 가
        // 아니면 카메라 API 자체를 제공하지 않는다. 실제로 집 LAN 주소
        // (http://192.168.x.x:8080)로 접속하면 navigator.mediaDevices가 undefined다(실측).
        // 이때 "브라우저가 지원하지 않는다"고 하면 사용자가 폰을 의심하게 되므로,
        // 진짜 원인과 해결책(HTTPS 주소로 접속)을 알려준다.
        startPhotoMode(
          window.isSecureContext
            ? "이 브라우저에서는 실시간 카메라를 쓸 수 없습니다. 사진으로 스캔해주세요."
            : "실시간 스캔은 HTTPS 주소에서만 됩니다. Tailscale 주소(https://…ts.net)로 접속하면 " +
              "카메라로 바로 읽을 수 있습니다. 지금은 사진으로 스캔해주세요."
        );
        return;
      }
      try {
        // 스트림을 **직접** 연다. 예전에는 ZXing의 `decodeFromConstraints`에 맡겼는데,
        // 그러면 ZXing이 화면 전체를 한 번 훑는 것이 전부라 작게 들어온 바코드를 놓쳤다.
        // (사진 경로는 잘라 키워서 읽는데 라이브만 그러지 않아, "사진은 되고 카메라는
        // 안 된다"는 제보가 나왔다 — 2026-09-27.) 이제 프레임은 우리가 훑는다.
        const constraints = {
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : {
                facingMode: { ideal: "environment" },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              },
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.setAttribute("playsinline", "true");
          await v.play().catch(() => {});
        }
        setStatus("live");
        setMessage("책 뒤표지의 바코드를 네모 안에 맞춰주세요.");
        await tuneCamera(cancelled);
      } catch (err) {
        if (cancelled) return;
        // 권한 거부/HTTPS 아님/카메라 없음 등 — 사진 방식으로 안내한다(막다른 길을 만들지 않는다)
        const denied = err?.name === "NotAllowedError";
        // ⚠️ 이유(err.name)를 꼭 남긴다. 예전에는 "카메라를 열 수 없습니다"만 보여 줘서
        //    권한 문제인지 기기 문제인지 물어볼 수가 없었다(제보 한 번에 한 왕복씩 날아간다).
        const why = err?.name ? ` [${err.name}]` : "";
        startPhotoMode(
          denied
            ? "카메라 권한이 거부되었습니다. 사진으로 스캔하거나 브라우저 설정에서 권한을 허용해주세요." + why
            : "카메라를 열 수 없습니다. 사진으로 스캔해주세요." + why
        );
      }
    }

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      trackRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startPhotoMode, deviceId, retryKey]);

  // ── 프레임을 직접 훑는다 ───────────────────────────────────────────────────
  useEffect(() => {
    if (status !== "live") return undefined;
    let stopped = false;
    // 화면에 붙이지 않는 작업용 캔버스 하나를 돌려 쓴다.
    const canvas = document.createElement("canvas");
    let plan = 0;
    let count = 0;

    (async () => {
      const eng = await engines();
      if (stopped) return;
      setEngineName(eng.detector ? "기기 내장(ML)" : "ZXing");

      while (!stopped) {
        const v = videoRef.current;
        // readyState 2 = 현재 프레임이 있다. 카메라가 데워지는 동안은 건너뛴다.
        if (v && v.readyState >= 2 && v.videoWidth > 0) {
          const { ratio, boost } = LIVE_PLAN[plan % LIVE_PLAN.length];
          plan += 1;
          count += 1;
          // 8번에 한 번만 화면 숫자를 고친다 — 매번 고치면 렌더가 인식보다 바빠진다.
          if (count % 8 === 0) setLooks(count);
          try {
            const c = cropSource(v, v.videoWidth, v.videoHeight, ratio, {
              boost,
              maxW: LIVE_MAX_W,
              into: canvas,
            });
            const text = await decodeCanvas(c, eng.detector, eng.reader);
            if (text && !stopped) accept(text);
          } catch {
            /* 이 프레임은 넘긴다 */
          }
        }
        await new Promise((r) => setTimeout(r, LIVE_INTERVAL));
      }
    })();

    return () => {
      stopped = true;
    };
  }, [status, accept, engines]);

  /**
   * 카메라를 바코드 읽기에 맞게 길들인다.
   *
   * **왜 필요한가**: 요즘 큰 폰의 후면 메인 카메라는 **최소 초점 거리가 길다**(10cm 안팎).
   * 책을 가까이 대면 초점이 아예 안 맞아 바코드가 뭉개진다 — 큰 폰(폴더블)에서 "바코드 사진을
   * 찍을 수 없다"는 제보가 이것이었다. **조금 당겨서(zoom) 멀리서 찍게** 하면 초점이 맞는다.
   *
   * 기기마다 되는 것이 달라서 **할 수 있는 것만** 켜고, 못 하는 것은 단추도 띄우지 않는다.
   */
  async function tuneCamera(cancelled) {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    trackRef.current = track;

    const caps = track.getCapabilities?.() ?? {};

    // 초점은 **연속 자동초점**이 기본이어야 한다. 한 번 맞추고 마는 모드면
    // 책을 움직이는 동안 계속 흐려진다.
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
      await applyTrack({ focusMode: "continuous" });
    }

    if (caps.zoom && typeof caps.zoom.min === "number") {
      const range = { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 };
      // 2배쯤 당겨 둔다 — 최소 초점 거리를 피하면서 바코드는 화면을 채운다.
      // 기기가 2배를 못 하면 할 수 있는 범위 안으로 맞춘다.
      const want = Math.min(Math.max(2, range.min), range.max);
      if (!cancelled) {
        setZoomRange(range);
        setZoom(want);
      }
      await applyTrack({ zoom: want });
    }

    if (!cancelled) setHasTorch(Boolean(caps.torch));

    // 후면 카메라가 여럿이면 바꿔 볼 수 있게 목록을 만든다.
    // ⚠️ 라벨은 **권한을 허용한 뒤에만** 채워진다. 그래서 카메라를 연 다음에 훑는다.
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const vids = all.filter((d) => d.kind === "videoinput");
      if (!cancelled && vids.length > 1) setCameras(vids);
    } catch {
      /* 목록을 못 얻어도 스캔 자체에는 지장이 없다 */
    }
  }

  /** 트랙에 설정 하나를 적용한다. 하나가 실패해도 나머지에 영향이 없도록 따로 부른다. */
  async function applyTrack(one) {
    try {
      await trackRef.current?.applyConstraints({ advanced: [one] });
      return true;
    } catch {
      return false;
    }
  }

  async function handleZoom(value) {
    setZoom(value);
    await applyTrack({ zoom: value });
  }

  async function toggleTorch() {
    const next = !torchOn;
    if (await applyTrack({ torch: next })) setTorchOn(next);
  }

  /** 다음 카메라로 돌린다. 폴드·플립은 후면에 여러 개가 있고, 그중 초점이 더 가까운 것이 있다. */
  function nextCamera() {
    if (cameras.length < 2) return;
    const i = cameras.findIndex((c) => c.deviceId === deviceId);
    const next = cameras[(i + 1 + cameras.length) % cameras.length];
    // 상태를 바꾸면 위 useEffect가 카메라를 다시 연다.
    setZoomRange(null);
    setZoom(null);
    setHasTorch(false);
    setTorchOn(false);
    setDeviceId(next.deviceId);
  }

  /**
   * 지금 보이는 화면을 **한 장 붙잡아** 사진과 똑같은 방식으로 읽는다.
   *
   * 연속 인식은 초점이 맞는 순간을 스스로 잡아야 하지만, 이것은 사용자가 "지금이다" 하고
   * 고르는 것이다. 흔들림이 멎은 프레임 하나를 다섯 가지 방법으로 끝까지 파고든다.
   */
  async function grabFrame() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setMessage("붙잡은 화면에서 바코드를 찾는 중...");
    const eng = await engines();
    const attempts = [
      () => cropSource(v, v.videoWidth, v.videoHeight, 1),
      () => cropSource(v, v.videoWidth, v.videoHeight, { w: 0.9, h: 0.45 }),
      () => cropSource(v, v.videoWidth, v.videoHeight, { w: 0.6, h: 0.3 }),
      () => cropSource(v, v.videoWidth, v.videoHeight, { w: 0.9, h: 0.45 }, { boost: true }),
      () => cropSource(v, v.videoWidth, v.videoHeight, 1, { boost: true }),
    ];
    for (const make of attempts) {
      const text = await decodeCanvas(make(), eng.detector, eng.reader);
      if (text) {
        accept(text);
        return;
      }
    }
    setMessage(
      "붙잡은 화면에서도 못 찾았습니다. 바코드가 네모를 가로로 채우도록 거리를 맞추고, " +
        "글자가 또렷해진 뒤에 눌러보세요."
    );
  }

  // 사진 1장에서 바코드를 읽는다(라이브가 안 될 때, 또는 사용자가 직접 선택했을 때).
  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setMessage("사진에서 바코드를 찾는 중...");
    const url = URL.createObjectURL(file);
    try {
      const eng = await engines();
      const text = await decodePhoto(eng, url);
      if (!text) {
        setMessage(
          "사진에서 바코드를 찾지 못했습니다. 카메라 앱에서 2배쯤 당긴 뒤 30cm쯤 떨어져 찍어보세요 — " +
            "요즘 큰 폰은 가까이 대면 오히려 초점이 안 맞습니다."
        );
        return;
      }
      if (!accept(text)) return;
      // 여러 권을 담는 중이면 곧바로 다음 장을 찍게 한다 — 매번 단추를 찾아 누르면
      // 사진 방식으로 열 권을 담는 것이 고역이다.
      if (queue) {
        setTimeout(() => fileInputRef.current?.click(), 600);
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return (
    <div className="barcode-overlay" onClick={onClose}>
      <div className="barcode-box" onClick={(e) => e.stopPropagation()}>
        <div className="barcode-head">
          <h2>{title}</h2>
          <button type="button" className="barcode-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        {status !== "photo" && (
          <div className="barcode-view">
            <video ref={videoRef} className="barcode-video" muted playsInline />
            {/* 바코드를 어디에 맞춰야 하는지 보여주는 가늠자 */}
            <div className="barcode-reticle" aria-hidden="true" />
          </div>
        )}

        {/* 카메라 조작 — **기기가 할 수 있는 것만** 나온다.
            큰 폰은 메인 카메라의 최소 초점 거리가 길어, 가까이 대면 초점이 안 맞는다.
            조금 당겨서 멀리서 비추는 것이 요령이라 줌을 전면에 뒀다. */}
        {status === "live" && (
          <div className="barcode-controls">
            {zoomRange && (
              <label className="barcode-zoom">
                <span className="barcode-zoom-label">🔍 당겨 찍기</span>
                <input
                  type="range"
                  min={zoomRange.min}
                  max={zoomRange.max}
                  step={zoomRange.step}
                  value={zoom ?? zoomRange.min}
                  onChange={(e) => handleZoom(Number(e.target.value))}
                  aria-label="확대"
                />
                <span className="barcode-zoom-value">{(zoom ?? zoomRange.min).toFixed(1)}×</span>
              </label>
            )}
            <div className="barcode-control-btns">
              {/* 연속 인식이 안 잡힐 때 **사람이 순간을 고르는** 길. 사진 방식과 같은
                  다섯 가지 방법을 한 프레임에 모두 써 본다. */}
              <button type="button" className="btn secondary btn-sm" onClick={grabFrame}>
                🎯 지금 화면 읽기
              </button>
              {hasTorch && (
                <button
                  type="button"
                  className={"btn secondary btn-sm" + (torchOn ? " on" : "")}
                  onClick={toggleTorch}
                >
                  {torchOn ? "🔦 불 끄기" : "🔦 불 켜기"}
                </button>
              )}
              {cameras.length > 1 && (
                <button type="button" className="btn secondary btn-sm" onClick={nextCamera}>
                  🔄 다른 카메라
                </button>
              )}
            </div>
          </div>
        )}

        <p className={"barcode-message" + (lastAccepted ? " ok" : "")}>{message}</p>

        {/* 정말 훑고 있는지 보여 준다. 아무 일도 안 일어나는 것처럼 보일 때
            "멈춘 것인지 못 읽는 것인지"를 가릴 수 있어야 한다. */}
        {status === "live" && engineName && (
          <p className="barcode-engine">
            인식기: {engineName} · {looks}회 확인
          </p>
        )}

        {queue && queue.length > 0 && (
          <ul className="barcode-queue">
            {queue.map((item) => (
              <li key={item.isbn}>
                <span className="q-isbn">{item.isbn}</span>
                <span>{item.title || (item.status === "loading" ? "조회 중..." : "")}</span>
                <span className={"q-status" + (item.status === "fail" ? " fail" : "")}>
                  {item.status === "loading" && "⏳"}
                  {item.status === "ok" && "✓"}
                  {item.status === "fail" && (item.error || "찾지 못함")}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="barcode-actions">
          {status === "photo" && (
            /* 권한을 허용하거나 다른 앱이 카메라를 놓아준 뒤 **되돌아올 길**.
               예전에는 한 번 사진 모드로 떨어지면 창을 닫았다 다시 여는 수밖에 없었다. */
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setStatus("starting");
                setMessage("카메라를 여는 중...");
                setRetryKey((k) => k + 1);
              }}
            >
              📷 카메라 다시 시도
            </button>
          )}
          <button
            type="button"
            className="btn secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            🖼 사진으로 스캔
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {queue && queue.length > 0 ? `${closeLabel} (${queue.length}권)` : closeLabel}
          </button>
        </div>

        {/* capture=environment — 기기 카메라 앱을 그대로 연다. 보안 컨텍스트가 필요 없어
            실시간 미리보기가 막히는 환경에서도 동작한다(표지 촬영과 같은 방식). */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={handlePhoto}
        />
      </div>
    </div>
  );
}
