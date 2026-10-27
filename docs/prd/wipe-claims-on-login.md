# Investigation: wipe claims on a fresh login (issue #8)

Status: built on this branch. Restart, start over, the phish screen and running out of hearts all take the
player's claims back at the Oracle (groups and deed) before signing them out. Still open: whether Pomerium's
cached user record drops the old groups on the next sign-in (see "Still to check live").

## What was built

- **Oracle:** `OracleAdmin.wipeClaims` removes the citizens, knights and scholars groups and clears the `deed`
  attribute, reading it back to confirm. `POST oracle/reset` runs it for the signed-in player.
- **Client:** `startOver` in `app/src/game/restart.ts` calls the reset, then resets progress and signs out. Restart,
  New game, Play again and the phish screen's Start over all use it. If the reset fails, the save is kept.
- **Death:** running out of hearts now shows the Oracle dialog in `KNOCKED_OUT` and then starts over, instead of
  waking the player in the village still signed in.
- **Deed:** the deed is held only while the player is a citizen in the current game. The Oracle grants it again when
  they become a citizen. It is still `houseId(email)`, so the same house comes back. A random per-game deed would
  need houses keyed by something other than the owner's email.

Checked against the cluster: the same Keycloak calls, run on a throwaway user, removed all three memberships (204s,
no groups left), and an emptied `deed` attribute disappeared. `npm run check` and `npm test` pass.

## The problem

A player who finished the quest and then restarts, starts a new game or dies keeps their groups
(`citizens`, `knights`, `scholars`) and their `deed`. The restart only clears the game's local progress, so
the next run can walk straight to the Royal Keep and win again.

The issue's screenshot shows the Oracle's own claims view after a fresh sign-in, listing all three groups and
the deed. That view reads the session, so the groups were still in the identity provider when the player
signed in. The stale groups aren't only a Pomerium cache.

## What the code did before

- **Restart and new game** (`playAgain` in `app/src/components/Celebration.tsx`, the Restart and "Yes, start
  over" buttons in `app/src/components/Quest.tsx`) reset the game's local state and nothing at the Oracle.
- **The Oracle only added.** `app/src/server/oracle-admin.ts` had `grant` (adds a group) and `grantCitizen`
  (sets the `deed` attribute, then adds `citizens`). Nothing removed a group or cleared the attribute.
- **Pomerium's user record** is shared by every session of a person. The game's own lesson
  (`CachedClaims` in `app/src/components/Quest.tsx`) says a sign-in "updated your user record" with the new
  claims, but that the `claim` check reads a copy cached for up to a minute and the record wins over the
  session. That lesson describes the behaviour; it has not been reproduced here.
- **Pomerium's docs** ([sessions](https://www.pomerium.com/docs/internals/sessions)) say claims are stored on
  the session and the user, refreshed from the ID token and the UserInfo endpoint, and that identity-provider
  changes "will be picked up without requiring the user to go through another login flow". They don't say
  whether a claim missing from a new login replaces the stored value or is merged with it.

## Options considered

1. **Remove the groups and deed at the Oracle on restart.** Built. A fresh sign-in after that should show no groups,
   and the armory, town, keep and their deed-based houses deny again. This needs no change to Pomerium.
2. **Clear the Pomerium user record as well.** Only needed if option 1 leaves the cached groups in place. The
   Pomerium OSS docs don't describe an API for deleting a user record, so this would mean restarting the Pomerium
   databroker, which signs everyone out. Treat it as a last resort.
3. **A fresh Keycloak account per run.** Each new game creates a new Oracle user, so there is no old user record to
   inherit. This avoids any question about merging, but it changes the email shown in the claims and leaves stray
   accounts behind unless they're deleted too.

## Still to check live

1. Sign a finished test account out, sign in again, and read the claims and a `groups` route after the one-minute
   cache has expired. If the old groups come back, the Pomerium user record is holding them (option 2 above).
2. Add the start-over path to `./quest test` so a finished account is denied again after a restart.
</content>
