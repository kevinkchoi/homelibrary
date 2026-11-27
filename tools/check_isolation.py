#!/usr/bin/env python3
"""개인 서재(personal 모드) **격리 점검** — 실제 /api를 두 사용자로 불러 본다.

    python3 tools/check_isolation.py https://homelibrary.kr <초대코드> [관리자아이디 관리자비밀번호]

사용자 A·B를 새로 가입시키고(초대 코드), A의 책을 B가 **어떤 길로도** 보거나 고치거나 지울 수 없는지
확인한다. 서비스 함수가 아니라 **엔드포인트를 실제로 부른다**(함수는 멀쩡한데
거기까지 가는 길이 다를 수 있다). 관리자 계정을 주면 끝에 시험 계정을 지운다(책·표지도 함께).

⚠️ family 모드 서버에 돌리지 말 것 — 거기는 원래 모두가 같은 서재를 본다.
   (가입이 닫혀 있어 첫 단계에서 멈춘다)

표준 라이브러리만 쓴다(서버 venv 없이 어디서든 돌게).
"""

import base64
import io
import json
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# 8x8 JPEG — 표지 업로드 시험용(Pillow가 읽을 수 있는 진짜 이미지여야 한다)
TINY_JPEG = base64.b64decode("/9j/4AAQSkZJRgABAQAAkACQAAD/4QCARXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAACQAAAAAQAAAJAAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAAigAwAEAAAAAQAAAAgAAAAA/8AAEQgACAAIAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/SPT/Ef7Qd38XZ9DvdNls7XTtYYrKYZmtL3SZpztZZh+5XyoMcfeL9fm4r7Hzq/9yH82/wAKh/5j/wD26/8As9bFfX5hmq/d/uYfCvs/8H+vSyPksuyfWq/bT1k/ten9fju23//Z")

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://localhost:8097"
INVITE = sys.argv[2] if len(sys.argv) > 2 else ""
ADMIN = (sys.argv[3], sys.argv[4]) if len(sys.argv) > 4 else None
API = BASE + "/api"

results: list[tuple[bool, str]] = []


def check(ok: bool, label: str) -> bool:
    results.append((bool(ok), label))
    print(("  ✅ " if ok else "  ❌ ") + label)
    return bool(ok)


def call(method, path, token=None, json_body=None, form=None, files=None, raw=None, ctype=None):
    url = API + path
    # Cloudflare는 파이썬 기본 User-Agent(Python-urllib)를 봇으로 보고 막는다(error 1010).
    headers = {"User-Agent": "Mozilla/5.0 (compatible; HomeLibrary-isolation-check/1.0)"}
    data = None
    if token:
        headers["Authorization"] = "Bearer " + token
    if json_body is not None:
        data = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"
    elif files is not None or form is not None:
        boundary = "----hl" + secrets.token_hex(8)
        buf = io.BytesIO()
        for k, v in (form or {}).items():
            buf.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        for k, (fname, content, mime) in (files or {}).items():
            buf.write(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{fname}"\r\n'
                f"Content-Type: {mime}\r\n\r\n".encode()
            )
            buf.write(content + b"\r\n")
        buf.write(f"--{boundary}--\r\n".encode())
        data = buf.getvalue()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif raw is not None:
        data = raw
        headers["Content-Type"] = ctype or "application/x-www-form-urlencoded"
    # 로그인·가입은 nginx가 접속자별 분당 10회(몰아서 5회)로 막는다. 이 점검은 짧은 시간에 여러 번
    # 가입·로그인하므로 429가 나면 기다렸다 다시 한다(제한이 동작한다는 뜻이지 실패가 아니다).
    for attempt in range(12):
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read()
                status = resp.status
        except urllib.error.HTTPError as e:
            body, status = e.read(), e.code
        if status != 429:
            break
        time.sleep(7)
    try:
        parsed = json.loads(body) if body else None
    except ValueError:
        parsed = body
    return status, parsed


