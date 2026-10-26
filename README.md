# Pomerium Quest

A Zelda-style browser game that teaches how [Pomerium](https://www.pomerium.com) works. You play the
Pomerium Pomeranian, and every gate in the kingdom is a real Pomerium route with a real policy. When a
gate turns you away, the game shows you the exact policy rule that failed.

Chapter one covers the fundamentals:

| In the game                                                    | In Pomerium                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| The Oracle signs you in                                        | Your identity provider (Keycloak, over OIDC)                             |
| Each gate, and the sign beside it                              | A route and its policy                                                   |
| The town only admits `kingdom.com` citizens                    | The `domain` criterion                                                   |
| The Captain makes you a knight; the armory checks it           | `claim/groups`, and claims coming from the IdP                           |
| Being knighted doesn't open the armory until you sign in again | Your session holds the claims from sign-in until Pomerium refreshes it   |
| The library lets you read but not write                        | Allow rules can check `http_method`                                      |
| The access log and the denial screen                           | Every request is checked, and denied by default                          |
| The game server knows who you are                              | Pomerium's signed `X-Pomerium-Jwt-Assertion` header, verified by the app |

## Play it on a real Pomerium (local k3d)

You need Docker (Docker Desktop, OrbStack or Colima), [k3d](https://k3d.io),
[kubectl](https://kubernetes.io/docs/tasks/tools/), [mkcert](https://github.com/FiloSottile/mkcert) and
Node 24. On macOS:

```sh
brew install k3d kubectl mkcert node
./quest up
```

Then open **https://game.localhost.pomerium.io**. Move with the arrow keys or WASD, talk with E or Enter,
swing with Space or J, and press Esc for the menu (save, restart, quit to title). `*.localhost.pomerium.io` resolves to `127.0.0.1`, so you
don't need to edit `/etc/hosts`. mkcert creates a locally trusted certificate, and may ask for your
password the first time.

| Command                 | What it does                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `./quest up`            | Create the cluster if needed, build the images, deploy, and wait until the game answers |
| `./quest dev`           | Same as `up`, but the game runs its Vite dev server and hot-reloads `app/src`           |
| `./quest deploy`        | Rebuild and redeploy into the existing cluster                                          |
| `./quest test`          | Sign players in through Pomerium with curl and check every zone policy                  |
| `./quest status`        | Show the pods                                                                           |
| `./quest logs pomerium` | Follow logs (`pomerium`, `quest` or `keycloak`)                                         |
| `./quest admin`         | Open Keycloak's admin console on http://localhost:8080 and print its password           |
| `./quest reset-oracle`  | Forget every player and re-import the Keycloak realm                                    |
| `./quest down`          | Delete the cluster                                                                      |

Port 443 already in use? Run `QUEST_PORT=8443 ./quest up` and open `https://game.localhost.pomerium.io:8443`.

The game only plays behind Pomerium. Opened directly (say, `npm run dev -w app` on
http://localhost:3000), it says so and won't start: use `./quest dev` for hot reload behind
Pomerium and Keycloak.

## How it fits together

```
browser ──► Pomerium ──┬─ /zones/oracle/*   authenticated_user        ─┐
   (k3d LB :443)       ├─ /zones/fields/*   authenticated_user         │
                       ├─ /zones/town/*     domain is kingdom.com       ├─► quest (TanStack Start, Node)
                       ├─ /zones/guild/*    domain is kingdom.com       │      verifies Pomerium's JWT
                       ├─ /zones/armory/*   claim/groups: knights       │
                       ├─ /zones/library/*  citizen GET, or scribes     │
                       └─ /* (game shell)   public                     ─┘
                       oracle.localhost.pomerium.io ──► keycloak (OIDC IdP, realm "kingdom")
```

- **One source of truth for policy.** [`app/src/game/zones.ts`](app/src/game/zones.ts) defines every
  zone and its allow rules. [`scripts/render.ts`](scripts/render.ts) turns it into the Pomerium config
  and Kubernetes manifests (`deploy/.generated/`). The game's signs and denial screens show the same
  rules.
- **The game** ([`app/`](app)) is a TanStack Start app in SPA mode with a Phaser overworld and a React
  UI. Its `/zones/*` server routes use Effect 4 to verify Pomerium's signed JWT against Pomerium's JWKS
  and to call the Oracle. Quest progression is an XState machine
  ([`app/src/game/quest-machine.ts`](app/src/game/quest-machine.ts)).
- **The Oracle** is [Keycloak](https://www.keycloak.org). `scripts/render.ts` writes its `kingdom`
  realm: open sign-up, the `knights` and `scholars` groups, a mapper that puts them in a `groups`
  claim, Pomerium's client, and a `quest-admin` client whose service account lets the game add a
  player to a group. Its login theme lives in [`deploy/keycloak/theme`](deploy/keycloak/theme) and
  matches the game. Only `/realms/kingdom/` and `/resources/` are routed through Pomerium; the admin
  console stays inside the cluster (`./quest admin`).
- **Kubernetes:** NetworkPolicies allow only Pomerium to reach the game, and only Pomerium and the game
  to reach the Oracle. A CoreDNS rewrite sends in-cluster requests for `*.localhost.pomerium.io` to
  Pomerium.

### Things worth knowing

- **Anyone can sign up as any citizen.** The realm takes any `kingdom.com` email without verifying
  it, because the address is what the game's gates check. Set `QUEST_KINGDOM_DOMAIN` to use another
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
