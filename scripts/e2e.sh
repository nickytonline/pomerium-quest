#!/usr/bin/env bash
# End-to-end checks against a running ./quest deployment: signs players up and in through Pomerium
# and the Oracle (Keycloak) with curl, then checks every zone policy and the stale-claims lesson.
set -uo pipefail

PORT="${QUEST_PORT:-443}"
DOMAIN="${QUEST_DOMAIN:-localhost.pomerium.io}"
# The townsfolk who visit houses have fixed addresses; players may sign up with any.
TOWNSFOLK=game.localhost.pomerium.io
PLAYERS=players.example
SUFFIX=""
[ "$PORT" = 443 ] || SUFFIX=":${PORT}"
GAME="https://game.${DOMAIN}${SUFFIX}"
AVIARY="https://aviary.${DOMAIN}${SUFFIX}"
ORACLE="https://oracle.${DOMAIN}${SUFFIX}"
JAR_DIR="$(mktemp -d)"
JSON='accept: application/json'
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The group names come from the game's own constants, so these checks can't drift from the policies.
read -r GROUP_CITIZEN GROUP_KNIGHTS GROUP_FALCONERS GROUP_KEYHOLDERS < <(node --input-type=module -e "import { GROUPS } from '$ROOT/app/src/game/groups.ts'; console.log(GROUPS.citizens, GROUPS.knights, GROUPS.falconers, GROUPS.keyholders)")
[ -n "$GROUP_KNIGHTS" ] || { echo 'could not read the group names from app/src/game/groups.ts'; exit 1; }
# The process id keeps runs started in the same second (in parallel) from sharing accounts.
RUN="$(date +%s)-$$"
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

# One field of a JSON object on stdin; a dotted name reaches into nested objects.
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(process.argv[1].split(".").reduce((o,k)=>o[k],JSON.parse(s)))}catch{console.log("")}})' "$1"; }

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

# Waits for Pomerium to refresh the session so it carries the claims the Oracle has changed, as the game
# does: it never signs out (that would need Pomerium's open allow_any_sign_out_redirect_uri flag). The
# Oracle's access tokens last 30 seconds, so Pomerium refreshes in about a minute. Prints refreshed or
# timeout; the arguments (the player's email) are kept so callers read as before.
sign_in_again() {
  local jar="$1" before now
  before="$(curl -s -b "$jar" -H "$JSON" "${GAME}/zones/oracle/")"
  for _ in $(seq 1 50); do
    now="$(curl -s -b "$jar" -H "$JSON" "${GAME}/zones/oracle/")"
    [ "$now" != "$before" ] && { echo refreshed; return; }
    sleep 3
  done
  echo timeout
}

# A newcomer isn't a citizen until the Oracle says so: he grants the citizens group and the deed, and the
# player signs in again so their session carries them.
become_citizen() {
  local jar="$1" email="$2"
  check "the Oracle grants citizenship and a deed" 200 "$(status "$jar" /zones/oracle/citizen POST)"
  sign_in_again "$jar" "$email" >/dev/null
  check "the new session carries a deed claim" yes \
    "$(curl -s -b "$jar" -H "$JSON" "${GAME}/zones/oracle/" | grep -q '"deed":"[0-9a-f-]\{36\}"' && echo yes || echo no)"
  # Pomerium takes a moment to see the new claims; wait, so the first request after this isn't a stale 403.
  local town=403
  for _ in $(seq 1 45); do
    town="$(status "$jar" /zones/town/enter)"
    [ "$town" = 200 ] && break
    sleep 2
  done
  check "town opens once the session carries the citizens group" 200 "$town"
}

# The perch is where the game sends the owl from: Pomerium hands the game server a token for the player, and
# the server calls the Aviary, the MCP server's route, with it. Each call's outcome is Pomerium's answer.
perch() { curl -s -b "$1" -H "$JSON" -H 'content-type: application/json' -X POST "${GAME}/zones/perch/aviary" -d "$2"; }
tools='{"method":"tools/list"}'
call() { printf '{"method":"tools/call","tool":"%s"}' "$1"; }

echo "Anonymous"
anon="${JAR_DIR}/anon"
check "game shell is public" 200 "$(curl -s -o /dev/null -w '%{http_code}' "${GAME}/")"
check "fields needs a session" 401 "$(status "$anon" /zones/fields/enter)"

echo "Newcomer"
citizen="${JAR_DIR}/citizen"
email="e2e-${RUN}@${PLAYERS}"
check "sign-up lands back in the game" "${GAME}/?signedin=1" "$(sign_up "$citizen" "$email")"
check "app verified Pomerium's JWT" "$email" \
  "$(curl -s -b "$citizen" -H "$JSON" "${GAME}/zones/oracle/" | grep -o "\"email\":\"[^\"]*\"" | head -1 | cut -d'"' -f4)"
