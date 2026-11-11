// Starting over: a restart, a death, a phish and Play again all end here. The Oracle takes the player's claims
// back first, so the sign-in that follows carries none.
import { probe, requestZone, waitForClaims } from './access.ts'
import { GROUPS } from './groups.ts'
import { quest } from './store.ts'
import { zoneById } from './zones.ts'

/** Starts the game over. A signed-in player's claims are taken back at the Oracle, then the game waits for Pomerium to hear of it. */
export async function startOver() {
  const state = quest.get()
  // Until the first probe answers, the identity is only a placeholder, and it would skip the reset.
  const identity = state.mode === 'loading' ? (await probe()).identity : state.identity

  if (identity.authenticated) {
    const outcome = await requestZone(zoneById('oracle'), 'POST', 'reset')

    if (outcome.kind !== 'allow') {
      quest.toast("The Oracle couldn't take back your claims, so your save is kept. Try again.", 'info')

      return
    }
  }

  if (identity.authenticated) {
    // No sign-out: landing back in the game would need Pomerium's open allow_any_sign_out_redirect_uri
    // flag. Pomerium refreshes the session by itself, so wait until it no longer carries the old claims.
    quest.toast('The Oracle is taking back your papers. This takes about a minute.', 'info')

    const owned = new Set<string>(Object.values(GROUPS))

    await waitForClaims((next) => !next.groups.some((group) => owned.has(group)) && !next.deed)
  }

  quest.resetProgress()
  location.reload()
}
