import { useEffect, useState } from "react";

/**
 * 값이 잠잠해질 때까지 기다렸다가 반영한다.
 *
 * 필터 입력처럼 "타이핑 한 글자마다 서버를 부르던" 자리에 쓴다. 입력창 자체는 즉시 반응해야
 * 하므로(입력이 끊기면 안 됨) 원본 state는 그대로 두고, **API에 넘길 값만** 이 훅으로 늦춘다.
 */
export default function useDebouncedValue(value, delay = 400) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
