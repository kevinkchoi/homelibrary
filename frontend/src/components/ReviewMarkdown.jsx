import { Suspense, lazy, useEffect, useState } from "react";
import { forgivingMarkdown } from "../utils/forgivingMarkdown.js";
import "./ReviewMarkdown.css";

/**
 * 서평을 마크다운으로 그린다.
 *
 * **왜 lazy인가**: `react-markdown` + `remark-gfm`은 주 번들을 눈에 띄게 불린다.
 * 서평 보기는 **책 한 권을 열어 본 뒤에야** 필요한 화면이라, 첫 화면(목록)이 그 무게를
 * 질 이유가 없다. 여기서만 따로 받아 온다.
 *
 * **왜 `dangerouslySetInnerHTML`을 쓰지 않는가**: `react-markdown`은 HTML 문자열을
 * 만들지 않고 React 요소로 바로 그린다. 서평은 사람이 직접 쓰는 글이지만, 붙여넣기로
 * 어떤 것이 들어올지 알 수 없으므로 **문자열을 HTML로 삼키는 경로를 아예 두지 않는다.**
 */
const Markdown = lazy(() => import("react-markdown"));

/**
 * ⚠️ `remark-breaks`가 **꼭 필요하다.**
 *
 * 마크다운은 원래 **한 번의 줄바꿈을 무시한다** — 이어진 줄들을 한 문단으로 합친다.
 * 그런데 이 앱의 서평은 마크다운을 알기 전부터 쓰이고 있었고, 실제로 들어 있는 글
 * (만 자가 넘는 긴 서평)은 **빈 줄 없이 줄바꿈만으로** 문단을 나눠 놨다.
 * 그대로 그리면 사람이 나눠 쓴 줄이 **통째로 한 덩어리로 뭉갠다.**
 * `remark-breaks`는 줄바꿈 하나를 그대로 줄바꿈으로 그려, 옛 글과 새 마크다운을
 * 둘 다 제대로 보여 준다(깃허브 댓글이 쓰는 방식과 같다).
 */
const pluginsPromise = Promise.all([import("remark-gfm"), import("remark-breaks")]);

function RichMarkdown({ children }) {
  const [plugins, setPlugins] = useState([]);
  useEffect(() => {
    let alive = true;
    pluginsPromise.then(([gfm, breaks]) => alive && setPlugins([gfm.default, breaks.default]));
    return () => {
      alive = false;
    };
  }, []);
  // 플러그인이 아직 안 왔으면 잠깐 기본 마크다운으로 그린다 — 깜빡임이 한 프레임 있지만
  // 아무것도 안 보이는 것보다 낫다.
  return <Markdown remarkPlugins={plugins}>{children}</Markdown>;
}

export default function ReviewMarkdown({ text }) {
  if (!text || !text.trim()) {
    return <p className="review-md-empty">아직 적은 서평이 없습니다.</p>;
  }
  return (
    <div className="review-md">
      <Suspense fallback={<p className="review-md-loading">서평을 여는 중...</p>}>
        {/* 저장된 글은 그대로 두고, **그리는 순간에만** 사람이 쓰는 표기를 눅여 준다
            (`#제목`처럼 칸을 안 띄운 제목, `**항목`처럼 적은 글머리표). */}
        <RichMarkdown>{forgivingMarkdown(text)}</RichMarkdown>
      </Suspense>
    </div>
  );
}
