#!/usr/bin/env python3
"""운영 빌드(dist)를 그대로 띄우고 /api 만 실서버로 넘기는 **개발용** 서버.

    cd frontend && npm run build
    python3 tools/serve_dist.py frontend/dist 8099 http://<서버>:8080

왜 필요한가: `npm run dev`는 CSS를 파일마다 <style>로 따로 넣지만 운영 빌드는 **한 파일로
이어 붙인다.** 한 파일의 문법 오류가 뒤 파일을 전부 죽이는 사고가 dev에서는 재현되지 않는다
(2026-09-27에 실제로 당했다 — `:root`가 통째로 사라져 운영 화면이 깨져 있었다).
그래서 화면 확인은 반드시 dist로 한다.

이 파일은 원래 세션 임시 폴더에 두었다가 매번 사라져서 다시 만들곤 했는데, 다시 만들 때마다
아래 세 군데서 똑같이 걸려서 **저장소로 옮겼다.**

⚠️ 개발 전용이다. 운영에는 nginx가 쓰인다(frontend/nginx.conf). `/__devlogin`은 여기에만
   있는 통로이며 운영 번들에는 존재하지 않는다.
"""
import os, sys, urllib.parse, urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

# 다시 만들 때마다 밟았던 함정 셋 — 아래 주석 위치에 각각 대응한다.
#  (1) ThreadingHTTPServer 여야 한다 (단일 스레드면 화면이 통째로 빈다)
#  (2) /assets/ 는 SPA 폴백에서 제외해야 한다 (404 대신 index.html을 주면 모듈 로딩 실패)
#  (3) HTTP 상태줄(reason phrase)에 한글을 쓰면 latin-1 인코딩에서 서버가 터진다

DIST = sys.argv[1]
PORT = int(sys.argv[2])
UPSTREAM = sys.argv[3].rstrip("/")


class Handler(SimpleHTTPRequestHandler):
    # 기본값은 HTTP/1.0이라 요청마다 연결을 끊는다. 1.1로 올려 두면 워커 설치처럼
    # 파일을 잇달아 받는 경우에 유리하다.
    # (참고: 데스크톱 브라우저 창에서는 서비스워커 등록이 아예 막혀 있어 여기서는
    #  워커 동작을 시험할 수 없다 — iOS 시뮬레이터나 실기기로 볼 것.)
    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIST, **kw)

    def log_message(self, *a):
        pass

    def _proxy(self, body=None):
        url = UPSTREAM + self.path
        req = urllib.request.Request(url, data=body, method=self.command)
        for h in ("Authorization", "Content-Type", "Accept"):
            if h in self.headers:
                req.add_header(h, self.headers[h])
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
                self.send_response(r.status)
                for k, v in r.headers.items():
                    if k.lower() in ("content-type", "content-length"):
                        self.send_header(k, v)
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_response(502)
            self.end_headers()
            self.wfile.write(str(e).encode())

    def do_GET(self):
        if self.path.startswith("/__probe"):
            html = """<!doctype html><meta charset=utf-8>
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<style>
 :root{--st:env(safe-area-inset-top,0px);--sb:env(safe-area-inset-bottom,0px);
       --sl:env(safe-area-inset-left,0px);--sr:env(safe-area-inset-right,0px)}
 body{margin:0;font:14px/1.5 system-ui;background:#fff}
 .bar{position:sticky;top:0;height:57px;background:#2c5f8a;color:#fff;
      display:flex;align-items:center;padding-left:12px}
 #out{padding:12px;white-space:pre;font-family:ui-monospace,monospace;font-size:13px}
 .safe{position:fixed;top:0;left:0;right:0;height:var(--st);background:rgba(255,0,0,.35)}
</style>
<div class="safe"></div>
<div class="bar">\uc0c1\ub2e8 \ubc14 (sticky, 57px)</div>
<div id="out">\uc7ac\ub294 \uc911...</div>
<script>
 var cs=getComputedStyle(document.documentElement);
 var bar=document.querySelector('.bar').getBoundingClientRect();
 document.getElementById('out').textContent=[
  'safe-area-inset-top    = '+cs.getPropertyValue('--st').trim(),
  'safe-area-inset-bottom = '+cs.getPropertyValue('--sb').trim(),
  'safe-area-inset-left   = '+cs.getPropertyValue('--sl').trim(),
  'safe-area-inset-right  = '+cs.getPropertyValue('--sr').trim(),
  '',
  'innerWidth x innerHeight = '+innerWidth+' x '+innerHeight,
  'documentElement.clientH  = '+document.documentElement.clientHeight,
  'screen.height            = '+screen.height,
  'devicePixelRatio         = '+devicePixelRatio,
  'visualViewport           = '+(visualViewport?visualViewport.width+' x '+visualViewport.height:'-'),
  '',
  '.bar top = '+bar.top+'  height = '+bar.height,
 ].join('\\n');
</script>"""
            body = html.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/__devlogin"):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            tok = q.get("token", [""])[0]
            user = q.get("user", ["admin"])[0]
            html = f"""<!doctype html><meta charset=utf-8><script>
localStorage.setItem("hl_token", {tok!r});
localStorage.setItem("hl_user", JSON.stringify({{id:3,username:{user!r},email:"x@example.com",is_admin:true,created_at:"2026-08-01T15:02:59Z"}}));
location.replace("/");
</script>로그인 중..."""
            body = html.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/api"):
            return self._proxy()
        # SPA: 파일이 없으면 index.html — 단, **자산 경로는 제외한다.**
        # /assets/... 까지 index.html로 돌려주면 브라우저가 "JS인 줄 알았는데 text/html"
        # 이라며 모듈 로딩에 실패하고 **화면이 통째로 빈다.** 빌드를 다시 해서 파일 이름이
        # 바뀌었는데 브라우저가 옛 index.html을 캐시하고 있을 때 실제로 이 꼴이 났다.
        p = self.path.split("?")[0].lstrip("/")
        if p.startswith("assets/") and not os.path.exists(os.path.join(DIST, p)):
            self.send_error(404, "asset not found (rebuilt?)")
            return
        if p and not os.path.exists(os.path.join(DIST, p)):
            self.path = "/index.html"
        return super().do_GET()

    def end_headers(self):
        # 재빌드가 잦으므로 옛 index.html을 물고 있지 않게 한다.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        return self._proxy(self.rfile.read(n) if n else None)


# ⚠️ 반드시 Threading 이어야 한다. 단일 스레드 HTTPServer 로 두면 WebView가 여는
#    동시 연결(JS·CSS·이미지)에 막혀 **화면이 통째로 빈다**. 실제로 한 번 당했다.
ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
