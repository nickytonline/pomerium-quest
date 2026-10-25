#!/usr/bin/env bash
# End-to-end checks against a running ./quest deployment: signs players in through Pomerium and
# the Oracle with curl, then checks every zone policy and the stale-claims lesson.
set -uo pipefail

PORT="${QUEST_PORT:-443}"
DOMAIN="${QUEST_DOMAIN:-localhost.pomerium.io}"
SUFFIX=""
[ "$PORT" = 443 ] || SUFFIX=":${PORT}"
GAME="https://game.${DOMAIN}${SUFFIX}"
ORACLE="https://oracle.${DOMAIN}${SUFFIX}"
JAR_DIR="$(mktemp -d)"
JSON='accept: application/json'
RUN="$(date +%s)"
failures=0

check() {
  local name="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  \033[32m✓\033[0m %s (%s)\n' "$name" "$got"
  else
    printf '  \033[31m✗\033[0m %s: want %s, got %s\n' "$name" "$want" "$got"
    failures=$((failures + 1))
  fi
}

status() { curl -s -o /dev/null -w '%{http_code}' -b "$1" -H "$JSON" -X "${3:-GET}" "${GAME}$2"; }

sign_in() {
  local jar="$1" email="$2" page action
  page="$(curl -s -L -c "$jar" -b "$jar" "${GAME}/zones/oracle/signin")"
  action="$(printf '%s' "$page" | grep -o 'action="[^"]*"' | head -1 | sed 's/action="//;s/"$//')"
  [ -n "$action" ] || { echo "  could not find the Oracle sign-in form"; return 1; }
  curl -s -L -c "$jar" -b "$jar" -o /dev/null -w '%{url_effective}' --data-urlencode "email=${email}" "${ORACLE}${action}"
}

echo "Anonymous"
anon="${JAR_DIR}/anon"
check "game shell is public" 200 "$(curl -s -o /dev/null -w '%{http_code}' "${GAME}/")"
check "fields needs a session" 401 "$(status "$anon" /zones/fields/enter)"

echo "Citizen"
citizen="${JAR_DIR}/citizen"
email="e2e-${RUN}@kingdom.com"
check "sign-in lands back in the game" "${GAME}/?signedin=1" "$(sign_in "$citizen" "$email")"
check "app verified Pomerium's JWT" "$email" \
  "$(curl -s -b "$citizen" -H "$JSON" "${GAME}/zones/oracle/" | grep -o "\"email\":\"[^\"]*\"" | head -1 | cut -d'"' -f4)"
check "fields" 200 "$(status "$citizen" /zones/fields/enter)"
check "town (domain is kingdom.com)" 200 "$(status "$citizen" /zones/town/enter)"
check "armory without knights" 403 "$(status "$citizen" /zones/armory/enter)"
check "library read (GET)" 200 "$(status "$citizen" /zones/library/books/0)"
check "library write (POST)" 403 "$(status "$citizen" /zones/library/ledger POST)"

echo "Knighthood"
check "Captain knights the player" 200 "$(status "$citizen" /zones/guild/knight POST)"
check "armory still refuses (session holds old claims)" 403 "$(status "$citizen" /zones/armory/enter)"
check "sign-out returns straight to sign-in" "${GAME}/?signedin=1" \
  "$(curl -s -L -c "$citizen" -b "$citizen" -o /dev/null -w '%{url_effective}' "${GAME}/.pomerium/sign_out")"
armory=403
for _ in $(seq 1 45); do
  armory="$(status "$citizen" /zones/armory/enter)"
  [ "$armory" = 200 ] && break
  sleep 2
done
check "armory opens once Pomerium sees the new claim" 200 "$armory"

echo "Outsider"
outsider="${JAR_DIR}/outsider"
sign_in "$outsider" "wanderer-${RUN}@outlands.net" >/dev/null
check "fields (any signed-in user)" 200 "$(status "$outsider" /zones/fields/enter)"
check "town (wrong domain)" 403 "$(status "$outsider" /zones/town/enter)"

echo
if [ "$failures" -eq 0 ]; then echo "All checks passed."; else echo "${failures} check(s) failed."; fi
exit "$failures"
