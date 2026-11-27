// 화면 사이에 공유되는 localStorage 키. 홈과 책찾기가 같은 키를 쓰기 때문에
// 한쪽에서 [100권]을 고르면 다른 쪽에도 적용된다(사용자 입장에선 하나의 설정).
export const VIEW_MODE_KEY = "libraryViewMode";
export const PAGE_SIZE_KEY = "libraryPageSize";

export const DEFAULT_PAGE_SIZE = 50;

// 필터 입력이 잠잠해질 때까지 기다리는 시간(ms). 글자마다 서버를 부르지 않기 위한 값.
export const FILTER_DEBOUNCE_MS = 400;

// 서평 전용 창(`/books/:id/review`)이 저장한 뒤, 자기를 연 창에 보내는 메시지 종류.
// 이게 없으면 열어 둔 [내용 업데이트] 폼이 **옛 서평을 그대로 다시 저장해 덮어쓴다.**
export const REVIEW_SAVED_MESSAGE = "hl:review-saved";