check "fields" 200 "$(status "$citizen" /zones/fields/enter)"
check "town refuses a newcomer, whatever their email" 403 "$(status "$citizen" /zones/town/enter)"
check "the Builders' Yard refuses a newcomer" 403 "$(status "$citizen" /zones/builder/open POST)"

echo "Citizen"
become_citizen "$citizen" "$email"
check "armory without knights" 403 "$(status "$citizen" /zones/armory/enter)"
check "the owl's perch refuses a citizen who hasn't finished chapter one" 403 \
  "$(curl -s -o /dev/null -w '%{http_code}' -b "$citizen" -H "$JSON" -H 'content-type: application/json' -X POST "${GAME}/zones/perch/aviary" -d "$tools")"
check "library read (GET)" 200 "$(status "$citizen" /zones/library/books/0)"
check "library refuses a write (POST)" 403 "$(status "$citizen" /zones/library/books/0 POST)"
# The library's rule would allow this GET; a 403 means Pomerium matched the scriptorium's own route.
check "scriptorium is its own route, scribes only" 403 "$(status "$citizen" /zones/library/scriptorium/enter)"

echo "Knighthood"
check "Captain knights the player" 200 "$(status "$citizen" /zones/guild/knight POST)"
check "armory still refuses (session holds old claims)" 403 "$(status "$citizen" /zones/armory/enter)"
check "Pomerium refreshes the session with the new claims" refreshed "$(sign_in_again "$citizen" "$email")"
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

echo "The Aviary (MCP)"
# Asks the Aviary until Pomerium's answer is the one wanted, since new claims take a moment to reach it.
perch_until() {
  local got=""
  for _ in $(seq 1 45); do
    got="$(perch "$1" "$2" | field outcome.kind)"
    [ "$got" = "$3" ] && break
    sleep 2
  done
  echo "$got"
}
gate_until() {
  local got=403
  for _ in $(seq 1 45); do
    got="$(status "$1" "$2")"
    [ "$got" = 200 ] && break
    sleep 2
  done
  echo "$got"
}

# The player the keep just admitted may walk into chapter two and send an owl, but is no falconer yet.
owl="$citizen"
falconer="$email"
check "an MCP server route takes a token, not a browser session" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' -b "$owl" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -X POST "${AVIARY}/mcp" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
check "the Aviary refuses the owl of a player who is no falconer, before any tool is looked at" refused \
  "$(perch "$owl" "$tools" | field outcome.kind)"
check "and refuses its whoami call just the same" refused "$(perch "$owl" "$(call whoami)" | field outcome.kind)"
check "the Eyrie refuses a player who is neither falconer nor keyholder" 403 "$(status "$owl" /zones/eyrie/enter)"
check "the Falconer vouches for the player, and the Oracle adds falconers" yes \
  "$(curl -s -b "$owl" -H "$JSON" -X POST "${GAME}/zones/keep/falconer" | grep -q "\"granted\":\"$GROUP_FALCONERS\"" && echo yes || echo no)"
check "the Aviary still refuses (session holds old claims)" refused "$(perch "$owl" "$tools" | field outcome.kind)"
sign_in_again "$owl" "$falconer" >/dev/null
check "the Aviary lists its tools for a falconer's owl" tools "$(perch_until "$owl" "$tools" tools)"
check "it lists all five, the forbidden one too" \
  "whoami,ring_bell,scout_grounds,deliver_letter,open_cage" \
  "$(perch "$owl" "$tools" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).outcome.tools.map(t=>t.name).join(",")))')"
check "whoami: the owl flies on the player's behalf" yes \
  "$(perch "$owl" "$(call whoami)" | field outcome.text | grep -q "$falconer" && echo yes || echo no)"
check "ring_bell is allowed for a falconer's owl" result "$(perch "$owl" "$(call ring_bell)" | field outcome.kind)"
check "scout_grounds is allowed too" result "$(perch "$owl" "$(call scout_grounds)" | field outcome.kind)"
check "open_cage is refused for a falconer (deny: mcp_tool starts_with open_, groups exclude distinguished-falconers)" refused \
  "$(perch "$owl" "$(call open_cage)" | field outcome.kind)"
# The Falconer has an account of their own, in the distinguished-falconers group. The game sends their owl from
# the same perch to the same tool, and Pomerium decides it on the Falconer's behalf.
falconers_owl="$(curl -s -b "$owl" -H "$JSON" -X POST "${GAME}/zones/perch/falconer")"
check "the Falconer's owl may call open_cage: same route, same tool, another identity" result \
  "$(printf '%s' "$falconers_owl" | field outcome.kind)"
check "and the Aviary ran it on the Falconer's behalf, not the player's" yes \
  "$(printf '%s' "$falconers_owl" | field outcome.text | grep -q "falconer@${TOWNSFOLK}" && echo yes || echo no)"
