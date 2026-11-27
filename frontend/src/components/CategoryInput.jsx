import { useEffect, useRef, useState } from "react";
import { fetchCategories } from "../api/books";
import "./CategoryInput.css";

const SEPARATOR = ", ";

// 백엔드 category_service.split_categories 와 같은 규칙. 저장할 때 서버가 다시 정리하므로
// 여기서는 "지금 무엇이 들어 있는가"를 보여주기 위한 용도다.
export function splitCategories(value) {
  if (!value) return [];
  const out = [];
  const seen = new Set();
  for (const part of value.split(",")) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

// 이미 받아온 목록을 컴포넌트 밖에 둔다. 책을 연달아 등록할 때(바코드 스캔 등) 폼이 매번
// 새로 뜨는데, 그때마다 빈 목록에서 시작하면 "고를 수 있다"는 걸 알아채기 어렵다.
// 캐시를 먼저 보여주고 뒤에서 조용히 새로 받아 갱신한다.
let cached = null;
let inflight = null;

// 사진 일괄 스캔 화면은 사진 수만큼 BookForm을 **한꺼번에** 띄운다(20장이면 20개).
// 각자 목록을 받아오면 똑같은 요청이 20번 나가므로, 진행 중인 요청 하나를 같이 쓴다.
function loadCategories() {
  if (!inflight) {
    inflight = fetchCategories()
      .then((rows) => {
        // name이 null인 줄은 '분류 없음'을 뜻하므로 고를 대상이 아니다
        cached = rows.filter((r) => r.name);
        return cached;
      })
      .finally(() => {
        inflight = null; // 다음에 폼을 열면 새 권수로 다시 받는다
      });
  }
  return inflight;
}

/**
 * 카테고리 입력칸. **여러 개를 콤마로 이어** 넣을 수 있고(`"소설, 프랑스, 고전"`),
 * 직접 타이핑해도 되고 쓰고 있는 분류에서 골라도 된다.
 *
 * `select`가 아니라 입력칸인 이유: 새 분류를 못 만들게 되면 안 되기 때문.
 * 손으로만 쓰게 두면 "에세이"와 "에세이 " 같은 분류가 계속 늘어난다(845권에 234종까지 갔다).
 */
export default function CategoryInput({ value, onChange, id }) {
  const [options, setOptions] = useState(cached || []);
  const [open, setOpen] = useState(false);
  // 목록을 어떻게 열었는지. "all"=▾를 눌러 전부 보려는 것, "filter"=타이핑 중이라 추려 보는 것.
  // 구분하지 않으면, 이미 카테고리가 적힌 책을 수정할 때 ▾를 눌러도 (적힌 값과 정확히 같은
  // 항목 하나만 남아) 아무것도 안 뜬다 — 분류를 바꾸려는 순간에 목록이 사라지는 셈이다.
  const [mode, setMode] = useState("filter");
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    loadCategories()
      .then((list) => {
        if (alive) setOptions(list);
      })
      .catch(() => {
        // 목록을 못 받아와도 직접 입력은 그대로 되어야 한다 — 조용히 넘어간다
      });
    return () => {
      alive = false;
    };
  }, []);

  // 바깥을 누르면 닫는다. 목록이 열린 채로 다른 칸을 만지면 가려 버리기 때문.
  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const chosen = splitCategories(value);
  const chosenKeys = new Set(chosen.map((n) => n.toLowerCase()));

  // 여러 개를 넣는 칸이므로 **마지막 콤마 뒤에 치고 있는 조각**만 검색어로 본다.
  // 전체를 검색어로 쓰면 "소설, 프" 를 친 순간 아무것도 안 걸린다.
  const raw = value || "";
  const lastComma = raw.lastIndexOf(",");
  const typing = raw.slice(lastComma + 1).trim().toLowerCase();

  // 이미 고른 건 목록에서 뺀다 — 같은 걸 두 번 넣을 일은 없다
  const available = options.filter((o) => !chosenKeys.has(o.name.toLowerCase()));
  const shown =
    mode === "filter" && typing
      ? available.filter((o) => o.name.toLowerCase().includes(typing))
      : available;

  /** 치고 있던 조각을 고른 이름으로 바꾸고, 바로 다음 것을 이어 넣을 수 있게 콤마를 붙인다. */
  function pick(name) {
    const kept = raw.slice(0, lastComma + 1); // 마지막 콤마까지(없으면 "")
    const next = splitCategories(kept + name);
    onChange(next.join(SEPARATOR) + SEPARATOR);
    setMode("filter");
    inputRef.current?.focus();
  }

  function remove(name) {
    onChange(chosen.filter((n) => n !== name).join(SEPARATOR));
    inputRef.current?.focus();
  }

  /** 칸을 벗어나면 `"소설, "` 처럼 남은 꼬리 콤마를 정리한다(저장 시 서버도 정리하지만
   *  화면에 미완성인 채로 남아 있으면 헷갈린다). */
  function tidy() {
    const next = chosen.join(SEPARATOR);
    if (next !== raw) onChange(next);
  }

  return (
    <div className="category-input" ref={boxRef}>
      <div className="category-input-row">
        <input
          id={id}
          ref={inputRef}
          value={raw}
          onChange={(e) => {
            onChange(e.target.value);
            setMode("filter");
            setOpen(true);
          }}
          onFocus={() => {
            setMode("filter");
            setOpen(true);
          }}
          onBlur={tidy}
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) {
              e.preventDefault(); // 목록만 닫고 폼이 닫히지는 않게
              setOpen(false);
            }
          }}
          placeholder="소설, 프랑스 — 콤마로 여러 개"
          autoComplete="off"
        />
        <button
          type="button"
          className="category-toggle"
          onClick={() => {
            setMode("all");
            setOpen((v) => !(v && mode === "all")); // 추려 보던 중에 누르면 전체 목록으로 바뀐다
          }}
          aria-label="쓰고 있는 분류 목록"
          title="쓰고 있는 분류에서 고르기"
        >
          ▾
        </button>
      </div>

      {chosen.length > 0 && (
        <ul className="category-chips">
          {chosen.map((name, i) => (
            <li key={name} className={i === 0 ? "first" : ""}>
              <span title={i === 0 ? "정렬은 첫 번째 카테고리로 합니다" : undefined}>{name}</span>
              <button type="button" onClick={() => remove(name)} aria-label={`${name} 빼기`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && shown.length > 0 && (
        <ul className="category-options">
          {shown.map((o) => (
            <li key={o.name}>
              <button
                type="button"
                // 누르면 input이 먼저 blur되면서 목록이 사라져 클릭이 빈 곳에 떨어진다.
                // mousedown을 막아 포커스를 그대로 두면 클릭이 제대로 들어온다.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o.name)}
              >
                <span className="category-name">{o.name}</span>
                <span className="category-count">{o.count}권</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && mode === "filter" && typing && shown.length === 0 && (
        <p className="category-new">
          쓰고 있는 분류에는 없습니다 — 이대로 저장하면 새 분류가 됩니다.
        </p>
      )}
    </div>
  );
}
