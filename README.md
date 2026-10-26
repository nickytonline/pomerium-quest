# Pomerium Quest

A Zelda-style browser game that teaches how [Pomerium](https://www.pomerium.com) works. You play the
Pomerium Pomeranian, and every gate in the kingdom is a real Pomerium route. The guard in front of it
follows the route's real policy, and when a guard turns you away, the game shows you the exact policy rule
that failed.

Chapter one covers the fundamentals:

| In the game                                                    | In Pomerium                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| The Oracle signs you in                                        | Your identity provider (Keycloak, over OIDC)                             |
| Each gate's guard, and the sign beside it                      | A route and its policy                                                   |
| The town only admits `kingdom.com` citizens                    | The `domain` criterion                                                   |
| The Captain makes you a knight; the armory checks it           | `claim/groups`, and claims coming from the IdP                           |
| Being knighted doesn't open the armory until you sign in again | Your session holds the claims from sign-in until Pomerium refreshes it   |
| Citizens may read the books; only scribes may enter to write   | Allow rules can check `http_method`                                      |
| The access log and the denial screen                           | Every request is checked, and denied by default                          |
| The game server knows who you are                              | Pomerium's signed `X-Pomerium-Jwt-Assertion` header, verified by the app |

Then the sage gives you a house in the Slime Fields, and you write the policy on its door yourself:

| At your house                                                  | In Pomerium                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Slimes walk in, because a new house is left open to everyone   | A public route (`allow_public_unauthenticated_access`), or `accept: true` in a policy |
| You write door rules at the desk                               | Your route's policy: `allow` and `deny`, `and`, `or`, `not`                           |
| You let in yourself or the traveler, and the slimes bounce off | `or`, and a request with no session matches no rule                                   |
| You drop the traveler's line, and they're refused              | No matching allow rule means no entry                                                 |
| Every citizen may visit, except the baker                      | A `deny` rule beats any `allow`                                                       |
| Knights may look in (GET) but not knock (POST)                 | `http_method`                                                                         |
| Saving door rules sends the townsfolk and a slime to your door | Real requests through Pomerium, with real sessions (or none)                          |

## Play it on a real Pomerium (local k3d)

You need Docker (Docker Desktop, OrbStack or Colima), [k3d](https://k3d.io),
[kubectl](https://kubernetes.io/docs/tasks/tools/), [mkcert](https://github.com/FiloSottile/mkcert) and
Node 24. On macOS:

```sh
brew install k3d kubectl mkcert node
./quest up
```

Then open **https://game.localhost.pomerium.io**. Move with the arrow keys or the W, A, S and D keys, talk with E or Enter,
swing with Space or J, and press Esc for the menu (save, restart, quit to title, and turn music or sound effects on and off). `*.localhost.pomerium.io` resolves to `127.0.0.1`, so you
don't need to edit `/etc/hosts`. mkcert creates a locally trusted certificate, and may ask for your
password the first time.

| Command                 | What it does                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `./quest up`            | Create the cluster if needed, build the images, deploy, and wait until the game answers |
| `./quest dev`           | Same as `up`, but the game runs its Vite dev server and hot-reloads `app/src`           |
| `./quest deploy`        | Rebuild and redeploy into the existing cluster                                          |
| `./quest test`          | Sign players in through Pomerium with curl and check every zone policy and house        |
| `./quest status`        | Show the pods, services and Ingresses                                                   |
| `./quest logs pomerium` | Follow logs (`pomerium`, `quest` or `keycloak`)                                         |
| `./quest admin`         | Open Keycloak's admin console on http://localhost:8080 and print its password           |
| `./quest reset-oracle`  | Forget every player and re-import the Keycloak realm                                    |
| `./quest down`          | Delete the cluster                                                                      |

Port 443 already in use? Run `QUEST_PORT=8443 ./quest up` and open `https://game.localhost.pomerium.io:8443`.

The game only plays behind Pomerium. Opened directly (say, `npm run dev -w app` on
http://localhost:3000), it says so and won't start: use `./quest dev` for hot reload behind
Pomerium and Keycloak.

## Architecture

Three services run in a local k3d cluster: Pomerium, the game (`quest`), and Keycloak (the Oracle).
Every request from the browser goes through Pomerium first, including the game itself:

```
browser ──► Pomerium ──┬─ /zones/oracle/*       authenticated_user              ─┐
   (k3d LB :443)       ├─ /zones/fields/*       authenticated_user               │
                       ├─ /zones/town/*         domain is kingdom.com            │
                       ├─ /zones/guild/*        domain is kingdom.com            ├─► quest (TanStack Start, Node)
                       ├─ /zones/armory/*       claim/groups: knights            │      verifies Pomerium's JWT
                       ├─ /zones/library/*      citizen GET, or scribes          │
                       ├─ /zones/keep/*         citizen, knights and scholars    │
                       ├─ /zones/builder/*      domain is kingdom.com            │      writes house Ingresses
                       ├─ /zones/home/<id>/     the rules each player wrote      │
                       └─ /* (game shell)       public                          ─┘
                       oracle.localhost.pomerium.io ──► keycloak (OIDC IdP, realm "kingdom")
```

### What happens at a gate

The game never decides who gets in. When the dog walks into a gate:

1. The scene ([`scene.ts`](app/src/game/scene.ts)) hands the gate to [`story.ts`](app/src/game/story.ts),
   which asks [`access.ts`](app/src/game/access.ts) to make a real request through Pomerium:
   `fetch('/zones/armory/enter')`, as a GET (or a POST, for the scriptorium's ledger).
2. Pomerium checks the request against that route's policy, using the claims in the player's session.
3. If the policy allows it, Pomerium forwards the request to the game server with a signed
   `X-Pomerium-Jwt-Assertion` header. The server checks the signature against Pomerium's JWKS, and the
   guard steps aside. If it doesn't, Pomerium answers 403 (or 401 with no session), and the gate stays
   shut.
4. On a refusal, the game shows the route's rules and marks which line failed and why. That
   explanation comes from a small PPL evaluator ([`ppl.ts`](app/src/game/ppl.ts)) running the same
   rules from `zones.ts` against your claims. It only explains the answer; the answer is Pomerium's.

Every check also lands in the access log beside the board, and a denial screen shows Pomerium's request
ID.

### One source of truth for policy

[`app/src/game/zones.ts`](app/src/game/zones.ts) defines every zone and its rules.
[`scripts/render.ts`](scripts/render.ts) turns that list into an Ingress per zone, the Keycloak realm and
the other Kubernetes manifests (`deploy/.generated/`), and the game's signs and denial screens show the
same rules. So what a sign says, what a guard does and what Pomerium enforces can't drift apart.
Players' houses are the one exception: their policy comes from the player.

### The pieces

- **Pomerium is the [Pomerium Ingress Controller](https://www.pomerium.com/docs/deploy/k8s/ingress)**
  (branch 0-33-0, which embeds Pomerium v0.33.4), in the `pomerium` namespace. Its global settings are
  a `Pomerium` resource, and every route is an Ingress. The install is vendored in
  [`deploy/pomerium/ingress-controller.yaml`](deploy/pomerium/ingress-controller.yaml).
- **Players' houses** ([docs/prd/your-house.md](docs/prd/your-house.md)) are Ingresses the game server
  writes into the `quest-houses` namespace, the only one its ServiceAccount may change. The owner
  always comes from Pomerium's verified JWT, and door rules are checked against a strict schema before
  the server renders them as PPL. A house starts public, comes down after 30 minutes without a visit,
  and at most 100 stand at once: past a few hundred, the Ingress Controller slows down, and at 1,000 it
  can't start (see the load test in the plan, and `scripts/house-load-test.sh`).
- **The townsfolk** (the baker, the traveler, the Captain and the Librarian) have real Oracle
  accounts, which `./quest` imports at every deploy. The game server signs them in through Pomerium and
  knocks on houses as them; a slime is a knock with no session at all.
- **The game** ([`app/`](app)) is a TanStack Start app in SPA mode with a Phaser overworld and a React
  UI around it. Its `/zones/*` server routes use Effect 4 to verify Pomerium's signed JWT against
  Pomerium's JWKS and to call the Oracle.
- **The Oracle** is [Keycloak](https://www.keycloak.org). `scripts/render.ts` writes its `kingdom`
  realm: open sign-up, the `knights` and `scholars` groups, a mapper that puts them in a `groups`
  claim, Pomerium's client, and a `quest-admin` client whose service account lets the game add a
  player to a group. Its login theme lives in [`deploy/keycloak/theme`](deploy/keycloak/theme) and
  matches the game. Only `/realms/kingdom/` and `/resources/` are routed through Pomerium; the admin
  console stays inside the cluster (`./quest admin`).
- **Kubernetes:** NetworkPolicies allow only Pomerium to reach the game, and only Pomerium and the game
  to reach the Oracle. A CoreDNS rewrite sends in-cluster requests for `*.localhost.pomerium.io` to
  Pomerium, so the game can fetch Pomerium's JWKS and knock on houses.

### Inside the browser

The board is a [Phaser](https://phaser.io) scene; everything around it (dialogs, the sign-in frame,
denial screens, the identity panel, the access log, the door-rules editor and the menu) is React. The
two share one small store ([`store.ts`](app/src/game/store.ts)): Phaser writes the player's position,
health and region to it, and React writes the controls, so the touch buttons drive the same code as the
keyboard.

Progress lives in three [XState](https://stately.ai/docs/xstate) statecharts, saved to local storage:

| Machine                                               | Tracks                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`quest-machine.ts`](app/src/game/quest-machine.ts)   | Chapter one: anonymous → citizen → proven → knighted → knight → armed            |
| [`house-machine.ts`](app/src/game/house-machine.ts)   | Your house: one stage per letter on the desk, solved by real visits              |
| [`player-machine.ts`](app/src/game/player-machine.ts) | The dog: walking, waiting on a gate, swinging, and a moment's safety after a hit |

`knighted` is the stage the chapter turns on: the Oracle lists you in `knights`, but your Pomerium
session still holds the claims from when you signed in, so the armory says no until you sign in again.

The art and sound are code too. The sprites and tiles are pixel grids in [`art/`](art) that
`node art/sprites.mjs` draws into sprite sheets, and there are no audio files: every note of music and
every sound effect is synthesized at runtime with the Web Audio API ([`sound.ts`](app/src/game/sound.ts)).

### On the server

The server is a handful of [Effect](https://effect.website) services behind one catch-all route,
[`routes/zones/$.ts`](app/src/routes/zones/$.ts). By the time a request reaches it, Pomerium has already
allowed it.

| Service                                          | Job                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [`PomeriumIdentity`](app/src/server/identity.ts) | Verifies `X-Pomerium-Jwt-Assertion` against Pomerium's JWKS: who is asking            |
| [`OracleAdmin`](app/src/server/oracle-admin.ts)  | Adds a player to `knights` or `scholars` in Keycloak, as the Captain or the Librarian |
| [`Houses`](app/src/server/houses.ts)             | Renders a player's door rules as PPL and writes their house's Ingress                 |
| [`Visitors`](app/src/server/visitors.ts)         | Signs the townsfolk in through Pomerium and knocks on a house as them                 |
| [`Kube`](app/src/server/kube.ts)                 | Talks to the Kubernetes API with the pod's ServiceAccount                             |

### Where things live

| Path                      | What it is                                                                     |
| ------------------------- | ------------------------------------------------------------------------------ |
| `app/src/game/zones.ts`   | Every zone and its policy                                                      |
| `scripts/render.ts`       | Turns `zones.ts` into the Pomerium config, Keycloak realm and Kubernetes files |
| `app/src/game/scene.ts`   | The Phaser overworld: movement, sword, monsters, drawing                       |
| `app/src/game/story.ts`   | Talking, reading and gates: everything that asks Pomerium a question           |
| `app/src/game/content.ts` | What characters say, what signs show, and the docs each lesson links to        |
| `app/src/game/house*.ts`  | The player's house: its visitors, its statechart, and its letters and bell     |
| `app/src/components/`     | The React UI around the game                                                   |
| `app/src/server/`         | The server's Effect services                                                   |
| `deploy/`                 | The vendored Pomerium Ingress Controller install and the Oracle's login theme  |
| `art/`                    | Pixel art as code                                                              |
| `docs/prd/`               | Plans for work not yet built                                                   |

### Things worth knowing

- **Anyone can sign up as any citizen.** The realm takes any `kingdom.com` email without verifying
  it, because the address is what the game's guards check. Set `QUEST_KINGDOM_DOMAIN` to use another
  domain in the sign-up form, the policies, and the game's text. That's fine for a learning game. Never reuse the realm, or
  this Pomerium, for anything real.
- **Keycloak runs in dev mode** (`start-dev`) with its H2 database on a volume, so players survive a
  redeploy. It imports the realm on first start only: after changing the realm in `render.ts`, or
  `QUEST_DOMAIN`/`QUEST_PORT`/`QUEST_KINGDOM_DOMAIN`, run `./quest reset-oracle`. A public deployment should run
  `start` with a real database.
- **Signing in again signs you out of Keycloak too.** Pomerium's sign-out calls Keycloak's
  end-session endpoint, so refreshing your claims asks for your password again.
- **New claims take a moment.** After you sign in again, Pomerium's authorize service can take up to
  about a minute to use the new claim. Until then the armory still answers 403.
- **`groups` vs `claim/groups`.** The `groups` PPL criterion is Pomerium Enterprise only (it needs
  directory sync). Open-source Pomerium checks the IdP's claim with `claim/groups`.
- **Signing out lands where the game asks.** The Ingress Controller's settings have no
  `signout_redirect_url`, so the game passes `pomerium_redirect_uri` (allowed by the
  `allow_any_sign_out_redirect_uri` runtime flag) to land back at sign-in or on the title screen.
- **PPL operators don't nest.** `and`/`or` hold criteria, not other operators. "Citizen and (GET or
  scribe)" is written as two allow rules, and a request is allowed when any rule matches.

## Development

```sh
npm install
npx vp check      # oxfmt + oxlint (with the vendored anti-slop rules) + type checks
node art/sprites.mjs   # regenerate sprite sheets from the pixel grids in art/
```

Node is pinned with [mise](https://mise.jdx.dev) (`mise.toml`). Lint and format run through
[Vite+](https://viteplus.dev). The anti-slop rules are vendored from
[dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) in `tools/oxlint/anti-slop`.

## License

[Apache License 2.0](LICENSE). The vendored anti-slop lint rules in `tools/oxlint/anti-slop` keep their
own MIT license.
