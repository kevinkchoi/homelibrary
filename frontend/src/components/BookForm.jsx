import { useEffect, useId, useState } from "react";
import { REVIEW_SAVED_MESSAGE } from "../constants.js";
import useBusyWhile from "../hooks/useBusyWhile.js";
import ImageUploader from "./ImageUploader.jsx";
import CoverPicker from "./CoverPicker.jsx";
import DuplicateWarning from "./DuplicateWarning.jsx";
import BarcodeScanner from "./BarcodeScanner.jsx";
import CategoryInput from "./CategoryInput.jsx";
import { checkDuplicate, coverImageUrl, fetchCoverCandidates, listShelves, lookupIsbn } from "../api/books";
import "./BookForm.css";

// 책꽂이 목록은 폼마다 따로 부르면 안 된다 — 스캔 검토 화면은 BookForm을 **사진 수만큼**
// 띄우므로 그대로 두면 한 화면에서 열 번씩 같은 요청이 나간다. 한 번만 불러 나눠 쓴다.
let shelvesPromise = null;
function loadShelves() {
  if (!shelvesPromise) {
    shelvesPromise = listShelves()
      .then((rows) => rows.map((r) => r.name).filter(Boolean))
      .catch(() => []); // 목록을 못 받아도 직접 입력하면 되므로 조용히 넘어간다
  }
  return shelvesPromise;
}

const SOURCE_LABELS = {
  aladin: "알라딘",
  kakao: "카카오 책",
  google_books: "Google Books",
  kyobo: "교보문고",
  amazon: "Amazon",
  web: "웹 이미지",
};

const EMPTY = {
  title: "",
  author: "",
  publisher: "",
  pub_year: "",
  shelf_location: "",
  category: "",
  isbn: "",
  translator: "",
  original_publisher: "",
  original_pub_year: "",
  comment: "",
};

