#!/usr/bin/env bash
# End-to-end checks against a running ./quest deployment: signs players up and in through Pomerium
# and the Oracle (Keycloak) with curl, then checks every zone policy and the stale-claims lesson.
set -uo pipefail

PORT="${QUEST_PORT:-443}"
DOMAIN="${QUEST_DOMAIN:-localhost.pomerium.io}"
KINGDOM="${QUEST_KINGDOM_DOMAIN:-kingdom.com}"
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

PASSWORD="e2e-${RUN}-pass"

# The first form on a Keycloak page: its action, with HTML entities undone.
form_action() { grep -o 'action="[^"]*"' | head -1 | sed 's/action="//;s/"$//;s/&amp;/\&/g'; }

# Starts a sign-in through Pomerium and prints the Oracle's sign-in page.
sign_in_page() { curl -s -L -c "$1" -b "$1" "${GAME}/zones/oracle/signin"; }

# Signs a new player up from the Oracle's sign-in page; prints where the browser lands.
sign_up() {
  local jar="$1" email="$2" link action
  link="$(sign_in_page "$jar" | grep -o 'href="[^"]*registration[^"]*"' | head -1 | sed 's/href="//;s/"$//;s/&amp;/\&/g')"
  [ -n "$link" ] || { echo "  could not find the Oracle's sign-up link"; return 1; }
  action="$(curl -s -L -c "$jar" -b "$jar" "${ORACLE}${link}" | form_action)"
  [ -n "$action" ] || { echo "  could not find the Oracle's sign-up form"; return 1; }
  curl -s -L -c "$jar" -b "$jar" -o /dev/null -w '%{url_effective}' --data-urlencode "email=${email}" \
    --data-urlencode "password=${PASSWORD}" --data-urlencode "password-confirm=${PASSWORD}" "$action"
}

# Signs an existing player in, given the sign-in page the browser is on; prints where it lands.
sign_in_from() {
  local jar="$1" email="$2" page="$3" action
  action="$(printf '%s' "$page" | form_action)"
  [ -n "$action" ] || { echo "  could not find the Oracle's sign-in form"; return 1; }
  curl -s -L -c "$jar" -b "$jar" -o /dev/null -w '%{url_effective}' --data-urlencode "username=${email}" \
    --data-urlencode "password=${PASSWORD}" "$action"
}

# Signs out of Pomerium (and the Oracle), which goes straight back to the Oracle's sign-in page,
# then signs in again so the new session carries fresh claims.
sign_in_again() {
  local jar="$1" email="$2"
  sign_in_from "$jar" "$email" "$(curl -s -L -c "$jar" -b "$jar" "${GAME}/.pomerium/sign_out")"
}

echo "Anonymous"
anon="${JAR_DIR}/anon"
check "game shell is public" 200 "$(curl -s -o /dev/null -w '%{http_code}' "${GAME}/")"
check "fields needs a session" 401 "$(status "$anon" /zones/fields/enter)"

echo "Citizen"
citizen="${JAR_DIR}/citizen"
email="e2e-${RUN}@${KINGDOM}"
check "sign-up lands back in the game" "${GAME}/?signedin=1" "$(sign_up "$citizen" "$email")"
check "app verified Pomerium's JWT" "$email" \
  "$(curl -s -b "$citizen" -H "$JSON" "${GAME}/zones/oracle/" | grep -o "\"email\":\"[^\"]*\"" | head -1 | cut -d'"' -f4)"
check "fields" 200 "$(status "$citizen" /zones/fields/enter)"
check "town (domain is ${KINGDOM})" 200 "$(status "$citizen" /zones/town/enter)"
check "armory without knights" 403 "$(status "$citizen" /zones/armory/enter)"
check "library read (GET)" 200 "$(status "$citizen" /zones/library/books/0)"
check "library write (POST)" 403 "$(status "$citizen" /zones/library/ledger POST)"

echo "Knighthood"
check "Captain knights the player" 200 "$(status "$citizen" /zones/guild/knight POST)"
check "armory still refuses (session holds old claims)" 403 "$(status "$citizen" /zones/armory/enter)"
check "signing in again lands back in the game" "${GAME}/?signedin=1" "$(sign_in_again "$citizen" "$email")"
armory=403
for _ in $(seq 1 45); do
  armory="$(status "$citizen" /zones/armory/enter)"
  [ "$armory" = 200 ] && break
  sleep 2
done
check "armory opens once Pomerium sees the new claim" 200 "$armory"

echo "The Royal Keep"
check "keep refuses a knight who isn't a scholar" 403 "$(status "$citizen" /zones/keep/enter)"
check "Librarian names the player a scholar" 200 "$(status "$citizen" /zones/oracle/scholar POST)"
sign_in_again "$citizen" "$email" >/dev/null
keep=403
for _ in $(seq 1 45); do
  keep="$(status "$citizen" /zones/keep/enter)"
  [ "$keep" = 200 ] && break
  sleep 2
done
check "keep opens for a citizen who is a knight and a scholar" 200 "$keep"

echo "Starting over"
check "signing out to restart lands on the title screen" "${GAME}/" \
  "$(curl -s -L -c "$citizen" -b "$citizen" -o /dev/null -w '%{url_effective}' \
    "${GAME}/.pomerium/sign_out?pomerium_redirect_uri=${GAME}/")"
check "and the session is gone" 401 "$(status "$citizen" /zones/fields/enter)"

echo "Outsider"
outsider="${JAR_DIR}/outsider"
sign_up "$outsider" "wanderer-${RUN}@outlands.net" >/dev/null
check "sign-up refused outside ${KINGDOM}" 401 "$(status "$outsider" /zones/fields/enter)"

echo
if [ "$failures" -eq 0 ]; then echo "All checks passed."; else echo "${failures} check(s) failed."; fi
exit "$failures"
