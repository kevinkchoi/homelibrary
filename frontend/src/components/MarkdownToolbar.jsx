import { useEffect, useRef } from "react";
import "./MarkdownToolbar.css";

/**
 * 서평 편집 화면의 **서식 단추**.
 *
 * **왜 필요한가**: 마크다운 표기를 외우게 하면 안 된다. 실제로 `#제목`처럼 칸을 안 띄워
 * 쓰는 바람에 제목이 하나도 안 먹은 일이 있었다(그건 렌더 쪽에서도 눅여 두었지만,
 * 애초에 **올바른 표기를 넣어 주는 편**이 낫다).
 *
 * 누르면 커서 자리(또는 고른 글자)에 표기를 넣는다. 고른 글자가 여러 줄이면 줄마다 붙인다.
 */

// 줄머리에 붙이는 것들 — 고른 범위의 **모든 줄**에 붙는다.
const LINE_ACTIONS = {
  h1: (line) => `# ${line}`,
  h2: (line) => `## ${line}`,
  bullet: (line) => `- ${line}`,
  quote: (line) => `> ${line}`,
};

function applyLinePrefix(text, start, end, fn, numbered) {
  // 고른 글자가 없이(커서만 놓고) 눌렀는지. 그때는 넣어 준 표기를 **선택해 두면 안 된다** —
  // 바로 타자를 치면 방금 넣은 `# `가 지워진다. 커서만 줄 끝에 놓는다.
  const collapsed = start === end;
  // 고른 범위가 걸쳐 있는 줄 전체를 잡는다(줄 한가운데를 골라도 그 줄이 통째로 바뀌게).
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = text.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = text.length;

  const block = text.slice(lineStart, lineEnd);
  const lines = block.split("\n");

  // ⚠️ **빈 줄을 무조건 건너뛰면 안 된다.** 편집칸이 비어 있을 때가 바로 그 경우라,
  //    빈 화면에서 [제목]을 눌러도 아무 일도 일어나지 않았다(iOS 실측). 가장 흔한
  //    첫 동작이 먹통이었다. 여러 줄을 고른 때에만 사이의 빈 줄을 건너뛴다.
  const single = lines.length === 1;
  let n = 0; // 번호는 **붙인 줄만** 센다 — 건너뛴 빈 줄까지 세면 번호가 건너뛴다
  const out = lines
    .map((line) => {
      if (!single && !line.trim()) return line;
      n += 1;
      return numbered ? `${n}. ${line}` : fn(line);
    })
    .join("\n");

  const caret = lineStart + out.length;
  return {
    text: text.slice(0, lineStart) + out + text.slice(lineEnd),
    start: collapsed ? caret : lineStart,
    end: caret,
  };
}

function wrap(text, start, end, marker, placeholder) {
  const selected = text.slice(start, end) || placeholder;
  const inserted = `${marker}${selected}${marker}`;
  return {
    text: text.slice(0, start) + inserted + text.slice(end),
    // 고른 글자가 없었으면 넣어 준 예시 글자를 골라 둔다 — 바로 덮어쓸 수 있게.
    start: start + marker.length,
    end: start + marker.length + selected.length,
  };
}

function insertBlock(text, start, end, block) {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !before.endsWith("\n") ? "\n" : "";
  const tail = after && !after.startsWith("\n") ? "\n" : "";
  const inserted = `${lead}${block}${tail}`;
  return {
    text: before + inserted + after,
    start: before.length + inserted.length,
    end: before.length + inserted.length,
  };
}

const BUTTONS = [
  { key: "h1", label: "제목", hint: "큰 제목 (# )" },
  { key: "h2", label: "소제목", hint: "중간 제목 (## )" },
  { key: "bold", label: "굵게", hint: "**굵게**" },
  { key: "italic", label: "기울임", hint: "*기울임*" },
  { key: "bullet", label: "• 목록", hint: "- 항목" },
  { key: "numbered", label: "1. 목록", hint: "1. 항목" },
  { key: "quote", label: "❝ 인용", hint: "> 인용" },
  { key: "rule", label: "― 구분선", hint: "가로줄" },
];

export default function MarkdownToolbar({ textareaRef, value, onChange }) {
  // 단추를 누른 뒤 커서를 어디에 둘지. **값이 화면에 반영된 뒤에** 놓아야 한다 —
  // `requestAnimationFrame`으로 곧바로 놓으면 리액트가 값을 다시 그리며 커서를 끝으로
  // 밀어 버린다(실측: [굵게]를 빈 선택에서 눌렀을 때 예시 글자가 선택되지 않았다).
  const pendingSelection = useRef(null);

  useEffect(() => {
    const want = pendingSelection.current;
    if (!want) return;
    pendingSelection.current = null;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(want.start, want.end);
  }, [value, textareaRef]);

  function run(key) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;

    let next;
    if (key === "bold") next = wrap(value, start, end, "**", "굵게");
    else if (key === "italic") next = wrap(value, start, end, "*", "기울임");
    else if (key === "rule") next = insertBlock(value, start, end, "***");
    else if (key === "numbered") next = applyLinePrefix(value, start, end, null, true);
    else next = applyLinePrefix(value, start, end, LINE_ACTIONS[key], false);

    pendingSelection.current = { start: next.start, end: next.end };
    onChange(next.text);
  }

  return (
    <div className="md-toolbar" role="toolbar" aria-label="서식">
      {BUTTONS.map((b) => (
        <button
          key={b.key}
          type="button"
          className="md-toolbar-btn"
          title={b.hint}
          /* 단추를 누를 때 입력칸의 선택이 풀리면 어디에 넣을지 알 수 없게 된다.
             mousedown 기본동작(포커스 이동)을 막아 선택을 지킨다. */
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run(b.key)}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