export default function BookForm({
  initialValues,
  initialCoverImagePath,
  coverCandidates, // 스캔 검토 화면에서만 전달: { photoPath, webPath }
  allowCoverSearch = false, // 제목/저자로 인터넷에서 표지를 찾아 고를 수 있게 할지
  allowIsbnLookup = false, // ISBN을 입력해 책 정보 전체를 가져올 수 있게 할지(새책 추가 시)
  checkDuplicates = false, // 저장 전에 "이미 서재에 있는 책"인지 확인할지
  // 새책 추가처럼 "ISBN부터 찍고 시작하는" 화면에서는 ISBN 입력을 폼 **맨 위로** 올린다.
  // 폼 중간(스크롤 700px 아래)에 두면 폰에서는 기능이 있는 줄도 모른다 — 실제 제보를 받았다.
  prominentIsbnEntry = false,
  excludeDuplicateId = null, // 수정 화면에서 자기 자신을 중복으로 잡지 않도록 제외할 책 id
  // 이미 저장된 책이면 그 id. [외부 에디터]로 서평 전용 창을 열 때 쓴다.
  // 새책 추가처럼 아직 id가 없는 화면에서는 null이고, 그때는 단추를 감춘다.
  bookId = null,
  onSubmit,
  submitLabel = "저장",
  onCancel,
}) {
  // 이미 쓰고 있는 책꽂이 이름을 골라 넣을 수 있게 한다. 손으로 칠 때마다 오타가 나면
  // "거실 책장"과 "거실책장"가 따로 생겨 필터가 갈라진다.
  const shelfListId = useId();
  const [shelfOptions, setShelfOptions] = useState([]);
  useEffect(() => {
    let alive = true;
    loadShelves().then((names) => {
      if (alive) setShelfOptions(names);
    });
    return () => {
      alive = false;
    };
  }, []);

  const [fields, setFields] = useState(() => {
    const merged = { ...EMPTY };
    Object.keys(EMPTY).forEach((key) => {
      if (initialValues?.[key] !== undefined && initialValues[key] !== null) {
        merged[key] = initialValues[key];
      }
    });
    return merged;
  });
  // 외부 에디터 창이 서평을 저장하면 이 칸도 즉시 맞춘다.
  // 이게 없으면 이 폼이 들고 있던 **옛 서평을 그대로 다시 저장해 덮어쓴다.**
  useEffect(() => {
    if (!bookId) return undefined;
    function onMessage(e) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== REVIEW_SAVED_MESSAGE) return;
      if (String(e.data.bookId) !== String(bookId)) return;
      setFields((prev) => ({ ...prev, comment: e.data.comment }));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bookId]);

  // 폼이 떠 있는 동안에는 새 버전을 조용히 반영하지 않는다 — 새로고침되면 입력하던
  // 내용이 통째로 날아간다. (새책 추가·상세 수정·스캔 검토가 모두 이 폼을 쓴다)
  useBusyWhile(true);

  const [coverFile, setCoverFile] = useState(null);
  const [customPreviewUrl, setCustomPreviewUrl] = useState(null);
  const [coverImagePath, setCoverImagePath] = useState(initialCoverImagePath || null);
  const [removeImage, setRemoveImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [isbnLoading, setIsbnLoading] = useState(false);
  const [isbnMessage, setIsbnMessage] = useState("");
  const [scanningBarcode, setScanningBarcode] = useState(false);
  const [duplicates, setDuplicates] = useState(null); // check-duplicate 응답 (없으면 null)
  // 경고를 보여주고 저장을 **막고 있는** 상태인지. ISBN 조회 직후처럼 미리 알려주기만 할 때는 false.
  const [duplicateBlocking, setDuplicateBlocking] = useState(false);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);

  useEffect(() => {
    if (!coverFile) {
      setCustomPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(coverFile);
    setCustomPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  function update(key, value) {
    setFields((prev) => ({ ...prev, [key]: value }));
    // 책을 특정하는 필드가 바뀌면 직전 중복 판단(과 "그래도 추가" 확인)은 다른 책에 대한 것이 된다
    if (key === "title" || key === "author" || key === "isbn") {
      setDuplicates(null);
      setDuplicateBlocking(false);
      setDuplicateAcknowledged(false);
    }
  }

  function handleFileSelected(file) {
    setCoverFile(file);
    if (file) setRemoveImage(false);
  }

  function handleRemoveExisting() {
    setRemoveImage(true);
    setCoverFile(null);
    setCoverImagePath(null);
  }

  function handleSelectCandidate(path, meta) {
    setCoverFile(null);
    setRemoveImage(false);
    setCoverImagePath(path);
    // 인터넷에서 찾은 표지를 고르면, 그 판(edition)의 서지정보로 폼을 채운다.
    // (여러 판이 섞여 나오므로 — 예: PUF판 vs 재판 — 고른 판에 맞는 정보가 정확하다)
    applyMetadata(meta);
  }

  /** 이미 등록된 같은 책이 있는지 확인한다. blocking=true면 저장을 멈추고 사용자 확인을 받는다. */
  async function runDuplicateCheck(values, { blocking }) {
    const result = await checkDuplicate({
      isbn: values.isbn,
      title: values.title,
      author: values.author,
      excludeId: excludeDuplicateId,
    });
    const found = result.isbn_matches.length + result.title_matches.length > 0;
    setDuplicates(found ? result : null);
    setDuplicateBlocking(found && blocking);
    return found;
  }

  async function saveBook() {
    setError("");
    setSubmitting(true);
    try {
      await onSubmit(fields, {
        coverFile,
        coverImagePath: coverFile ? null : coverImagePath,
        removeImage,
      });
    } catch (err) {
      setError(err.response?.data?.detail || "저장 중 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (checkDuplicates && !duplicateAcknowledged) {
      setSubmitting(true);
      try {
        if (await runDuplicateCheck(fields, { blocking: true })) {
          return; // 경고를 띄우고 사용자 확인을 기다린다
        }
      } catch {
        // 중복 확인이 실패했다고 등록 자체를 막을 이유는 없다 — 그냥 저장으로 넘어간다
      } finally {
        setSubmitting(false);
      }
    }

    await saveBook();
  }

  // 경고를 보고도 추가하겠다고 한 경우. 다시 물어보지 않도록 확인 상태를 남기고 그대로 저장한다.
  function handleDuplicateConfirm() {
    setDuplicateAcknowledged(true);
    setDuplicates(null);
    setDuplicateBlocking(false);
    saveBook();
  }

  // 스캔 검토 화면(coverCandidates 전달됨)에서는 사진 인식이 정보를 **틀리게** 채웠을 수 있으므로,
  // 표지 검색으로 찾은 올바른 서지정보로 출판사·연도·카테고리·번역자를 **덮어쓴다**.
  // 반대로 이미 등록된 책의 수정/직접입력 화면에서는 사용자가 넣은 값을 존중해 **빈 칸만** 채운다.
  const overwriteMode = Boolean(coverCandidates);

  // 찾은 서지 정보로 폼을 채운다. 제목/저자는 사용자가 방금 고쳐 넣은 값이라 비었을 때만 채운다.
  function applyMetadata(metadata) {
    if (!metadata) return;
    const hasVal = (v) => v !== null && v !== undefined && v !== "";
    setFields((prev) => {
      const next = { ...prev };
      ["title", "author"].forEach((key) => {
        if (!hasVal(next[key]) && hasVal(metadata[key])) next[key] = metadata[key];
      });
      ["publisher", "pub_year", "category", "translator", "isbn"].forEach((key) => {
        if (!hasVal(metadata[key])) return;
        if (overwriteMode || !hasVal(next[key])) next[key] = metadata[key];
      });
      return next;
    });
  }

  // 인터넷에서 표지 후보를 찾아 CoverPicker가 쓰는 형태로 변환.
  // 저장 전 화면의 제목/저자 값을 그대로 쓰기 때문에, 방금 제목을 고쳐 넣은 경우에도 바로 검색된다.
  async function handleSearchCovers() {
    const title = fields.title.trim();
    const author = fields.author.trim();
    if (!title && !author) {
      const err = new Error("no-query");
      err.info = "표지를 찾으려면 먼저 제목이나 저자를 입력해주세요.";
      throw err;
    }
    const { candidates, metadata } = await fetchCoverCandidates({
      title: title || author,
      author: title ? author : "",
      limit: 8,
    });
    // 검색 직후엔 가장 관련도 높은 결과로 우선 보완하고, 사용자가 특정 표지를 고르면(handleSelectCandidate)
    // 그 판의 정보로 다시 정확히 채운다.
    applyMetadata(metadata);
    return candidates.map((candidate) => ({
      key: candidate.image_path,
      path: candidate.image_path,
      label: SOURCE_LABELS[candidate.source] || "인터넷에서 찾은 표지",
      sub: [candidate.title, candidate.publisher].filter(Boolean).join(" · "),
      meta: {
        title: candidate.title,
        author: candidate.author,
        translator: candidate.translator,
        publisher: candidate.publisher,
        pub_year: candidate.pub_year,
        category: candidate.category,
        isbn: candidate.isbn,
      },
    }));
  }

  // ISBN을 입력해 책 정보 전체(표지 포함)를 가져온다. 사용자가 명시적으로 요청한 조회라
  // 기존 입력값이 있어도 찾은 값으로 덮어쓴다(빈 칸만 채우는 표지검색과 다름).
  // `scannedIsbn`을 받는 이유: 바코드로 방금 읽은 값은 setFields가 비동기라 아직 `fields.isbn`에
  // 반영돼 있지 않다. 그 값을 직접 넘겨야 스캔 → 조회가 한 번에 이어진다.
  async function handleIsbnLookup(scannedIsbn) {
    const isbn = (scannedIsbn || fields.isbn || "").trim();
    if (!isbn) {
      setIsbnMessage("ISBN을 입력한 뒤 눌러주세요.");
      return;
    }
    setIsbnLoading(true);
    setIsbnMessage("");
    try {
      const data = await lookupIsbn(isbn);

      // ⚠️ 서지정보 조회 성공 여부와 **무관하게** 중복부터 확인한다.
      // ISBN은 이미 확정된 값이고(바코드로 읽었거나 사용자가 입력했고 서버가 형식을 검증했다),
      // "이 책 이미 집에 있다"는 알림은 인터넷 조회가 실패해도 줄 수 있어야 한다.
      // 특히 바코드 연속 스캔에서는 이게 가장 중요한 신호다.
      if (checkDuplicates) {
        runDuplicateCheck(
          {
            isbn: data.isbn || isbn,
            title: data.title || fields.title,
            author: data.author || fields.author,
          },
          { blocking: false }
        ).catch(() => {});
      }

      if (!data.found) {
        setIsbnMessage(
          "이 ISBN으로 책 정보를 찾지 못했습니다. 번호를 확인하거나 직접 입력해주세요."
        );
        return;
      }
      const hasVal = (v) => v !== null && v !== undefined && v !== "";
      setFields((prev) => {
        const next = { ...prev };
        ["title", "author", "translator", "publisher", "pub_year", "category", "isbn"].forEach((key) => {
          if (hasVal(data[key])) next[key] = data[key];
        });
        return next;
      });
      if (data.cover_image_path) {
        setCoverFile(null);
        setRemoveImage(false);
        setCoverImagePath(data.cover_image_path);
      }
      setIsbnMessage(`✓ "${data.title || ""}" 정보를 가져왔습니다.`);
    } catch (err) {
      setIsbnMessage(
        err?.response?.data?.detail || "정보를 가져오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
      );
    } finally {
      setIsbnLoading(false);
    }
  }

  // 바코드로 ISBN을 읽으면 입력칸을 채우고 **곧바로 조회까지** 이어간다(탭 한 번으로 끝나게).
  function handleBarcodeDetected(isbn) {
    setScanningBarcode(false);
    update("isbn", isbn);
    handleIsbnLookup(isbn);
  }

  const baseCandidates = [];
  if (coverCandidates?.photoPath) {
    baseCandidates.push({ key: "photo", path: coverCandidates.photoPath, label: "내 사진" });
  }
  if (coverCandidates?.webPath) {
    baseCandidates.push({ key: "web", path: coverCandidates.webPath, label: "인터넷에서 찾은 이미지" });
  }
  if (!coverCandidates && initialCoverImagePath) {
    baseCandidates.push({ key: "current", path: initialCoverImagePath, label: "현재 표지" });
  }

  const usePicker = Boolean(coverCandidates) || allowCoverSearch;

  // ISBN 입력 한 벌. 화면에 따라 폼 맨 위(prominentIsbnEntry) 또는 원래 자리(그리드 안)에 넣는다.
  // 입력칸이 두 개가 되지 않도록 **같은 JSX를 위치만 바꿔** 쓴다.
  const isbnField = (
    <label className="isbn-field">
      ISBN
      <div className="isbn-row">
        <input
          value={fields.isbn}
          onChange={(e) => update("isbn", e.target.value)}
          placeholder="예: 9788901234567"
          inputMode="numeric"
        />
        {allowIsbnLookup && (
          <>
            {/* 바코드 스캔: 책 뒤표지를 비추면 ISBN이 채워지고 정보 조회까지 자동으로 이어진다 */}
            <button
              type="button"
              className="btn"
              onClick={() => setScanningBarcode(true)}
              disabled={isbnLoading}
              title="카메라로 ISBN 바코드 스캔"
            >
              📷 바코드 스캔
            </button>
            <button
              type="button"
              className="btn secondary"
              // 화살표 함수로 감싸야 한다 — 그냥 넘기면 클릭 이벤트가 첫 인자로 들어가
              // 스캔한 ISBN 자리를 차지해 버린다
              onClick={() => handleIsbnLookup()}
              disabled={isbnLoading}
            >
              {isbnLoading ? "가져오는 중..." : "📥 가져오기"}
            </button>
          </>
        )}
      </div>
      {isbnMessage && <span className="isbn-message">{isbnMessage}</span>}
    </label>
  );

  return (
    <form className="book-form" onSubmit={handleSubmit}>
      {error && <p className="form-error">{error}</p>}

      {scanningBarcode && (
        <BarcodeScanner
          onDetected={handleBarcodeDetected}
          onClose={() => setScanningBarcode(false)}
        />
      )}

      {duplicates && (
        <DuplicateWarning
          result={duplicates}
          busy={submitting}
          // 저장을 막고 있을 때만 진행/닫기 버튼을 낸다(ISBN 조회 직후 알림에는 버튼이 필요 없다)
          onConfirm={duplicateBlocking ? handleDuplicateConfirm : undefined}
          onDismiss={() => {
            setDuplicates(null);
            setDuplicateBlocking(false);
          }}
        />
      )}

      {prominentIsbnEntry && (
        <div className="isbn-quick">
          <p className="isbn-quick-title">📖 바코드로 빠르게 채우기</p>
          <p className="isbn-quick-desc">
            책 뒤표지의 바코드를 스캔하면 제목·저자·출판사·표지까지 자동으로 채워집니다.
            바코드가 없는 책은 아래에 직접 입력하세요.
          </p>
          {isbnField}
        </div>
      )}

      {usePicker ? (
        <CoverPicker
          baseCandidates={baseCandidates}
          currentUrl={coverFile ? customPreviewUrl : coverImageUrl(coverImagePath)}
          selectedPath={coverFile ? null : coverImagePath}
          onSearch={allowCoverSearch ? handleSearchCovers : undefined}
          onSelect={(path, meta) => handleSelectCandidate(path, meta)}
          onFileSelected={handleFileSelected}
          onRemove={handleRemoveExisting}
          editablePath={coverCandidates?.photoPath || null}
          onEdited={handleFileSelected}
        />
      ) : (
        <ImageUploader
          existingUrl={coverFile ? null : coverImageUrl(coverImagePath)}
          onFileSelected={handleFileSelected}
          onRemoveExisting={handleRemoveExisting}
        />
      )}

      <div className="form-grid">
        <label>
          제목 *
          <input value={fields.title} onChange={(e) => update("title", e.target.value)} required />
        </label>
        <label>
          저자 *
          <input value={fields.author} onChange={(e) => update("author", e.target.value)} required />
        </label>
        <label>
          출판사 *
          <input value={fields.publisher} onChange={(e) => update("publisher", e.target.value)} required />
        </label>
        <label>
          출판연도
          <input
            type="number"
            value={fields.pub_year}
            onChange={(e) => update("pub_year", e.target.value)}
          />
        </label>
        <label htmlFor="book-category">
          카테고리
          <CategoryInput
            id="book-category"
            value={fields.category}
            onChange={(v) => update("category", v)}
          />
        </label>
        {!prominentIsbnEntry && isbnField}
        <label>
          책꽂이 위치
          <input
            value={fields.shelf_location}
            onChange={(e) => update("shelf_location", e.target.value)}
            list={shelfListId}
          />
          <datalist id={shelfListId}>
            {shelfOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <label>
          번역자
          <input value={fields.translator} onChange={(e) => update("translator", e.target.value)} />
        </label>
        <label>
          원서 출판사
          <input
            value={fields.original_publisher}
            onChange={(e) => update("original_publisher", e.target.value)}
          />
        </label>
        <label>
          원서 출판연도
          <input
            type="number"
            value={fields.original_pub_year}
            onChange={(e) => update("original_pub_year", e.target.value)}
          />
        </label>
      </div>

      <label className="comment-field">
        <span className="comment-field-head">
          <span className="comment-field-title">
            서평
            {/* 긴 글은 이 좁은 칸보다 전용 화면이 낫다. 마크다운 미리보기도 거기 있다.
                아직 저장 전인 새 책은 id가 없어 열 수 없으므로 단추를 감춘다. */}
            {bookId && (
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={() =>
                  window.open(
                    `/books/${bookId}/review?edit=1`,
                    `hl-review-${bookId}`,
                    "width=860,height=900"
                  )
                }
                title="마크다운으로 길게 쓰는 전용 창을 엽니다"
              >
                ✎ 외부 에디터
              </button>
            )}
          </span>
          {/* A4 1~2쪽(대략 1,500~3,000자)을 적는 칸이다. 얼마나 썼는지 보이지 않으면
              "이만큼 적어도 되나" 싶어 손이 멈춘다. 글자수를 세어 보여준다. */}
          <span className="comment-count">
            {fields.comment ? `${fields.comment.length.toLocaleString()}자` : "읽고 난 생각을 적어 두세요"}
          </span>
        </span>
        <textarea
          className="comment-input"
          rows={14}
          value={fields.comment}
          onChange={(e) => update("comment", e.target.value)}
          placeholder="독후감·서평을 자유롭게 적으세요. 줄바꿈과 문단이 그대로 보관됩니다."
        />
      </label>

      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn secondary" onClick={onCancel}>
            취소
          </button>
        )}
        <button type="submit" className="btn" disabled={submitting || duplicateBlocking}>
          {submitting ? "저장 중..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
