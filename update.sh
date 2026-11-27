#!/usr/bin/env bash
# HomeLibrary 서버 업데이트 스크립트
# GitHub의 최신 버전과 비교하여 변경이 있으면 pull 후 Docker 재빌드
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== HomeLibrary 업데이트 확인 ($(date '+%Y-%m-%d %H:%M:%S')) ==="

# 최신 정보 가져오기
git fetch origin main --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "✅ 이미 최신 버전입니다."
  echo "   커밋: $(git log -1 --format='%h %s')"
  exit 0
fi

echo "🔄 새 버전 발견:"
echo "   현재: $(git log -1 --format='%h %s' HEAD)"
echo "   최신: $(git log -1 --format='%h %s' origin/main)"
echo ""
echo "변경 내역:"
git log --oneline HEAD..origin/main
echo ""

# 변경된 파일 목록으로 어떤 컨테이너를 재빌드할지 판단
CHANGED_FILES=$(git diff --name-only HEAD origin/main)
REBUILD_API=false
REBUILD_WEB=false

if echo "$CHANGED_FILES" | grep -q '^backend/'; then
  REBUILD_API=true
fi
if echo "$CHANGED_FILES" | grep -qE '^(frontend/|docker-compose\.yml|nginx\.conf)'; then
  REBUILD_WEB=true
fi
if echo "$CHANGED_FILES" | grep -q '^docker-compose\.yml'; then
  REBUILD_API=true
  REBUILD_WEB=true
fi

# 변경 없으면 둘 다 재빌드 (안전 기본값)
if [ "$REBUILD_API" = false ] && [ "$REBUILD_WEB" = false ]; then
  REBUILD_API=true
  REBUILD_WEB=true
fi

# Pull
echo "📥 업데이트 중..."
git pull origin main

# Docker 재빌드
TARGETS=""
if [ "$REBUILD_API" = true ]; then TARGETS="$TARGETS homelibrary-api"; fi
if [ "$REBUILD_WEB" = true ]; then TARGETS="$TARGETS homelibrary-web"; fi

echo "🐳 Docker 재빌드: $TARGETS"
docker compose up -d --build $TARGETS

echo ""
echo "✅ 업데이트 완료!"
echo "   현재 버전: $(git log -1 --format='%h %s')"