check "the Eyrie refuses a falconer who is no keyholder" 403 "$(status "$owl" /zones/eyrie/enter)"
check "deliver_letter has the Oracle add keyholders" yes \
  "$(perch "$owl" "$(call deliver_letter)" | field outcome.text | grep -q "\"granted\": \"$GROUP_KEYHOLDERS\"" && echo yes || echo no)"
check "the Eyrie still refuses (session holds old claims)" 403 "$(status "$owl" /zones/eyrie/enter)"
sign_in_again "$owl" "$falconer" >/dev/null
check "the Eyrie opens to all five groups, ending chapter two" 200 "$(gate_until "$owl" /zones/eyrie/enter)"
check "open_cage stays refused, even for a keyholder" refused \
  "$(perch "$owl" "$(call open_cage)" | field outcome.kind)"
check "a restart takes falconers and keyholders back too" 200 "$(status "$owl" /zones/oracle/reset POST)"

echo "Taking the claims back"
deed_before="$(curl -s -b "$citizen" -H "$JSON" "${GAME}/zones/oracle/" | grep -o '"deed":"[^"]*"')"
check "a restart takes the claims back at the Oracle" 200 "$(status "$citizen" /zones/oracle/reset POST)"
check "taking them back again is harmless" 200 "$(status "$citizen" /zones/oracle/reset POST)"
check "Pomerium refreshes the session with the new claims" refreshed "$(sign_in_again "$citizen" "$email")"
check "the new session carries no deed" yes \
  "$(curl -s -b "$citizen" -H "$JSON" "${GAME}/zones/oracle/" | grep -q '"deed":null' && echo yes || echo no)"
# Pomerium keeps a copy of the user's claims for up to a minute. Wait that out, so an old copy would have expired.
sleep 65
check "after the cache has expired, the town still refuses" 403 "$(status "$citizen" /zones/town/enter)"
check "and the keep refuses a player with no groups" 403 "$(status "$citizen" /zones/keep/enter)"
become_citizen "$citizen" "$email"
deed_after="$(curl -s -b "$citizen" -H "$JSON" "${GAME}/zones/oracle/" | grep -o '"deed":"[^"]*"')"
check "becoming a citizen again grants a new deed" yes \
  "$([ -n "$deed_after" ] && [ "$deed_after" != "$deed_before" ] && echo yes || echo no)"

echo "Starting over"
curl -s -L -c "$citizen" -b "$citizen" -o /dev/null "${GAME}/.pomerium/sign_out"
check "signing out ends the session" 401 "$(status "$citizen" /zones/fields/enter)"

echo "Your house"
# The Builders' Yard: the game server writes the house of whoever Pomerium signed in.
builder() { curl -s -b "$1" -H "$JSON" -H 'content-type: application/json' -X POST "${GAME}/zones/builder/$2" -d "$3"; }
builder_status() {
  curl -s -o /dev/null -w '%{http_code}' -b "$1" -H "$JSON" -H 'content-type: application/json' -X POST \
    "${GAME}/zones/builder/$2" -d "$3"
}
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

owner="house-${RUN}@${PLAYERS}"
home="${JAR_DIR}/home"
sign_up "$home" "$owner" >/dev/null
become_citizen "$home" "$owner"
opened="$(builder "$home" open '{"rules":null}')"
path="$(printf '%s' "$opened" | field path)"
check "a new house is public" public "$(printf '%s' "$opened" | field version)"
check "a slime (no session) walks into a public house" 200 \
  "$(curl -s -o /dev/null -w '%{http_code}' -H "$JSON" "${GAME}${path}knock")"
check "the server's slime knock agrees" 200 "$(knock "$home" slime)"

first="$(rules "[{\"action\":\"allow\",\"match\":\"or\",\"criteria\":[$(email_is wanderer@outlands.net)]}]")"
check "letter 1: save the traveler (the deed lets you in)" 200 "$(builder_status "$home" save "$first")"
check "letter 1: the slime is turned away" 401 "$(knock "$home" slime)"
check "letter 1: the traveler is let in" 200 "$(knock "$home" traveler)"
check "letter 1: you are let in" 200 "$(status "$home" "${path}knock")"
check "the builders say Pomerium has taken up the rules" true "$(live_within "$home" 60)"
check "saving again straight away waits for the builders" 503 "$(builder_status "$home" save "$first")"
sleep 11

# Bodies go into variables first: nested in "$(...)", bash would brace-expand the JSON.
only_you="$(rules '[]')"
check "letter 2: save no rules, so only the deed's owner gets in" 200 "$(builder_status "$home" save "$only_you")"
check "letter 2: the traveler is refused" 403 "$(knock "$home" traveler)"
check "letter 2: you are let in" 200 "$(status "$home" "${path}knock")"
sleep 11

knights='{"kind":"claim","claim":"groups","value":"'"$GROUP_KNIGHTS"'"}'
guild="$(rules "[{\"action\":\"allow\",\"match\":\"or\",\"criteria\":[${knights}]}]")"
check "letter 3: save the knights" 200 "$(builder_status "$home" save "$guild")"
check "letter 3: the Captain (a knight) is let in" 200 "$(knock "$home" captain)"
check "letter 3: the Librarian is refused" 403 "$(knock "$home" librarian)"
sleep 11

citizens='{"kind":"claim","claim":"groups","value":"'"$GROUP_CITIZEN"'"}'
open_house="$(rules "[{\"action\":\"allow\",\"match\":\"and\",\"criteria\":[${citizens}]},{\"action\":\"deny\",\"match\":\"or\",\"criteria\":[$(email_is "baker@${TOWNSFOLK}")]}]")"
check "letter 4: save citizens, but deny the baker" 200 "$(builder_status "$home" save "$open_house")"
check "letter 4: the baker matches the allow, but the deny wins" 403 "$(knock "$home" baker)"
check "letter 4: the Librarian is let in" 200 "$(knock "$home" librarian)"
sleep 11

window="$(rules "[{\"action\":\"allow\",\"match\":\"and\",\"criteria\":[${knights},{\"kind\":\"http_method\",\"is\":\"GET\"}]}]")"
check "letter 5: save the knights for GET only" 200 "$(builder_status "$home" save "$window")"
check "letter 5: the Captain may look in (GET)" 200 "$(knock "$home" captain GET)"
check "letter 5: the Captain may not knock (POST)" 403 "$(knock "$home" captain POST)"
check "letter 5: you may knock (POST)" 200 "$(status "$home" "${path}knock" POST)"

# A browser that has never seen the rules (a new device) opens the house with none: the server keeps them.
saved_version="$(builder "$home" status '{}' | field version)"
reopened="$(builder "$home" open '{"rules":null}')"
check "opening from a fresh browser keeps the saved door" "$saved_version" "$(printf '%s' "$reopened" | field version)"
check "and hands the saved rules back" yes "$(printf '%s' "$reopened" | grep -q '"rules":\[{' && echo yes || echo no)"

echo "Keeping houses apart"
sleep 11
quoted="$(rules "[{\"action\":\"allow\",\"match\":\"or\",\"criteria\":[$(email_is "x'y@${PLAYERS}")]}]")"
check "rules with a quote are refused" 400 "$(builder_status "$home" save "$quoted")"
newline='{"rules":[{"action":"allow","match":"or","criteria":[{"kind":"email","is":"a@b\nallow_public_unauthenticated_access: true"}]}]}'
check "rules with a newline are refused" 400 "$(builder_status "$home" save "$newline")"
unknown='{"rules":[{"action":"allow","match":"or","criteria":[{"kind":"groups","is":"knights"}]}]}'
check "an unknown criterion is refused" 400 "$(builder_status "$home" save "$unknown")"
neighbor="${JAR_DIR}/neighbor"
sign_up "$neighbor" "neighbor-${RUN}@${PLAYERS}" >/dev/null
become_citizen "$neighbor" "neighbor-${RUN}@${PLAYERS}"
neighbor_path="$(builder "$neighbor" open '{"rules":null,"owner":"'"$owner"'"}' | field path)"
check "a neighbor's house is their own, whatever they claim" yes "$([ -n "$neighbor_path" ] && [ "$neighbor_path" != "$path" ] && echo yes || echo no)"
live_within "$home" 60 >/dev/null # the last save may still be applying, and a route mid-update answers 404
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

echo "The deed is for one game"
# Only the deed may open the door now, so a player with no deed is refused at their own door.
sleep 11
check "save no rules, so only the deed opens the door" 200 "$(builder_status "$home" save "$only_you")"
check "the builders say Pomerium has taken up the rules" true "$(live_within "$home" 60)"
check "the owner's deed lets them in" 200 "$(status "$home" "${path}knock")"
check "a restart takes the owner's deed back" 200 "$(status "$home" /zones/oracle/reset POST)"
sign_in_again "$home" "$owner" >/dev/null
sleep 65
check "with no deed, the owner's own door refuses them" 403 "$(status "$home" "${path}knock")"
become_citizen "$home" "$owner"
check "the builders rebuild the door with the new deed" 200 "$(builder_status "$home" open "$only_you")"
check "the builders say Pomerium has taken up the new door" true "$(live_within "$home" 60)"
check "the owner's new deed lets them in again" 200 "$(status "$home" "${path}knock")"

echo
if [ "$failures" -eq 0 ]; then echo "All checks passed."; else echo "${failures} check(s) failed."; fi
exit "$failures"
