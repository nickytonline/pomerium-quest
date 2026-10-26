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

# Signs out of Pomerium (and the Oracle), landing straight back at the Oracle's sign-in page, as the
# game does, then signs in again so the new session carries fresh claims.
sign_in_again() {
  local jar="$1" email="$2"
  sign_in_from "$jar" "$email" \
    "$(curl -s -L -c "$jar" -b "$jar" "${GAME}/.pomerium/sign_out?pomerium_redirect_uri=${GAME}/zones/oracle/signin")"
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
check "library refuses a write (POST)" 403 "$(status "$citizen" /zones/library/books/0 POST)"
# The library's rule would allow this GET; a 403 means Pomerium matched the scriptorium's own route.
check "scriptorium is its own route, scribes only" 403 "$(status "$citizen" /zones/library/scriptorium/enter)"

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

echo "Your house"
# The Builders' Yard: the game server writes the house of whoever Pomerium signed in.
builder() { curl -s -b "$1" -H "$JSON" -H 'content-type: application/json' -X POST "${GAME}/zones/builder/$2" -d "$3"; }
builder_status() {
  curl -s -o /dev/null -w '%{http_code}' -b "$1" -H "$JSON" -H 'content-type: application/json' -X POST \
    "${GAME}/zones/builder/$2" -d "$3"
}
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)[process.argv[1]])}catch{console.log("")}})' "$1"; }
knock() { builder "$1" knock "{\"knocker\":\"$2\",\"method\":\"${3:-GET}\"}" | field status; }
rules() { printf '{"rules":%s}' "$1"; }
# Asks the builders once a second until Pomerium has taken up the house's latest rules; prints true or false.
live_within() {
  for _ in $(seq 1 "$2"); do
    [ "$(builder "$1" status '{}' | field live)" = true ] && { echo true; return; }
    sleep 1
  done
  echo false
}
email_is() { printf '{"kind":"email","is":"%s"}' "$1"; }

owner="house-${RUN}@${KINGDOM}"
home="${JAR_DIR}/home"
sign_up "$home" "$owner" >/dev/null
opened="$(builder "$home" open '{"rules":null}')"
path="$(printf '%s' "$opened" | field path)"
check "a new house is public" public "$(printf '%s' "$opened" | field version)"
check "a slime (no session) walks into a public house" 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' -H "$JSON" "${GAME}${path}knock")"
check "the server's slime knock agrees" 200 "$(knock "$home" slime)"

