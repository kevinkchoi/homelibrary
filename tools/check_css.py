#!/usr/bin/env python3
"""CSS 중괄호 짝이 맞는지 검사한다.

## 왜 필요한가 (2026-09-27에 실서버를 망가뜨린 사고)

`UpdatePrompt.css`에서 규칙을 손보다 닫는 `}`를 빠뜨렸다. 그러자 **그 뒤의 모든 CSS가
그 규칙 안으로 중첩**됐고, 하필 뒤에 오던 `:root`까지 `.build-badge :root`가 되어
**CSS 변수가 통째로 정의되지 않았다**(`--hdr-h`, `--color-primary`, …).
상단 바 높이가 auto가 되어 표 머리글과 틈이 벌어지고, 단추 색이 사라졌다.

**개발 서버에서는 안 보인다.** Vite dev는 CSS 파일마다 `<style>`을 따로 넣어 주므로
망가진 파일 하나만 영향을 받는다. **운영 빌드는 전부 한 파일로 이어 붙이기 때문에**
그 지점 뒤의 CSS가 전부 죽는다. 그래서 눈으로 보는 확인만으로는 못 잡는다.

사용: python3 tools/check_css.py   (문제가 있으면 종료 코드 1)
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "src"

# 주석 안의 중괄호는 세면 안 된다(주석에 코드 예시를 자주 적는다)
COMMENT = re.compile(r"/\*.*?\*/", re.S)


def check(path: pathlib.Path) -> list[str]:
    text = COMMENT.sub("", path.read_text(encoding="utf-8"))
    depth = 0
    problems = []
    for lineno, line in enumerate(text.splitlines(), 1):
        for ch in line:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth < 0:
                    problems.append(f"{path}:{lineno}: 여는 `{{` 없이 `}}`가 나왔다")
                    depth = 0
    if depth != 0:
        problems.append(f"{path}: 닫히지 않은 `{{`가 {depth}개 있다")
    return problems


def main() -> int:
    files = sorted(ROOT.rglob("*.css"))
    problems = [p for f in files for p in check(f)]
    if problems:
        print("❌ CSS 중괄호 문제:")
        for p in problems:
            print("  ", p)
        return 1
    print(f"✅ CSS {len(files)}개 중괄호 짝 정상")
    return 0


if __name__ == "__main__":
    sys.exit(main())
