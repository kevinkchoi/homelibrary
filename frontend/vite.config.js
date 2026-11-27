import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// 빌드 시각(한국시간 기준 MMDD-HHmm)을 버전 식별자로 쓴다. 화면 우하단에 작게 표시되며,
// "지금 보고 있는 게 방금 배포한 버전인지"를 눈으로 바로 확인하는 용도다.
const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString(); // 2026-09-26T12:45:00.000Z
const BUILD_ID = `${kst.slice(5, 7)}${kst.slice(8, 10)}-${kst.slice(11, 13)}${kst.slice(14, 16)}`;

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    VitePWA({
      // prompt: 새 버전이 있으면 배너로 알리고 **사용자가 누를 때** 갱신한다.
      // autoUpdate(자동 새로고침)는 책을 입력하던 중에 화면이 날아갈 수 있어 쓰지 않는다.
      registerType: "prompt",
      // 등록 코드는 UpdatePrompt.jsx가 virtual:pwa-register로 직접 하므로 자동 주입을 끈다.
      // (자동 주입본은 '등록만' 하고 갱신 확인을 안 해서 옛 버전에 계속 머물렀다)
      injectRegister: null,
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "Home Library",
        short_name: "Home Library",
        description: "우리 집 책 목록을 관리하는 개인 도서관 앱",
        start_url: "/",
        display: "standalone",
        background_color: "#f5f7fa",
        theme_color: "#2c5f8a",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/api\/images\//,
            handler: "CacheFirst",
            options: { cacheName: "hl-cover-images", expiration: { maxEntries: 300 } },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
