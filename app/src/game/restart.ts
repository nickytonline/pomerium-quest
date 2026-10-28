// Starting over: a restart, a death, a phish and Play again all end here. The Oracle takes the player's claims
// back first, so the sign-in that follows carries none.
import { probe, requestZone, signOutUrl } from './access.ts'
import { quest } from './store.ts'
import { zoneById } from './zones.ts'

/** Starts the game over. A signed-in player's claims are taken back at the Oracle, then they sign out and back in. */
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

  quest.resetProgress()

  if (identity.authenticated) location.assign(signOutUrl())
  else location.reload()
}
