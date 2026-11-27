import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * 책 상세 팝업이 **열려 있는지를 주소(`?book=<id>`)에 싣는다.**
 *
 * **왜 상태가 아니라 주소인가**: 서평을 읽으러 `/books/:id/review`로 갔다가 돌아올 때,
 * 팝업이 컴포넌트 상태면 **되돌아와도 팝업이 사라져** 목록에서 그 책을 다시 찾아야 한다.
 * 폰에서는 이게 특히 답답하다(제보받은 문제). 주소에 실으면 뒤로 가기 한 번으로 제자리다.
 *
 * 덤으로 **안드로이드 뒤로 가기 버튼이 팝업을 닫는다** — 폰 사용자가 기대하는 동작인데
 * 예전에는 앱 밖으로 나가 버렸다.
 *
 * 열 때는 **쌓고**(push) 닫을 때는 **갈아끼운다**(replace).
 * 닫을 때도 쌓으면 뒤로 가기가 방금 닫은 팝업을 다시 열어 버린다.
 */
export default function useSelectedBook() {
  const [params, setParams] = useSearchParams();

  const raw = params.get("book");
  const selectedBookId = raw && /^\d+$/.test(raw) ? Number(raw) : null;

  const select = useCallback(
    (id) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id == null) next.delete("book");
          else next.set("book", String(id));
          return next;
        },
        { replace: id == null }
      );
    },
    [setParams]
  );

  return [selectedBookId, select];
}