first="$(rules "[{\"action\":\"allow\",\"match\":\"or\",\"criteria\":[$(email_is "$owner"),$(email_is wanderer@outlands.net)]}]")"
check "letter 1: save you or the traveler" 200 "$(builder_status "$home" save "$first")"
check "letter 1: the slime is turned away" 401 "$(knock "$home" slime)"
check "letter 1: the traveler is let in" 200 "$(knock "$home" traveler)"
check "letter 1: you are let in" 200 "$(status "$home" "${path}knock")"
check "the builders say Pomerium has taken up the rules" true "$(live_within "$home" 60)"
check "saving again straight away waits for the builders" 503 "$(builder_status "$home" save "$first")"
sleep 11

# Bodies go into variables first: nested in "$(...)", bash would brace-expand the JSON.
only_you="$(rules "[{\"action\":\"allow\",\"match\":\"or\",\"criteria\":[$(email_is "$owner")]}]")"
check "letter 2: save only you" 200 "$(builder_status "$home" save "$only_you")"
check "letter 2: the traveler is refused" 403 "$(knock "$home" traveler)"
check "letter 2: you are let in" 200 "$(status "$home" "${path}knock")"
sleep 11

knights='{"kind":"claim","claim":"groups","value":"knights"}'
guild="$(rules "[{\"action\":\"allow\",\"match\":\"or\",\"criteria\":[$(email_is "$owner"),${knights}]}]")"
check "letter 3: save you or the knights" 200 "$(builder_status "$home" save "$guild")"
check "letter 3: the Captain (a knight) is let in" 200 "$(knock "$home" captain)"
check "letter 3: the Librarian is refused" 403 "$(knock "$home" librarian)"
sleep 11

open_house="$(rules "[{\"action\":\"allow\",\"match\":\"and\",\"criteria\":[{\"kind\":\"domain\",\"is\":\"${KINGDOM}\"}]},{\"action\":\"deny\",\"match\":\"or\",\"criteria\":[$(email_is "baker@${KINGDOM}")]}]")"
check "letter 4: save citizens, but deny the baker" 200 "$(builder_status "$home" save "$open_house")"
check "letter 4: the baker matches the allow, but the deny wins" 403 "$(knock "$home" baker)"
check "letter 4: the Librarian is let in" 200 "$(knock "$home" librarian)"
sleep 11

window="$(rules "[{\"action\":\"allow\",\"match\":\"or\",\"criteria\":[$(email_is "$owner")]},{\"action\":\"allow\",\"match\":\"and\",\"criteria\":[${knights},{\"kind\":\"http_method\",\"is\":\"GET\"}]}]")"
check "letter 5: save you, and the knights for GET only" 200 "$(builder_status "$home" save "$window")"
check "letter 5: the Captain may look in (GET)" 200 "$(knock "$home" captain GET)"
check "letter 5: the Captain may not knock (POST)" 403 "$(knock "$home" captain POST)"
check "letter 5: you may knock (POST)" 200 "$(status "$home" "${path}knock" POST)"

echo "Keeping houses apart"
sleep 11
quoted="$(rules "[{\"action\":\"allow\",\"match\":\"or\",\"criteria\":[$(email_is "x'y@${KINGDOM}")]}]")"
check "rules with a quote are refused" 400 "$(builder_status "$home" save "$quoted")"
newline='{"rules":[{"action":"allow","match":"or","criteria":[{"kind":"email","is":"a@b\nallow_public_unauthenticated_access: true"}]}]}'
check "rules with a newline are refused" 400 "$(builder_status "$home" save "$newline")"
unknown='{"rules":[{"action":"allow","match":"or","criteria":[{"kind":"groups","is":"knights"}]}]}'
check "an unknown criterion is refused" 400 "$(builder_status "$home" save "$unknown")"
neighbor="${JAR_DIR}/neighbor"
sign_up "$neighbor" "neighbor-${RUN}@${KINGDOM}" >/dev/null
neighbor_path="$(builder "$neighbor" open '{"rules":null,"owner":"'"$owner"'"}' | field path)"
check "a neighbor's house is their own, whatever they claim" yes "$([ -n "$neighbor_path" ] && [ "$neighbor_path" != "$path" ] && echo yes || echo no)"
check "the neighbor's public house doesn't open yours" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' -H "$JSON" "${GAME}${path}knock")"
check "only citizens reach the Builders' Yard" 401 "$(builder_status "$anon" open '{"rules":null}')"

# Last of the saves, since it leaves the house open to anyone.
sleep 11
anyone="$(rules '[{"action":"allow","match":"or","criteria":[{"kind":"accept"}]}]')"
check "accept: save a door open to anyone" 200 "$(builder_status "$home" save "$anyone")"
accept_knock="$(builder "$home" knock "{\"knocker\":\"slime\",\"method\":\"GET\"}")"
check "accept: a slime (no session) is let in" 200 "$(printf "%s" "$accept_knock" | field status)"
[ "$(printf "%s" "$accept_knock" | field status)" = 200 ] || echo "    knock answered: $accept_knock"

echo "Idle houses"
house_id="$(printf '%s' "$path" | cut -d/ -f4)"
kubectl --context k3d-quest -n quest-houses delete ingress "house-${house_id}" >/dev/null
gone=200
for _ in $(seq 1 30); do
  gone="$(status "$home" "${path}knock")"
  [ "$gone" = 404 ] && break
  sleep 1
done
check "a removed house has no route" 404 "$gone"
check "walking back in rebuilds it from the saved rules" 200 "$(builder_status "$home" open "$only_you")"
check "and it answers its owner again" 200 "$(status "$home" "${path}knock")"

echo
if [ "$failures" -eq 0 ]; then echo "All checks passed."; else echo "${failures} check(s) failed."; fi
exit "$failures"