def login(username, password):
    form = urllib.parse.urlencode({"username": username, "password": password}).encode()
    status, body = call("POST", "/auth/login", raw=form)
    return body.get("access_token") if status == 200 else None


def register(username, invite, email=""):
    return call(
        "POST",
        "/auth/register",
        json_body={"username": username, "email": email, "password": "pw-" + username, "invite_code": invite},
    )


def make_book(token, title, isbn, shelf, category, with_cover=False):
    form = {"title": title, "author": "격리시험", "publisher": "시험사", "isbn": isbn,
            "shelf_location": shelf, "category": category}
    files = {"cover_image": ("c.jpg", TINY_JPEG, "image/jpeg")} if with_cover else None
    status, body = call("POST", "/books", token, form=form, files=files or {})
    assert status == 201, (status, body)
    return body


def main() -> int:
    print(f"대상: {API}")
    status, cfg = call("GET", "/auth/config")
    if not check(status == 200 and cfg.get("library_mode") == "personal", f"personal 모드 서버 ({cfg})"):
        return 1

    tag = secrets.token_hex(3)
    ua, ub = f"iso_a_{tag}", f"iso_b_{tag}"

    print("[가입]")
    check(register(f"iso_x_{tag}", "")[0] == 403, "초대 코드 없이 가입 → 403")
    check(register(f"iso_y_{tag}", "틀린코드")[0] == 403, "틀린 초대 코드 → 403")
    sa, _ = register(ua, INVITE, email=f"{ua}@example.org")  # 운영자에게 이메일이 안 보이는지 보려고
    sb, _ = register(ub, INVITE)
    if not check(sa == 201 and sb == 201, "초대 코드로 A·B 가입 → 201"):
        return 1
    ta, tb = login(ua, "pw-" + ua), login(ub, "pw-" + ub)

    print("[A가 책을 넣는다]")
    a_isbn = "9788999999994"  # 체크섬이 맞는 가짜 ISBN(978-89-99999-99-4) — 실제 책 번호를 쓰지 않는다
    a_title = f"A만의비밀책{tag}"
    a_book = make_book(ta, a_title, a_isbn, f"A책꽂이{tag}", f"A분류{tag}", with_cover=True)
    b_book = make_book(tb, f"B의책{tag}", "", f"B책꽂이{tag}", f"B분류{tag}")
    aid, bid = a_book["id"], b_book["id"]
    a_cover = a_book.get("cover_image_path")
    check(bool(a_cover), "A의 책에 표지 파일이 생겼다")

    print("[B는 A의 책을 볼 수 없다]")
    s, body = call("GET", "/books?limit=500", tb)
    ids = {b["id"] for b in body["items"]}
    check(s == 200 and aid not in ids and bid in ids, "목록에 A의 책 없음, 내 책은 있음")
    s, body = call("GET", "/books/search?q=" + urllib.parse.quote(a_title), tb)
    check(s == 200 and body["total"] == 0, "통합검색으로 A의 책 제목 → 0건")
    s, body = call("GET", "/books/search?q=" + a_isbn, tb)
    check(s == 200 and all(b["id"] != aid for b in body["items"]), "ISBN 검색으로도 안 보임")
    s, body = call("GET", f"/books?title={urllib.parse.quote(a_title)}", tb)
    check(s == 200 and body["total"] == 0, "필터(제목)로도 안 보임")
    s, _ = call("GET", f"/books/{aid}", tb)
    check(s == 404, f"번호로 직접 열기 GET /books/{aid} → 404 (403이 아님 — 존재 여부도 숨김)")
    s, body = call("GET", f"/books/check-duplicate?isbn={a_isbn}&title={urllib.parse.quote(a_title)}", tb)
    check(s == 200 and not body["isbn_matches"] and not body["title_matches"], "중복 확인에 A의 책 안 걸림")
    s, body = call("GET", "/books/shelves", tb)
    check(s == 200 and all(r["name"] != f"A책꽂이{tag}" for r in body), "책꽂이 목록에 A의 책꽂이 없음")
    s, body = call("GET", "/books/categories", tb)
    check(s == 200 and all(r["name"] != f"A분류{tag}" for r in body), "카테고리 목록에 A의 분류 없음")
    s, body = call("GET", "/books/duplicates?include_acknowledged=true", tb)
    check(s == 200 and all(b["id"] != aid for g in body["groups"] for b in g["books"]), "서재 점검 중복에 없음")
    s, body = call("GET", "/books/broken-covers", tb)
    check(s == 200 and all(b["id"] != aid for b in body["items"]), "표지 깨진 책 목록에 없음")
    s, raw = call("GET", "/export/csv/list", tb)
    text = raw.decode("utf-8-sig") if isinstance(raw, bytes) else json.dumps(raw)
    check(s == 200 and a_title not in text and f"B의책{tag}" in text, "목록 내보내기(CSV)에 A의 책 없음")

    print("[B는 A의 책을 고치거나 지울 수 없다]")
    s, _ = call("PUT", f"/books/{aid}", tb, form={"title": "탈취", "author": "x", "publisher": "x"}, files={})
    check(s == 404, "PUT /books/{A} → 404")
    s, _ = call("DELETE", f"/books/{aid}", tb)
    check(s == 404, "DELETE /books/{A} → 404")
    call("DELETE", "/books/bulk", tb, json_body={"ids": [aid]})
    s, body = call("POST", "/books/bulk-shelf", tb, json_body={"ids": [aid], "shelf_location": "탈취"})
    check(s == 200 and body["updated"] == 0, "책꽂이 일괄 지정에 A의 번호 → 0권")
    s, body = call("POST", "/books/categories/rename", tb,
                   json_body={"from_name": f"A분류{tag}", "to_name": "탈취"})
    check(s == 200 and body["updated"] == 0, "카테고리 이름 바꾸기가 A의 책에 닿지 않음")
    csv_text = "번호,제목,저자,출판사\n" + f"{aid},탈취됨,x,x\n"
    s, body = call("POST", "/import/csv", tb, files={"file": ("x.csv", csv_text.encode("utf-8"), "text/csv")})
    check(s == 200 and body.get("updated") == 0, f"가져오기에서 번호={aid}(A의 책) → 수정 0, 내 새 책으로 ({body})")
    s, body = call("POST", "/books", tb, form={"title": "표지훔치기", "author": "x", "publisher": "x",
                                               "cover_image_path": a_cover}, files={})
    check(s == 400, "A의 표지 파일 경로를 내 책 표지로 지정 → 400")

    s, body = call("GET", f"/books/{aid}", ta)
    check(s == 200 and body["title"] == a_title and body["shelf_location"] == f"A책꽂이{tag}"
          and body.get("category") == f"A분류{tag}" and body.get("cover_image_path") == a_cover,
          "A가 보면 A의 책은 그대로(제목·책꽂이·분류·표지)")
    s, body = call("GET", "/books?limit=500", ta)
    check(s == 200 and all("표지훔치기" != b["title"] and "탈취됨" != b["title"] for b in body["items"]),
          "B가 만든 책이 A의 서재에 섞이지 않음")

    print("[Claude 기능은 자기 키가 있어야]")
    s, body = call("GET", "/me/ai-key", tb)
    check(s == 200 and body["available"] is False and body["user_key_allowed"] is True, "키 없음 상태")
    s, _ = call("GET", "/recommendations", tb)
    check(s == 403, "키 없이 새책 추천 → 403 (운영자 키로 넘어가지 않음)")
    s, _ = call("POST", "/scan/extract", tb, files={"photo": ("p.jpg", TINY_JPEG, "image/jpeg")})
    check(s == 403, "키 없이 표지 사진 인식 → 403")
    s, _ = call("PUT", "/me/ai-key", tb, json_body={"api_key": "not-a-key"})
    check(s == 400, "형식이 틀린 키 저장 → 400")
    s, _ = call("PUT", "/me/ai-key", tb, json_body={"api_key": "sk-ant-api03-" + "x" * 40})
    check(s == 400, "Claude가 거부하는 키 저장 → 400 (저장 전 실제 확인)")

    print("[운영자 전용]")
    s, _ = call("GET", "/books/unused-images", tb)
    check(s == 403, "일반 사용자의 미사용 이미지 점검 → 403")
    s, _ = call("GET", "/users", tb)
    check(s == 403, "일반 사용자의 사용자 목록 → 403")

    print("[비밀번호 바꾸기]")
    s, _ = call("PUT", "/me/password", tb, json_body={"current_password": "틀림", "new_password": "newpw123"})
    check(s == 400, "지금 비밀번호가 틀리면 400")
    s, _ = call("PUT", "/me/password", tb, json_body={"current_password": "pw-" + ub, "new_password": "newpw123"})
    check(s == 204 and login(ub, "newpw123") and not login(ub, "pw-" + ub), "바꾼 비밀번호로만 로그인")

    print("[환영 안내]")
    s, me = call("GET", "/auth/me", ta)
    check(s == 200 and me.get("welcome_seen_at") is None, "처음 들어온 사람은 환영 안내를 아직 안 봤다")
    s, _ = call("PUT", "/me/welcome-seen", ta)
    s2, me = call("GET", "/auth/me", ta)
    check(s == 204 and me.get("welcome_seen_at"), "환영 안내를 닫으면 서버에 기록된다(다른 기기에서 다시 안 뜸)")

    print("[도서관 공유 — 주인이 멤버를 직접 만든다]")
    s, lib = call("GET", "/library", ta)
    check(s == 200 and lib["my_role"] == "owner" and lib["can_manage"] and len(lib["members"]) == 1,
          "가입하면 자기 도서관의 주인")
    a2, a3 = f"iso_a2_{tag}", f"iso_a3_{tag}"
    s, lib = call("POST", "/library/members", ta, json_body={"username": a2, "password": "pw-" + a2, "role": "editor"})
    check(s == 201 and any(m["username"] == a2 and m["role"] == "editor" for m in lib["members"]), "주인이 편집 멤버를 만든다")
    s, lib = call("POST", "/library/members", ta, json_body={"username": a3, "password": "pw-" + a3, "role": "viewer"})
    check(s == 201, "주인이 보기만 멤버를 만든다")
    ids = {m["username"]: m["id"] for m in lib["members"]}
    t2, t3 = login(a2, "pw-" + a2), login(a3, "pw-" + a3)
    s, body = call("GET", f"/books/{aid}", t2)
    check(s == 200 and body["title"] == a_title, "편집 멤버가 주인의 책을 본다(같은 도서관)")
    a2_book = make_book(t2, f"A2가넣은책{tag}", "", "", "")
    s, body = call("GET", f"/books/{a2_book['id']}", ta)
    check(s == 200, "멤버가 넣은 책을 주인도 본다")
    s, _ = call("PUT", f"/books/{aid}", t2, form={"title": a_title, "author": "격리시험", "publisher": "시험사",
                                                    "shelf_location": f"A책꽂이{tag}", "category": f"A분류{tag}"}, files={})
    check(s == 200, "편집 멤버는 책을 고칠 수 있다")
    s, _ = call("GET", f"/books/{aid}", t3)
    check(s == 200, "보기만 멤버도 책을 본다")
    s, _ = call("PUT", f"/books/{aid}", t3, form={"title": "보기만이고침", "author": "x", "publisher": "x"}, files={})
    check(s == 403, "보기만 멤버는 책을 고칠 수 없다(403)")
    s, _ = call("POST", "/books", t3, form={"title": "보기만추가", "author": "x", "publisher": "x"}, files={})
    check(s == 403, "보기만 멤버는 책을 넣을 수 없다(403)")
    s, _ = call("DELETE", f"/books/{aid}", t3)
    check(s == 403, "보기만 멤버는 책을 지울 수 없다(403)")
    s, _ = call("POST", "/library/members", t2, json_body={"username": f"iso_x2_{tag}", "password": "pw123456"})
    check(s == 403, "편집 멤버는 멤버를 만들 수 없다(주인·공동 관리자만)")
    s, _ = call("GET", f"/books/{a2_book['id']}", tb)
    check(s == 404, "다른 도서관(B)은 멤버가 넣은 책도 못 본다")
    s, _ = call("PUT", f"/library/members/{ids[a2]}/role", tb, json_body={"role": "viewer"})
    check(s in (403, 404), "B는 A 도서관의 멤버를 건드릴 수 없다")
    s, _ = call("PUT", f"/library/members/{ids[a3]}/role", ta, json_body={"role": "owner"})
    check(s == 400, "멤버를 주인으로 만들 수는 없다")
    s, _ = call("PUT", f"/library/members/{ids[a2]}/password", ta, json_body={"password": "reset-pw-1"})
    check(s == 204 and login(a2, "reset-pw-1") and not login(a2, "pw-" + a2), "주인이 멤버 비밀번호를 재설정한다")

    print("[도서관 공유 — 도서관 초대 코드]")
    s, lib = call("POST", "/library/invite-code", ta, json_body={"role": "viewer"})
    code = lib.get("invite_code") if s == 200 else None
    check(bool(code) and code.startswith("lib-") and lib["invite_role"] == "viewer", "주인이 도서관 초대 코드를 만든다")
    s, lib_b = call("GET", "/library", tb)
    check(s == 200 and lib_b.get("invite_code") is None, "다른 도서관 사람에게 A의 코드가 보이지 않는다")
    uc = f"iso_c_{tag}"
    s, _ = register(uc, code)
    tc = login(uc, "pw-" + uc)
    s2, me = call("GET", "/auth/me", tc)
    check(s == 201 and me["library_id"] == lib["id"] and me["library_role"] == "viewer", "코드로 가입하면 그 도서관에 '보기만'으로 들어간다")
    s, _ = call("GET", f"/books/{aid}", tc)
    check(s == 200, "코드로 들어온 사람도 주인의 책을 본다")
    s, lib = call("DELETE", "/library/invite-code", ta)
    s2, _ = register(f"iso_d_{tag}", code)
    check(s == 200 and s2 == 403, "코드를 끄면 그 코드로는 더 가입할 수 없다")
    s, lib = call("DELETE", f"/library/members/{ids[a2]}", ta)
    s2, body = call("GET", f"/books/{a2_book['id']}", ta)
    # (등록자 표시가 비워지는지는 API에 owner_id가 없어 여기서는 볼 수 없다 — library_service.remove_member)
    check(s == 200 and login(a2, "reset-pw-1") is None and s2 == 200,
          "멤버를 빼면 계정은 지워지고 그 사람이 넣은 책은 도서관에 남는다")

    print("[의견 보내기]")
    s, fb = call("POST", "/feedback", tb, json_body={"category": "idea", "body": f"시험 의견 {tag}"})
    check(s == 201 and fb["status"] == "new", "의견을 보낸다")
    s, mine = call("GET", "/feedback/mine", tb)
    check(s == 200 and any(f["id"] == fb["id"] for f in mine), "내가 보낸 의견에 보인다")
    s, mine_a = call("GET", "/feedback/mine", ta)
    check(s == 200 and all(f["id"] != fb["id"] for f in mine_a), "남의 의견은 내 목록에 없다")
    s, _ = call("GET", "/admin/feedback", tb)
    check(s == 403, "일반 사용자는 의견함을 볼 수 없다")
    s, _ = call("GET", "/admin/libraries", ta)
    check(s == 403, "일반 사용자(도서관 주인이라도)는 운영자 화면을 볼 수 없다")

    if ADMIN:
        print("[운영자 — 관리하되 빼가지 못한다]")
        tadm = login(*ADMIN)
        s, libs = call("GET", "/admin/libraries", tadm)
        raw = json.dumps(libs, ensure_ascii=False)
        mine_lib = next((l for l in libs.get("libraries", []) if l["owner_username"] == ua), None) if s == 200 else None
        check(mine_lib is not None and mine_lib["member_count"] == 3 and mine_lib["book_count"] == 2,
              "운영자는 도서관·멤버 수·책 수를 본다")
        check(a_title not in raw and f"{ua}@example.org" not in raw, "운영자 화면에 책 제목·이메일이 없다")
        s, users = call("GET", "/users", tadm)
        check(s == 200 and all(u.get("email") is None for u in users), "운영자 사용자 목록에 이메일이 없다")
        s, _ = call("PUT", f"/users/{me['id']}/password", tadm, json_body={"password": "takeover1"})
        check(s == 403, "운영자는 남의 비밀번호를 바꿀 수 없다(계정 탈취 방지)")
        s, raw_backup = call("GET", f"/admin/backup?library_id={mine_lib['id']}", tadm)
        blob = raw_backup if isinstance(raw_backup, bytes) else json.dumps(raw_backup).encode()
        check(s == 200 and len(blob) > 100 and a_title.encode() not in blob and ua.encode() not in blob
              and b"data.json" not in blob, "백업 파일은 암호화돼 있다(제목·아이디가 보이지 않음)")
        s, items = call("GET", "/admin/feedback", tadm)
        check(s == 200 and any(f["id"] == fb["id"] for f in items), "운영자 의견함에 들어왔다")
        s, _ = call("PUT", f"/admin/feedback/{fb['id']}", tadm, json_body={"status": "reviewing", "admin_reply": "검토하겠습니다"})
        s2, mine = call("GET", "/feedback/mine", tb)
        check(s == 200 and any(f["id"] == fb["id"] and f["admin_reply"] == "검토하겠습니다" and f["status"] == "reviewing"
                               for f in mine), "운영자 답이 보낸 사람에게 보인다")
        s, _ = call("DELETE", f"/admin/libraries/{mine_lib['id']}", tadm)
        check(s == 204 and login(ua, "pw-" + ua) is None and login(uc, "pw-" + uc) is None,
              "운영자가 말썽 도서관을 지우면 멤버 모두 로그인 불가")
        s, res = call("POST", "/admin/restore", tadm, files={"file": ("b.hlbak", blob, "application/octet-stream")})
        ta2 = login(ua, "pw-" + ua)
        s2, body = call("GET", "/books?limit=500", ta2) if ta2 else (0, {})
        titles = {b["title"] for b in body.get("items", [])} if s2 == 200 else set()
        check(s == 200 and res["books"] == 2 and ta2 and a_title in titles, "암호화 백업으로 도서관이 되돌아온다(주인 로그인·책)")
        s2, body = call("GET", "/books?limit=500", ta2) if ta2 else (0, {})
        cover_ok = any(b.get("cover_image_path") == a_cover for b in body.get("items", [])) if s2 == 200 else False
        check(cover_ok, "표지도 되돌아온다")
        s, _ = call("POST", "/admin/restore", tadm, files={"file": ("x.hlbak", b"not a backup", "application/octet-stream")})
        check(s == 400, "이 서버의 백업이 아닌 파일은 거절")

        print("[정리: 시험 계정 삭제]")
        tadm = login(*ADMIN)
        s, users = call("GET", "/users", tadm)
        for u in users if s == 200 else []:
            if u["username"].startswith("iso_") and u["username"].endswith(tag):
                call("DELETE", f"/users/{u['id']}", tadm)
        s, users = call("GET", "/users", tadm)
        check(s == 200 and not any(u["username"].endswith(tag) for u in users), "시험 계정 삭제됨")
        check(login(ua, "pw-" + ua) is None, "삭제된 A로 로그인 불가")

    failed = [label for ok, label in results if not ok]
    print(f"\n결과: {len(results) - len(failed)}/{len(results)} 통과")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
