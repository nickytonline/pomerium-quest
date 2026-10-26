# Agent guidelines

Pomerium Quest is a browser game that teaches Pomerium: every gate is a real Pomerium route with a real
policy. The [README](README.md) explains how it fits together; this file is how to work on it.

## Where things live

| Path                      | What it is                                                                     |
| ------------------------- | ------------------------------------------------------------------------------ |
| `app/src/game/zones.ts`   | Every zone and its policy. The single source of truth for what each gate does  |
| `scripts/render.ts`       | Turns `zones.ts` into the Pomerium config, Keycloak realm and Kubernetes files |
| `app/src/game/scene.ts`   | The Phaser overworld: movement, sword, monsters, drawing                       |
| `app/src/game/story.ts`   | Talking, reading and gates: everything that asks Pomerium a question           |
| `app/src/game/content.ts` | What characters say, what signs show, and the docs each lesson links to        |
| `app/src/game/house*.ts`  | The player's house: its visitors, its statechart, and its letters and bell     |
| `app/src/game/store.ts`   | State shared by Phaser and React                                               |
| `app/src/game/sound.ts`   | All music and sound effects, synthesized with the Web Audio API                |
| `app/src/components/`     | The React UI around the game                                                   |
| `app/src/server/`         | Server routes (Effect 4): verify Pomerium's JWT, call the Oracle, build houses |
| `deploy/pomerium/`        | The vendored Pomerium Ingress Controller install that `render.ts` adjusts      |
| `art/`                    | Pixel art as code; `node art/sprites.mjs` regenerates the sprite sheets        |
| `docs/prd/`               | Plans for work not yet built                                                   |

## Running and checking

- `npm run check` (format, lint with the vendored anti-slop rules, and types) must pass before every
  commit. `npx vp fmt` fixes formatting.
- The game only plays behind Pomerium. Use `./quest dev` for hot reload, and open
  https://game.localhost.pomerium.io. Don't add a mode that fakes Pomerium.
- Changes under `app/src/game/` reload the whole page in dev, by design (see `app/vite.config.ts`).
- After changing a policy in `zones.ts` or anything in `render.ts`, run `./quest deploy`, then
  `./quest test` to check every zone end to end. If the Keycloak realm changed, also run
  `./quest reset-oracle`, since Keycloak only imports the realm on its first start.
- There are no unit tests yet. Check a change by playing it in the browser, and say so if you couldn't.

## Checking cheaply

- Redeploy only when something the cluster reads changed: a policy in `zones.ts`, `render.ts`, or the
  Keycloak realm. A change under `app/src/` needs no `./quest deploy`; `./quest dev` already reloads it.
- In the browser, read state as text (a script or page snapshot) before taking a screenshot. Use a
  screenshot only for what is visual: layout, art and animation.
- `./quest logs` follows forever, so don't pipe it. Use
  `kubectl --context k3d-quest -n quest logs deployment/<name> --tail=50 | grep <what you need>`
  (the Pomerium namespace is `pomerium`).
- If a check is stuck after a few tries (for example Keycloak is down or a pod won't start), stop and
  tell the user rather than retrying in a long chain.

## Code

- Match the code around you: its naming, idioms and comment density. Formatting is no semicolons,
  single quotes and 110 columns.
- Comments say why, not what. Exported functions and non-obvious constants get a one-line `/** … */`.
- Every type assertion (`as`) needs a `// SAFETY:` comment explaining why it holds.
- The anti-slop lint rules shape a few idioms: use a `Map` or lookup table instead of chained ternaries,
  and leave a blank line between groups of statements.
- Quest progress is an XState machine (`quest-machine.ts`). Add new stages and events there, not as
  flags in the store.

## Teaching Pomerium accurately

- The game's claims about Pomerium must be true of open-source Pomerium. For example, it checks group
  claims with `claim/groups`, not `groups` (an Enterprise feature). If you're not sure, check the docs.
- Signs and denial screens show the same rules that `zones.ts` defines. Never hand-write a policy that
  could drift from them.
- A refusal tells the in-world story first, then shows how Pomerium decided, and links to the docs.

## Motion, sound and accessibility

- Motion is opt-in, following [no-motion-first](https://www.tatianamac.com/posts/prefers-reduced-motion).
  Animate only under `@media (prefers-reduced-motion: no-preference)` or Tailwind's `motion-safe:`. In
  JavaScript, check `matchMedia('(prefers-reduced-motion: no-preference)').matches`, never `reduce`.
  Keep motion short and purposeful.
- Sound is synthesized in `sound.ts`, so there are no audio files. Add a sound as a new `Effect` and
  call `sfx()` where it happens. Music and effects each have their own switch in the menu, so never
  play audio that bypasses them.
- Every action works from the keyboard and from the touch controls. When you add a control, update
  the in-game hint, the intro text in `content.ts` and the README together.

## Writing

- Player-facing text is plain and friendly: short sentences, no jargon without an explanation, and
  spell out keys (for example "the W, A, S and D keys", not "WASD").
- Update the README when commands, controls or how the pieces fit together change.

## Commits

- Commit often, in logical pieces: one commit per change that stands on its own. Split a larger
  feature as you build it (for example the engine, then each place it's wired in, then the UI)
  rather than landing it as one big commit at the end.
- Commit each piece once `npm run check` passes, and push to `main` right away.
- Use conventional commits with a scope, such as `feat(game): …`, `fix(quest): …` or `feat(oracle): …`.
- Don't rewrite history that's already pushed.
