# PRD: Your house, where you write the policy

Status: built. `./quest test` checks every letter against the real Pomerium. "As built" below records
the load test and where the build differs from this plan.

## As built

### Load test

`scripts/house-load-test.sh` runs the Pomerium Ingress Controller (branch 0-33-0, Pomerium v0.33.4)
in its own k3d cluster, with house Ingresses pointing at an echo server:

| Houses | All created                                                              | One edit applied | One delete | Cold start | Pomerium (CPU, memory) |
| ------ | ------------------------------------------------------------------------ | ---------------- | ---------- | ---------- | ---------------------- |
| 100    | 5.1 s                                                                    | 0.58 s (median)  | 0.08 s     | 19.4 s     | about 1 core, 228 MiB  |
| 300    | 16.6 s                                                                   | 0.75 s (median)  | 0.34 s     | 20.1 s     | about 1 core, 419 MiB  |
| 1,000  | Pomerium crash-looped and served 404 on every route, and never recovered |

The cause is in the controller, not in Pomerium's routing. Every change validates the whole config by
running Envoy against it. On startup it validates once per Ingress, against everything so far, so
the work grows with the square of the number of houses. At 1,000 houses that outlasts the controller's
cache-sync timeout, so it restarts, and a restarted controller serves no routes at all. That includes
the main gates, since houses share the instance.

So at most **100 houses** stand at once (`QUEST_HOUSE_LIMIT`), well inside the measured range. Hosted
play with many players would need the controller fixed upstream, or houses on their own Pomerium.

### Where the build differs from the plan

- **Last visits are kept in the game server's memory**, not in a `quest/last-visited` annotation.
  Every change to an Ingress makes the controller validate Pomerium's whole config, so touching it on
  every visit would be expensive. After a restart, every standing house gets a fresh 30 minutes.
