#!/usr/bin/env bash
# Teste de fumaça da API do TV Beladona.
# Sobe o servidor (se ainda não estiver no ar), exercita as rotas principais e mostra PASS/FAIL.
#
# Uso:
#   npm test                      # usa http://localhost:3000 e senha "beladona"
#   BASE=https://sua.url npm test # testa um servidor já publicado (Fly, Codespaces, etc.)
set -u

BASE="${BASE:-http://localhost:3000}"
PASS="${PANEL_PASSWORD:-beladona}"
JAR="$(mktemp)"
FAILS=0
STARTED_PID=""

pass() { printf "  \033[32mPASS\033[0m %s\n" "$1"; }
fail() { printf "  \033[31mFAIL\033[0m %s\n" "$1"; FAILS=$((FAILS+1)); }

cleanup() { [ -n "$STARTED_PID" ] && kill "$STARTED_PID" 2>/dev/null; rm -f "$JAR"; }
trap cleanup EXIT

# Sobe o servidor localmente se o BASE for local e ninguém responder.
if [[ "$BASE" == http://localhost* ]] && ! curl -s -o /dev/null "$BASE/login.html"; then
  echo "Servidor não está no ar — subindo em segundo plano..."
  PANEL_PASSWORD="$PASS" node server.js >/tmp/tvbeladona-test.log 2>&1 &
  STARTED_PID=$!
  for _ in $(seq 1 20); do curl -s -o /dev/null "$BASE/login.html" && break; sleep 0.3; done
fi

echo "Testando: $BASE"

# 1. Rota protegida sem login deve redirecionar (302).
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/")
[ "$code" = "302" ] && pass "GET / sem login → 302 (redireciona p/ login)" || fail "GET / esperado 302, veio $code"

# 2. Login com senha errada → 401.
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" -d '{"password":"errada"}')
[ "$code" = "401" ] && pass "login senha errada → 401" || fail "login errado esperado 401, veio $code"

# 3. Login correto → grava cookie de sessão.
body=$(curl -s -c "$JAR" -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" -d "{\"password\":\"$PASS\"}")
echo "$body" | grep -q '"ok":true' && pass "login senha correta → ok" || fail "login correto falhou: $body"

# 4. Listar telas autenticado → 200 + JSON.
body=$(curl -s -b "$JAR" "$BASE/api/screens")
echo "$body" | grep -q '"screens"' && pass "GET /api/screens (autenticado) → ok" || fail "screens falhou: $body"

# 5. Criar uma tela de teste.
body=$(curl -s -b "$JAR" -X POST "$BASE/api/screens" \
  -H "Content-Type: application/json" -d '{"code":"TESTE-01","name":"Tela de teste"}')
echo "$body" | grep -qE '"ok":true|"codigo ja existe"' && pass "POST /api/screens (criar tela) → ok" || fail "criar tela falhou: $body"

# 6. Playlist pública dessa tela → 200.
body=$(curl -s "$BASE/api/playlist?device=TESTE-01")
echo "$body" | grep -q '"device":"TESTE-01"' && pass "GET /api/playlist?device=TESTE-01 → ok" || fail "playlist falhou: $body"

# 7. Heartbeat público dessa tela → ok.
body=$(curl -s -X POST "$BASE/api/heartbeat" \
  -H "Content-Type: application/json" -d '{"device":"TESTE-01","nowPlaying":"teste","appVersion":1,"storageFreeMb":5000,"itemsCached":0}')
echo "$body" | grep -q '"ok":true' && pass "POST /api/heartbeat → ok" || fail "heartbeat falhou: $body"

# 8. Player público → 200.
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/player")
[ "$code" = "200" ] && pass "GET /player (público) → 200" || fail "player esperado 200, veio $code"

# 9. Limpeza: remove a tela de teste.
curl -s -b "$JAR" -X DELETE "$BASE/api/screens/TESTE-01" >/dev/null

echo
if [ "$FAILS" -eq 0 ]; then
  printf "\033[32mTodos os testes passaram ✅\033[0m\n"; exit 0
else
  printf "\033[31m%d teste(s) falharam ❌\033[0m\n" "$FAILS"; exit 1
fi
