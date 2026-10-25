# PRD: The East Road and chapter two

Status: not started. The East Road was removed from chapter one until there is something behind it. Its
spot at the south end of the Library Quarter is now the Royal Keep, the gate that ends chapter one (a
citizen who is both a knight and a scholar); the road to chapter two should start somewhere else.

## Why it was removed

Chapter one ended at a barred gate at the south end of the Library Quarter (the "East Road"). Walking into
it showed a 404 "No route" screen and a sign promising the Night Market, the Thieves' Guild and an owl
familiar. None of those exist yet, so the gate read as a dead end rather than a lesson. Chapter one now
ends with the steel sword.

## What to bring back

The removal commit has the full implementation to restore from (`git log --grep "East Road"`):

- **The gate:** a `TILE.nightGate` at the map's south edge (21, 29), reached by a cobble road down x = 21
  from the library square. The tile art is still in `art/tiles.mjs` and `tiles.png`.
- **The sign:** a sign at (22, 27) with the "edge of chapter one" pages (`END_SIGN` in `content.ts`).
- **The 404 screen:** `nightGate()` in `story.ts` showed a `NO ROUTE` access-log entry and a 404 denial
  for `https://night-market.<domain>/`, teaching that Pomerium only proxies addresses it has a route for.
- **The lesson:** `notFound`, "No route means no way through", linking to route matching
  (`/docs/reference/routes/from`). It was the twelfth lesson.

## Chapter two: what lies down the road

The road should open onto real content, each piece a Pomerium capability taught the way chapter one does
it: play first, then the Pomerium parallel on the second tab.

| Place              | Pomerium capability                     | Sketch                                                                               |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------------------ |
| The Night Market   | Time-based rules (`date`/`time_of_day`) | Stalls that only open after dark; the gate's policy checks the hour.                 |
| The Thieves' Guild | Device identity                         | The guild knows faces and devices; a new device is turned away until it is enrolled. |
| The owl familiar   | Acting for you over MCP                 | An owl that runs errands on your behalf, with its own delegated, narrower access.    |

## Done when

- The road leads somewhere playable, not to a sign about the future.
- The 404 lesson returns where it fits naturally (for example, a mistyped market stall address).
- Each new place has a real Pomerium route and policy rendered from `app/src/game/zones.ts`, a sign, an
  in-world refusal and a Pomerium tab, like chapter one's gates.
- `./quest test` covers the new policies.
