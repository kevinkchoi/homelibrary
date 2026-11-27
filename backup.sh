#!/usr/bin/env bash
# 서버에서 실행하는 전체 백업 스크립트 (배포 전에 돌릴 것).
#
#   ssh <사용자>@<서버> "cd <설치 폴더> && bash backup.sh"
#
# 왜 DB만으로는 부족한가: 책 정보(DB)와 표지 이미지(Docker 볼륨)는 저장 위치가 다르다.
# DB만 백업하면 복구 후 모든 책의 표지가 깨진다. 그래서 둘을 항상 함께 받는다.
#
# 만들어지는 것 (~/backups/homelibrary/<타임스탬프>/):
#   homelibrary-db.dump    pg_dump custom format — 복구용 (pg_restore)
#   homelibrary-db.sql.gz  plain SQL — 사람이 읽고 grep 가능
#   books.csv              books 테이블만 CSV — 엑셀로 바로 열림
#   images.tar.gz          표지 이미지 전체
#   SHA256SUMS             체크섬 (다른 곳으로 옮긴 뒤 대조용)
set -euo pipefail

cd "$(dirname "$0")"

TS=$(date +%Y%m%d-%H%M%S)
# 서비스가 두 벌이라(가족 / 개인 서재) 폴더를 가른다. .env에 BACKUP_NAME이 없으면 예전 그대로.
BACKUP_NAME="$(grep -E '^BACKUP_NAME=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r\n')"
case "$BACKUP_NAME" in
  ""|HomeLibrary) BK="$HOME/backups/homelibrary/$TS" ;;
  *) BK="$HOME/backups/$(echo "$BACKUP_NAME" | tr '[:upper:]' '[:lower:]')/$TS" ;;
esac
mkdir -p "$BK"
echo "백업 위치: $BK"

echo "[1/4] DB 덤프 (복구용, custom format)"
docker compose exec -T homelibrary-db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BK/homelibrary-db.dump"

echo "[2/4] DB 덤프 (plain SQL)"
docker compose exec -T homelibrary-db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$BK/homelibrary-db.sql.gz"

echo "[3/4] books 테이블 CSV"
docker compose exec -T homelibrary-db \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\copy (select * from books order by id) to stdout with csv header"' \
  > "$BK/books.csv"

echo "[4/4] 표지 이미지"
docker compose exec -T homelibrary-api tar -czf - -C /app/storage images > "$BK/images.tar.gz"

( cd "$BK" && sha256sum -- * > SHA256SUMS )

# --- 검증: 백업이 실제로 쓸 수 있는 상태인지 확인한다 ---
echo
echo "=== 검증 ==="
DB_BOOKS=$(docker compose exec -T homelibrary-db \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "select count(*) from books"' < /dev/null | tr -d '[:space:]')
# ⚠️ `wc -l`로 세면 안 된다. **서평에 줄바꿈이 들어가면 한 권이 여러 줄을 차지**하므로
#    줄 수가 권수보다 많아진다(2026-09-27에 실제로 846권을 982로 세어 백업이 "실패"했다.
#    백업물은 멀쩡했고 세는 방법이 틀린 것이었다). CSV 규칙대로 레코드를 세야 한다.
CSV_BOOKS=$(python3 -c '
import csv, sys
with open(sys.argv[1], newline="", encoding="utf-8") as f:
    r = csv.reader(f)
    next(r, None)          # 헤더
    print(sum(1 for _ in r))
' "$BK/books.csv")
echo "책 권수      DB=$DB_BOOKS  CSV=$CSV_BOOKS"
[ "$DB_BOOKS" = "$CSV_BOOKS" ] || { echo "❌ 책 권수 불일치 — 백업을 신뢰하지 말 것"; exit 1; }

docker compose exec -T homelibrary-db pg_restore --list < "$BK/homelibrary-db.dump" > /dev/null \
  && echo "덤프 목차     읽기 OK (pg_restore로 복구 가능)"
gzip -t "$BK/images.tar.gz" && echo "이미지 아카이브 gzip 무결성 OK"

# 볼륨에 있는 파일이 아카이브에 전부 들어갔는지 (여기서 누락이 나오면 백업 실패)
# ⚠️ `comm`은 두 입력이 **정렬 + 고유**해야 집합 연산이 된다. 같은 값이 중복으로 들어 있으면
#    짝을 못 찾은 나머지가 "없는 것"으로 잘못 잡힌다(실제로 이 함정에 한 번 걸렸다 — 표지 파일
#    하나를 두 책이 공유하는 경우를 '파일 없음'으로 오판). 그래서 양쪽 모두 `sort -u`를 쓴다.
docker compose exec -T homelibrary-api \
  sh -c 'cd /app/storage/images && find . -type f | sed "s|^\./||"' < /dev/null | sed '/^$/d' | sort -u > /tmp/hl_live.txt
tar -tzf "$BK/images.tar.gz" | sed 's|^images/||' | grep -v '/$' | sed '/^$/d' | sort -u > /tmp/hl_tar.txt
LIVE=$(wc -l < /tmp/hl_live.txt); MISS=$(comm -23 /tmp/hl_live.txt /tmp/hl_tar.txt | wc -l)
echo "이미지 파일    볼륨=$LIVE  아카이브 누락=$MISS"
[ "$MISS" -eq 0 ] || { echo "❌ 이미지 누락 — 백업을 신뢰하지 말 것"; exit 1; }
rm -f /tmp/hl_live.txt /tmp/hl_tar.txt

echo
echo "✅ 백업 완료 및 검증 통과: $BK"
du -sh "$BK" | awk '{print "   크기: " $1}'
echo
echo "⚠️  이 백업은 서버 디스크에만 있다. 디스크 고장까지 대비하려면 다른 기기로 복사할 것:"
echo "   scp -r <사용자>@<서버>:$BK ~/Backups/homelibrary/"
echo "   (옮긴 뒤: cd <옮긴 폴더> && shasum -a 256 -c SHA256SUMS)"
echo "   ※ users 테이블(이메일·비밀번호 해시)이 들어 있으므로 git에 올리지 말 것."