- **A save waits for the controller.** It records an `Updated` event each time it applies an Ingress,
  and Kubernetes folds repeats into one event with a count. The server waits (up to 25 seconds, under
  Pomerium's 30 second route timeout) for the count to rise. Knocks also check `X-House-Version`, set
  on each house with `set_request_headers`.
- **A house only answers when Pomerium set `X-House-Version`.** Without a house route, a request to
  `/zones/home/...` falls through to the public game route, and must not look like an open door.
- **The townsfolk are imported at deploy**, with Keycloak's partial import, rather than made by the
  game server. The realm's user profile only accepts kingdom addresses, even from the admin API, and the
  traveler is from `outlands.net`. The import skips that check, and the game server needs no extra
  Keycloak permissions.
- **The deny letter keeps out the baker**, not the traveler. The traveler isn't a citizen, so an allow
  rule for citizens already keeps them out, and the deny would do nothing.
- **Slimes come from the fields**: a field slime that reaches the doorstep knocks with no session, at
  most once every 15 seconds.
- **The Ingress Controller has no `signout_redirect_url`**, so the game passes `pomerium_redirect_uri`
  when it signs out to refresh claims.

## Why

Chapter one teaches players to read policy. Every sign shows a route's YAML, and every refusal marks the
check that failed. But players never write a policy, so they can't test what they think a rule means.

The house fixes that. The player owns a house in the Slime Fields, writes the policy on its door, and
watches real visitors get let in or turned away by Pomerium. It's also the natural place to teach what
chapter one doesn't: public routes, `deny` rules (which always beat `allow`), and the `or` and `not`
operators.

## What the player does

1. After first sign-in the Oracle sends the player to the sage, who says they're about to become a citizen and entitled to a house outside the walls: an empty one in the Slime Fields, just below the pond. Back at the Oracle, he adds two claims: the `citizen` group and the house's deed (a group named for the house). He signs them in again so their session carries both.
2. **The house starts open to everyone.** Its route is public
   (`allow_public_unauthenticated_access`), so Pomerium lets every request through, signed in or not.
   When the player arrives, slime bots are bouncing around inside and the traveler is at the table eating
   the bread. Each one got in with a real request: the bots with no session at all, the traveler with
   their own. The access log shows them all as ALLOW.
3. Inside, a writing desk opens the **door rules** editor. The player builds rules from blocks (who, what
   check, allow or deny). The editor shows the PPL it will produce as they go.
4. The player saves. A builder NPC says the work takes a moment while Pomerium picks up the new route.
5. Once Pomerium enforces the new rules, **visitors come by**: whoever the letter names knocks. Each
   visit is a real request through Pomerium, and each shows up in the access log as an ALLOW or
   DENY. A refused visitor gets the same denial screen as the player does at a gate.
6. Puzzles come as letters on the doormat, each one a small brief:

The first two letters tell one story:

1. **"Get the slimes out, but your friend the traveler is welcome."** The player writes their first
   policy: just the traveler, since the deed already lets the owner in. The bots have no session, so no
   rule can match them and they bounce out. The traveler's visit is still an ALLOW.

   ```yaml
   - allow:
       or:
         - email: { is: wanderer@outlands.net }
   ```

2. **"The traveler ate all your bread."** The player deletes the traveler's rule, leaving none. They
   don't add anything to keep the traveler out: once no rule matches them, Pomerium denies them, and
   only the deed's owner gets in. That's default deny, learned by removing a rule rather than adding one.

Later letters build on that:

| Letter                                                           | What it teaches                       | One answer                                                     |
| ---------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| "Let in your friends from the Knights' Guild"                    | `claim/groups`                        | `allow: { or: [claim/groups: knights] }`                       |
| "Any citizen may visit, except the baker"                        | `deny` beats `allow`                  | allow `claim/groups: citizen`, then `deny` the baker's `email` |
| "Friends may look in through the window (GET), not knock (POST)" | `http_method`, two rules on one route | as the library does                                            |

A letter counts as solved when the real visits come out the way the brief asks: the visitors are the test
cases.

## The house

### Where it goes and what's inside

The house stands in the Slime Fields, just below the pond in the top-left corner, so the slimes are
already on the doorstep. Its walls run from (1, 9) to (7, 15), which leaves a 5 by 5 room inside, at x 2
to 6 and y 10 to 14. The door is on the east side at (7, 12), opening onto the field path where it turns
east (8, 12). Row 8 stays grass, so there's a strip of meadow between the pond and the house.

```
        x: 1  2  3  4  5  6  7  8
  y  9     #  #  #  #  #  #  #        # wall
  y 10     #  W  .  .  .  .  #        W writing desk
  y 11     #  .  T  T  .  .  #        T table with the bread
  y 12     #  .  t  .  .  m  D  =     t the traveler, m doormat (letters), D door, = the field path
  y 13     #  .  .  .  s  .  #        s a slime bot
  y 14     #  .  .  .  .  .  #
  y 15     #  #  #  #  #  #  #
```

That's 25 floor tiles, 22 of them walkable once the table and desk are in: room for the traveler, a slime
wandering and the player swinging a sword. If it turns out too cramped when played, there are two fallbacks:

- **A bigger map.** The camera already follows the player and stops at the map's edges, so the map
  can grow. But every place on it is set by hand (and `regionAt` hard-codes the region borders), so
  making the fields bigger means moving everything east or south of them. It's worth doing when chapter
  two needs room too.
- **A separate interior map** entered through the door, which the scene doesn't support yet.

What moves to make room:

- The trees at (3, 9), (4, 9), (1, 11), (2, 14) and (5, 14), and the flowers at (3, 12).
- Two bot slime start points that would be inside or in the wall: (6, 10) and (3, 15). Move them
  elsewhere in the fields, for example (10, 15) and (5, 16).

The house is past the Fields Gate, so the player reaches it signed in. That suits it: the editor needs
their email from the session anyway.

New art in `art/tiles.mjs`: a table with bread, the same table with crumbs, and a writing desk.

### Slimes in the house

- **Slimes come from the fields.** A field slime that wanders onto the doorstep tries the door. The game
  server sends the house route a request with no session on its behalf. If Pomerium allows it, the slime
  comes in; at most one is inside at a time.
- **The sword works indoors.** The player can kill the slime as anywhere else. But the next slime that
  reaches the door gets in the same way, so the sword only ever buys time. Fixing the policy is what
  stops them. That's the lesson: you can't fight your way out of a public route.
- **After the first save,** a slime that tries the door is denied. The access log shows the DENY and the
  slime bounces back into the field.
- **No farming.** Slimes killed in the house don't count toward the Captain's quota, or an open house
  would be an endless supply.
- Monsters are kept inside a fixed area today (`FIELDS` in `scene.ts`), and the house is inside it. The
  house walls keep slimes out on their own, but the door needs to block monsters except when a request
  for one is allowed.

### The traveler at the table

- The traveler appears at the table when their visit is allowed and stays while it is. They talk like
  any NPC (pleased about the bread).
- When a save stops letting them in, they get up, walk out of the door and grumble from the road. The
  bread on the table turns to crumbs after the second letter's story.
- The traveler already stands in the Slime Fields, a short walk from the door. When the traveler's visit
  is allowed they walk over and sit down; when it's denied they walk back to their spot. It's one person
  to Pomerium: the same Keycloak account.

## How it works

### The three layers that keep houses apart

Players never talk to Kubernetes. Three layers each guard something different:

```
player ──HTTP──► Pomerium ──► game server ──Kubernetes API──► Ingress in namespace quest-houses
          (1) PPL on the         (2) owner comes from          (3) the server's role can only
          builder route              the verified JWT              touch quest-houses
```

1. **Pomerium (PPL)** decides which requests reach the game. Saving door rules is a POST to a new zone,
   `/zones/builder`, defined in `zones.ts` like any other (signed-in citizens only).
2. **The game server** decides which house a request may change. It takes the owner from Pomerium's
   verified JWT, never from the request body, and only ever writes that player's own house. This is what
   stops Alice changing Bob's house.
3. **Kubernetes permissions** decide what the game server may change. Its ServiceAccount has a Role that
   allows creating, updating, listing and deleting Ingresses in the `quest-houses` namespace, and nothing
   else. A bug or a compromised game server can make or remove houses, but can't touch the armory, the
   keep or the Oracle.

An earlier idea put an owner-only `deny` on each house route as well. It's left out on purpose: saving
never goes through the house route, so there's nothing for it to guard. Also, the PPL docs allow several
operators in one rule (`and` with `not`) but don't say how they combine, so we shouldn't depend on it.

### Each house is a real route

The game server writes one Ingress per house, read by the
[Pomerium Ingress Controller](https://www.pomerium.com/docs/deploy/k8s/ingress):

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: house-3f9a1c2b7d4e # a hash of the owner's email: DNS-safe, and keeps the email out of URLs
  namespace: quest-houses
  labels: { app.kubernetes.io/part-of: quest, quest/house: '3f9a1c2b7d4e' }
  annotations:
    ingress.pomerium.io/pass_identity_headers: 'true'
    ingress.pomerium.io/set_request_headers: '{"X-House-Version": "<hash of the policy>"}'
    ingress.pomerium.io/policy: |
      - allow:
          or:
            - email: { is: alice@game.localhost.pomerium.io }
            - claim/groups: knights
    quest/last-visited: '2026-10-25T18:00:00Z'
spec:
  ingressClassName: pomerium
  rules:
    - host: game.localhost.pomerium.io
      http:
        paths:
          - path: /zones/home/3f9a1c2b7d4e
            pathType: Prefix
            backend: { service: { name: quest, port: { number: 3000 } } }
```

`X-House-Version` tells the game server which policy Pomerium enforced on a visit. A visit that arrives
with an older version means Pomerium hasn't picked up the save yet, so the server waits and tries again
rather than reporting a stale result.

### Moving every route to the Ingress Controller

Today Pomerium reads its routes from a `config.yaml` that `render.ts` writes into a Secret. The game
server must not get write access to that file: it holds Pomerium's secrets and every other route.

The Ingress docs describe routes as Ingress resources and global settings as a `Pomerium` custom resource.
They don't say whether a routes file can be used at the same time. So the plan moves everything to the
Ingress Controller:

- `render.ts` writes the `Pomerium` resource (identity provider, cookie and signing keys) and one Ingress
  per zone in `zones.ts`, in the `quest` namespace.
- `zones.ts` stays the single source of truth for every fixed gate. Houses are the one exception: their
  policy comes from the player.
- `./quest test` must pass unchanged before any house work starts.

### Rules are built from blocks, never typed as YAML

The editor sends rules as JSON in the same shape as `zones.ts`, extended with `deny` and more operators:

```ts
interface HouseRule {
  readonly action: 'allow' | 'deny'
  readonly match: 'and' | 'or' | 'not' // one operator per rule, as the PPL docs recommend
  readonly criteria: readonly Criterion[]
}
```

The server checks them with an Effect Schema before writing anything:

- **Criteria:** only `authenticated_user`, `domain`, `email`, `claim/groups` and `http_method`. All of them
  work in open-source Pomerium.
- **Values:** emails, domains and group names must match a strict pattern (letters, digits, `@ . _ -`).
  No quotes, colons, newlines or spaces can reach the YAML.
- **Size:** at most 6 rules with 6 criteria each.

PPL has no variables, so a rule can't say "the owner" and have Pomerium work out who that is. The deed does
it instead. Each house is named for a hash of its owner's email, and the Oracle adds the owner to a group
with that name (`deed-<id>`) when he grants the deed. The server writes `allow: claim/groups: deed-<id>` as
the first rule of every saved house, and the editor and sign show it too, so the owner needs no email rule
of their own and can't remove themselves by accident. Only a `deny` can still turn the owner away, since a
deny always beats an allow; the desk checks the rules with `turnsAwayOwner` and refuses to save one. The
rules may be empty: then only the deed's owner gets in.

The server then renders the PPL with the same `policyYaml` code the signs use, extended for `deny`.
Players' text is never passed through as YAML. That's the main security property of the feature: if
anything raw could reach the annotation, a player could write policy for routes that aren't theirs.

### The house starts public

A new house's Ingress has `ingress.pomerium.io/allow_public_unauthenticated_access: 'true'` and no
policy. Pomerium doesn't allow a public route to also have a policy, so the first save removes the public
annotation and adds the player's rules. A player can't go back to public: the editor has no block for it,
and the server never writes the annotation for a saved house.

### Visitors are real people with real sessions

Checking visitors with `ppl.ts` in the browser would fake Pomerium, which the game doesn't do. Instead:

- `render.ts` adds the visitors to the Keycloak realm as real users with fixed groups: the baker (a
  citizen), the traveler (from `outlands.net`), the captain (a knight) and the librarian (a scholar and a
  scribe). Their passwords come from the generated secrets.
- The game server signs each one in through Pomerium, the way `scripts/e2e.sh` does with curl, and keeps
  their session cookies.
- **Slime bots** are requests with no session at all. The server sends them with no cookie, so they're
  as real as the named visitors, and Pomerium turns them away as soon as the route has any policy.
- **Invite visitors** makes the server send a GET (or a POST, for the knocking letter) to the house as each
  visitor, through Pomerium, and returns each status code with the visitor's identity. The browser shows
  the explanation from `ppl.ts`, as it does today, next to Pomerium's real answer.
- The server reaches Pomerium through the existing CoreDNS rewrite. The NetworkPolicies need a new egress
  rule from the game to Pomerium, and to the Kubernetes API.

### Houses only exist while someone is home

A route per player forever doesn't scale and mostly piles up dead config. So:

- The player's rules are saved with the rest of their progress in the browser.
- Saving, or walking into the house, creates or updates the Ingress.
- A clean-up loop in the game server deletes houses that haven't been visited for 30 minutes
  (`quest/last-visited`). Walking back in recreates it from the saved rules.
- Each player can save at most once every 10 seconds.
- At most a set number of houses (start with 500) can be open at once. Past that, the builder says
  they're busy, and the player can try again shortly.

The route count then follows how many people are playing right now, and Pomerium reloads only on
deliberate saves.

## Build order

Each step stands on its own and is committed separately.

1. **Load test first.** In k3d, run the Ingress Controller and a script that creates, edits and deletes
   100, 1,000 and 3,000 house Ingresses. Measure how long a change takes to apply, and Pomerium's memory
   and CPU use. This decides whether the design above holds, or houses need their own Pomerium instance
   so their churn can't slow the main gates.
2. **Move to the Ingress Controller.** `render.ts` writes the `Pomerium` resource and Ingresses; the
   config file goes away. `./quest test` passes unchanged.
3. **The builder API.** The `/zones/builder` zone, the `quest-houses` namespace, the ServiceAccount and
   Role, rule checking, Ingress writes, clean-up, limits.
4. **Visitors.** Realm users in `render.ts`, server-side sign-in and visits, the NetworkPolicy changes.
5. **The house in the game.** The map, the deed from the Oracle, the desk and editor, the letters,
   the new lessons, signs and README updates.
6. **End-to-end checks** in `scripts/e2e.sh`:
   - each letter's answer gives the expected visits;
   - Alice can't change Bob's house;
   - rules with quotes, newlines or unknown criteria are rejected;
   - an idle house is removed and comes back.

## New lessons

| Lesson                                   | Taught when                     | Links to               |
| ---------------------------------------- | ------------------------------- | ---------------------- |
| A public route lets everyone in          | Finding the slimes in the house | Public access          |
| You write the policy                     | The first save                  | Route policy           |
| `or` lets in anyone who passes one check | Letting the traveler stay       | PPL: logical operators |
| A deny rule always beats an allow        | The "except the baker" letter   | PPL: allow and deny    |

Removing the traveler (the second letter) teaches chapter one's "No matching allow rule means no entry"
again, this time from the other side of the door, so it doesn't need a lesson of its own.

## Open questions

Answered while building:

- **Load test:** one Pomerium copes up to a few hundred houses; see "As built".
- **Ingress Controller version:** branch 0-33-0 embeds Pomerium v0.33.4. Everything in the old config
  maps onto annotations or the `Pomerium` resource except `signout_redirect_url` (see "As built").
- **Switching from public to a policy:** one server-side apply removes the public annotation and adds
  the policy. The end-to-end checks knock straight after the first save and see the slime refused.
- **`set_request_headers` on Ingress:** `ingress.pomerium.io/set_request_headers`, a JSON map.

Still open:

- **Is 5 by 5 enough?** The room plays fine with the traveler, a slime and the sword in a browser
  check, but nobody has played it for long.
- **Hosted play:** a public deployment would need the controller's startup fixed upstream, or houses
  on a Pomerium of their own, before raising the house limit.

## Done when

- A player can write door rules in the game, save them, and see real visitors let in or refused by Pomerium.
- Every letter can be solved, and the solution is checked by real visits.
- No player can change another player's house, and no rule a player writes can reach outside their own
  route. The end-to-end checks prove both.
- Idle houses are removed, and the number of open houses stays under the limit.
