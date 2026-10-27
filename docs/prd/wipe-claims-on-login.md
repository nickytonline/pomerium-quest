# Investigation: wipe claims on a fresh login (issue #8)

Status: investigated, not built. The game can remove a player's groups at the Oracle, which fixes the
Keycloak side. Whether Pomerium's cached user record drops them too still needs a live check (see
"Still open").

## The problem

A player who finished the quest and then restarts, starts a new game or dies keeps their groups
(`citizens`, `knights`, `scholars`) and their `deed`. The restart only clears the game's local progress, so
the next run can walk straight to the Royal Keep and win again.

The issue's screenshot shows the Oracle's own claims view after a fresh sign-in, listing all three groups and
the deed. That view reads the session, so the groups were still in the identity provider when the player
signed in. The stale groups aren't only a Pomerium cache.

## What the code does today

- **Restart and new game** (`playAgain` in `app/src/components/Celebration.tsx`, the Restart and "Yes, start
  over" buttons in `app/src/components/Quest.tsx`) reset the game's local state and nothing at the Oracle.
  The confirmation text says "progress cleared", which is true only for the game.
- **The Oracle only adds.** `app/src/server/oracle-admin.ts` has `grant` (adds a group) and `grantCitizen`
  (sets the `deed` attribute, then adds `citizens`). Nothing removes a group or clears the attribute. The
  game's service account already has `manage-users` and `query-groups` (`scripts/render.ts`, around line 431),
  which is enough to remove a group membership with the same
  `PUT/DELETE /admin/realms/{realm}/users/{id}/groups/{groupId}` endpoints the code already calls.
- **Pomerium's user record** is shared by every session of a person. The game's own lesson
  (`CachedClaims` in `app/src/components/Quest.tsx`) says a sign-in "updated your user record" with the new
  claims, but that the `claim` check reads a copy cached for up to a minute and the record wins over the
  session. That lesson describes the behaviour; it has not been reproduced here.
- **Pomerium's docs** ([sessions](https://www.pomerium.com/docs/internals/sessions)) say claims are stored on
  the session and the user, refreshed from the ID token and the UserInfo endpoint, and that identity-provider
  changes "will be picked up without requiring the user to go through another login flow". They don't say
  whether a claim missing from a new login replaces the stored value or is merged with it.

## Options

1. **Remove the groups and deed at the Oracle on restart (recommended first step).** Add
   `OracleAdmin.revoke(email, group)` and `clearDeed(email)`, calling them from a new server route the restart
   path hits (for example `POST oracle/reset`). The route works out the player from the verified JWT, not from
   the request. A fresh sign-in after that should show no groups, and the armory, town, keep and their
   deed-based houses would all deny again. This needs no change to Pomerium.
2. **Clear the Pomerium user record as well.** Only needed if option 1 leaves the cached groups in place. The
   Pomerium OSS docs don't describe an API for deleting a user record, so this would mean restarting the
   Pomerium databroker, which signs everyone out. Treat it as a last resort.
3. **A fresh Keycloak account per run.** Each new game creates a new Oracle user, so there is no old user
   record to inherit. This avoids any question about merging, but it changes the email shown in the claims
   and leaves stray accounts behind unless they're deleted too.

## Still open

- **Does a fresh login with no groups clear the cached groups in Pomerium's user record?** This decides whether
  option 1 is enough. Test: take a finished test account, run option 1 by hand (remove its groups with the
  Keycloak admin API), sign out, sign in, and read `/zones/oracle/` plus a `groups` route after the one-minute
  cache has expired. Put the result in `./quest test` so it can't regress.
- **Deed.** Decide whether a deed belongs to the account or to a run. If it's per run, the reset also clears
  the `deed` attribute, and the next `grantCitizen` sets a new one.
- **Dying.** `Phished` and the house statechart may also need a reset path. Check whether dying alone should
  keep the groups (a retry) or clear them (a restart).

## Proposed order

1. Add `revoke` and `clearDeed` to `OracleAdmin`, with a unit test for the group and attribute updates
   (Keycloak calls mocked), and call them from a new reset route on the restart path.
2. Run the live check above with `./quest deploy` and `./quest test`.
3. Only if the cached groups survive, decide between option 2 and option 3.
