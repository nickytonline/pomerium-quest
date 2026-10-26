#!/usr/bin/env bash
# Load test for player houses (docs/prd/your-house.md): how long does the Pomerium Ingress Controller
# take to apply a house change when hundreds or thousands of house Ingresses exist, and what does
# that cost Pomerium? Runs in its own k3d cluster so it never touches the game's.
#
#   bash scripts/house-load-test.sh            # 100, 1000 and 3000 houses
#   COUNTS="100 500" bash scripts/house-load-test.sh
#   KEEP=1 bash scripts/house-load-test.sh     # leave the cluster running afterwards
# No -e: at large counts Pomerium may never answer, and the table should still say so.
set -uo pipefail

cd "$(dirname "$0")/.."

CLUSTER=quest-load
CONTEXT="k3d-${CLUSTER}"
PORT="${LOAD_PORT:-9443}"
HOST="load.localhost.pomerium.io"
COUNTS="${COUNTS:-100 300 1000}"
EDITS="${EDITS:-5}"
CONTROLLER_REF=0-33-0
WORK="$(mktemp -d)"

say() { printf '\033[1;35m▸\033[0m %s\n' "$*"; }
kc() { kubectl --context "$CONTEXT" "$@"; }
now() { node -e 'console.log(Date.now())'; }

cleanup() { [ "${KEEP:-0}" = 1 ] || k3d cluster delete "$CLUSTER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

[ -f .quest/certs/tls.crt ] || { echo "Run ./quest up first: it makes the local certificate this uses."; exit 1; }

if ! k3d cluster list "$CLUSTER" >/dev/null 2>&1; then
  say "Creating k3d cluster ${CLUSTER} on port ${PORT}"
  k3d cluster create "$CLUSTER" --port "${PORT}:443@loadbalancer" --k3s-arg "--disable=traefik@server:0" --wait >/dev/null
fi

say "Installing the Pomerium Ingress Controller (${CONTROLLER_REF})"
kc apply -k "github.com/pomerium/ingress-controller/config/default?ref=${CONTROLLER_REF}" >/dev/null
kc -n pomerium create secret tls wildcard --cert .quest/certs/tls.crt --key .quest/certs/tls.key \
  --dry-run=client -o yaml | kc apply -f - >/dev/null
kc -n pomerium wait --for=condition=complete job/pomerium-gen-secrets --timeout=180s >/dev/null

kc apply -f - >/dev/null <<EOF
apiVersion: ingress.pomerium.io/v1
kind: Pomerium
metadata: { name: global }
spec:
  secrets: pomerium/bootstrap
  certificates: [pomerium/wildcard]
---
apiVersion: v1
kind: Namespace
metadata: { name: quest-houses }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: echo, namespace: quest-houses }
spec:
  replicas: 1
  selector: { matchLabels: { app: echo } }
  template:
    metadata: { labels: { app: echo } }
    spec:
      containers:
        - name: echo
          image: traefik/whoami:v1.10
          ports: [{ containerPort: 80 }]
---
apiVersion: v1
kind: Service
metadata: { name: echo, namespace: quest-houses }
spec:
  selector: { app: echo }
  ports: [{ port: 80, targetPort: 80 }]
EOF

kc -n pomerium rollout status deployment/pomerium --timeout=300s >/dev/null
kc -n quest-houses rollout status deployment/echo --timeout=120s >/dev/null

# One house Ingress. Public houses answer 200; a house with a policy sends a request with no session
# to sign in (302), so the status code says which version of the route Pomerium is serving.
house() {
  local id="$1" mode="$2" annotations
  if [ "$mode" = public ]; then
    annotations="    ingress.pomerium.io/allow_public_unauthenticated_access: 'true'"
  else
    annotations="    ingress.pomerium.io/policy: |
      - allow:
          or:
            - email: { is: owner-${id}@game.localhost.pomerium.io }"
  fi
  cat <<EOF
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: house-${id}
  namespace: quest-houses
  labels: { quest/house: '${id}' }
  annotations:
    ingress.pomerium.io/pass_identity_headers: 'true'
${annotations}
spec:
  ingressClassName: pomerium
  rules:
    - host: ${HOST}
      http:
        paths:
          - path: /zones/home/${id}
            pathType: Prefix
            backend: { service: { name: echo, port: { number: 80 } } }
EOF
}

code() { curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "https://${HOST}:${PORT}/zones/home/$1" || echo 000; }

# Milliseconds until the house answers with the wanted status code, or "timeout" after `$3` seconds.
until_code() {
  local id="$1" want="$2" limit="${3:-120}" start
  start="$(now)"
  while [ $(($(now) - start)) -lt $((limit * 1000)) ]; do
    [ "$(code "$id")" = "$want" ] && { echo $(($(now) - start)); return; }
    sleep 0.2
  done
  echo timeout
}

# Fixed-width ids: Pomerium matches a prefix as a string, so /zones/home/h10 would also match h100.
hid() { printf 'h%05d' "$1"; }

usage() { kc -n pomerium top pod --no-headers 2>/dev/null | awk '{print $2" CPU, "$3" memory"}' | head -1; }

median() { sort -n | awk '{a[NR]=$1} END {print (NR ? a[int((NR+1)/2)] : "none")}'; }

say "Waiting for Pomerium to answer"
house warmup public | kc apply -f - >/dev/null
until_code warmup 200 >/dev/null

printf '\n%-8s %-16s %-16s %-16s %-20s %s\n' houses "created (ms)" "edit (ms)" "delete (ms)" "after restart (ms)" "Pomerium"
created=0
for count in $COUNTS; do
  : >"${WORK}/batch.yaml"
  for i in $(seq $((created + 1)) "$count"); do house "$(hid "$i")" public >>"${WORK}/batch.yaml"; done
  start="$(now)"
  kc apply -f "${WORK}/batch.yaml" >/dev/null
  create_ms="$(until_code "$(hid "$count")" 200 600)"
  created="$count"

  # Switch a few houses from public to a policy, one at a time, as a player saving would.
  for e in $(seq 1 "$EDITS"); do
    id="$(hid $((count - e + 1)))"
    start="$(now)"
    house "$id" policy | kc apply -f - >/dev/null
    until_code "$id" 302
  done >"${WORK}/edits"

  # Delete one house and recreate it, as idle clean-up would.
  id="$(hid "$count")"
  kc -n quest-houses delete ingress "house-${id}" >/dev/null
  delete_ms="$(until_code "$id" 404)"
  house "$id" public | kc apply -f - >/dev/null
  until_code "$id" 200 >/dev/null

  sleep 15 # let metrics-server catch up
  used="$(usage)"

  # Start Pomerium cold, as after a crash or an upgrade, and time how long until houses answer again.
  kc -n pomerium scale deployment/pomerium --replicas=0 >/dev/null
  kc -n pomerium wait --for=delete pod -l app.kubernetes.io/component=proxy --timeout=120s >/dev/null 2>&1 || true
  start="$(now)"
  kc -n pomerium scale deployment/pomerium --replicas=1 >/dev/null
  restart_ms="$(until_code "$(hid 1)" 200 600)"

  printf '%-8s %-16s %-16s %-16s %-20s %s\n' "$count" "$create_ms" "median $(median <"${WORK}/edits")" \
    "$delete_ms" "$restart_ms" "$used"
done
