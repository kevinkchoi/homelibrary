// 빌드 식별자. vite.config.js의 `define`이 빌드 때 실제 값으로 치환한다.
// 화면 우하단에 작게 표시해서 "지금 어느 버전을 보고 있는지"를 바로 확인할 수 있게 한다.
// (PWA 캐시 때문에 옛 버전을 보고 있는 건지 판단할 수 없어 두 번 헤맸다)
export const BUILD_ID = __BUILD_ID__;
