import { useState } from "react";
import "./BookFilterBar.css";

const FIELDS = [
  { key: "title", label: "제목" },
  { key: "author", label: "저자" },
  { key: "publisher", label: "출판사" },
  { key: "category", label: "카테고리" },
];

const EMPTY = { title: "", author: "", publisher: "", category: "", shelf: [] };

// 책꽂이가 비어 있는 책을 고르는 값. 서버는 **빈 문자열**을 "미지정"으로 읽는다
// (`?shelf=`). 이름으로는 NULL을 표현할 수 없어서 이렇게 정했다.
const UNSET = "";
const UNSET_LABEL = "미지정";

/**
 * 책 목록 필터 — 기본은 **한 줄**, 오른쪽 세모로 펼친다.
 *
 * 예전에는 입력칸 4개가 늘 펼쳐져 있어 폰 첫 화면의 상당 부분을 먹었다.
 * 목록을 보려고 들어온 것이지 필터를 채우려고 온 게 아니므로 접어 두는 쪽이 맞다.
 *
 * **접혀 있어도 걸린 필터는 칩으로 보여준다.** 안 그러면 왜 책이 몇 권만 보이는지
 * 모른 채 헤매게 된다. 칩의 ✕로 하나씩 지울 수 있다.
 *
 * 화면 폭에 따라 다르게 굴지 **않는다.** 예전에는 폰에서만 접혔는데, 폭마다 동작이
 * 갈리면 "홈에서만 이상하다" 같은 문제를 만들고 실제로 그랬다.
 */
export default function BookFilterBar({ filters, onChange, shelves = [] }) {
  const [expanded, setExpanded] = useState(false);

  function update(key, value) {
    onChange({ ...filters, [key]: value });
  }

  const pickedShelves = filters.shelf || [];

  /** 책꽂이 칩 하나를 켜고 끈다. 여러 곳을 동시에 고를 수 있다(OR). */
  function toggleShelf(name) {
    const next = pickedShelves.includes(name)
      ? pickedShelves.filter((v) => v !== name)
      : [...pickedShelves, name];
    update("shelf", next);
  }

  const active = FIELDS.filter((f) => (filters[f.key] || "").trim());

  // 접힌 줄은 한 줄이라 칩이 많으면 잘린다. **잘린 칩은 그 ✕를 누를 수 없어** 지울 방법이
  // 사라진다(책꽂이 이름이 길어서 실제로 두 개째부터 잘렸다). 잘린 채로 두는 대신
  // 앞의 두 개만 보이고 나머지는 `+N`으로 셈해 둔다. 펼치면 전부 줄바꿈되어 보인다.
  const allChips = [
    ...pickedShelves.map((name) => ({ kind: "shelf", key: "shelf:" + name, name })),
    ...active.map((f) => ({ kind: "field", key: f.key, field: f })),
  ];
  const COLLAPSED_CHIP_LIMIT = 2;
  const shownChips = expanded ? allChips : allChips.slice(0, COLLAPSED_CHIP_LIMIT);
  const hiddenChipCount = allChips.length - shownChips.length;

  return (
    <div className={"filter-bar" + (expanded ? " open" : "")}>
      <button
        type="button"
        className="filter-top"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="filter-label">🔎 필터</span>

        {allChips.length > 0 ? (
          <span className="filter-chips">
            {shownChips.map((c) =>
              c.kind === "shelf" ? (
                <span className="filter-chip" key={c.key}>
                  <span className="filter-chip-text">
                    <b>책꽂이</b> {c.name === UNSET ? UNSET_LABEL : c.name}
                  </span>
                  <span
                    className="filter-chip-x"
                    role="button"
                    tabIndex={0}
                    aria-label={`책꽂이 ${c.name === UNSET ? UNSET_LABEL : c.name} 필터 지우기`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleShelf(c.name);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        e.preventDefault();
                        toggleShelf(c.name);
                      }
                    }}
                  >
                    ✕
                  </span>
                </span>
              ) : (
                <span className="filter-chip" key={c.key}>
                  <span className="filter-chip-text">
                    <b>{c.field.label}</b> {filters[c.field.key].trim()}
                  </span>
                  {/* 칩 안의 ✕는 **그 칸만** 지운다. 부모 버튼이 펼침을 토글하므로
                      stopPropagation이 없으면 지우면서 메뉴가 같이 열린다. */}
                  <span
                    className="filter-chip-x"
                    role="button"
                    tabIndex={0}
                    aria-label={`${c.field.label} 필터 지우기`}
                    onClick={(e) => {
                      e.stopPropagation();
                      update(c.field.key, "");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        e.preventDefault();
                        update(c.field.key, "");
                      }
                    }}
                  >
                    ✕
                  </span>
                </span>
              )
            )}
            {hiddenChipCount > 0 && (
              <span className="filter-chip filter-chip-more">+{hiddenChipCount}</span>
            )}
          </span>
        ) : (
          <span className="filter-none">제목·저자·출판사·카테고리·책꽂이로 거르기</span>
        )}

        <span className="filter-caret" aria-hidden="true">
          ▼
        </span>
      </button>

      <div className="filter-fields">
        {FIELDS.map((f) => (
          <input
            key={f.key}
            placeholder={f.label}
            value={filters[f.key] || ""}
            onChange={(e) => update(f.key, e.target.value)}
          />
        ))}
        <button className="filter-reset" type="button" onClick={() => onChange({ ...EMPTY })}>
          필터 초기화
        </button>
      </div>

      {/* 책꽂이는 값이 몇 개 안 되고 사람이 외워 치기 어려운 이름이라(띄어쓰기·사람 이름)
          입력칸보다 **눌러 고르는 편**이 맞다. 여러 곳을 동시에 고를 수 있다. */}
      {shelves.length > 0 && (
        <div className="filter-shelves">
          <div className="filter-shelves-head">
            <span>책꽂이</span>
            {pickedShelves.length > 0 && (
              <button type="button" className="filter-shelf-clear" onClick={() => update("shelf", [])}>
                책꽂이 선택 해제
              </button>
            )}
          </div>
          <div className="filter-shelf-list">
            {shelves.map((sh) => {
              const value = sh.name ?? UNSET;
              const on = pickedShelves.includes(value);
              return (
                <button
                  type="button"
                  key={value || "__unset__"}
                  className={"filter-shelf" + (on ? " on" : "")}
                  aria-pressed={on}
                  onClick={() => toggleShelf(value)}
                >
                  {sh.name ?? UNSET_LABEL}
                  <span className="filter-shelf-count">{sh.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
