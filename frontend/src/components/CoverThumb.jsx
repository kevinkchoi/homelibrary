import { useState } from "react";
import { coverImageUrl } from "../api/books";

/**
 * 표지 썸네일. 표지가 없거나 **파일이 사라져 못 불러오면** 📕 자리표시자로 대체한다.
 *
 * DB에는 경로가 남아 있는데 파일만 없어진 책이 실제로 있었고(실서버 7권), 그때 브라우저
 * 기본 깨진-이미지 아이콘이 떠서 사용자가 원인을 알 수 없었다. 근본 정리는 관리 →
 * 서재 점검에서 하고, 여기서는 어떤 경우든 화면이 깨져 보이지 않게 막는다.
 */
export default function CoverThumb({ path, className = "", placeholderClassName = "", alt = "" }) {
  const [failed, setFailed] = useState(false);

  if (!path || failed) {
    return (
      <span className={`${className} ${placeholderClassName}`.trim()} aria-hidden="true">
        📕
      </span>
    );
  }

  return (
    <img
      className={className}
      src={coverImageUrl(path)}
      alt={alt}
      onError={() => setFailed(true)}
    />
  );
}
