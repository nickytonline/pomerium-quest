// Starting over: a restart, a death, a phish and Play again all end here. The Oracle takes the player's claims
// back first, then the player signs out, so the game starts again from a login that carries none.
import { probe, requestZone } from './access.ts'
import { quest } from './store.ts'
import { zoneById } from './zones.ts'

/**
 * Starts the game over. A signed-in player's claims are taken back at the Oracle and their session ends, so they
 * log in again to begin. The sign-out lands on Pomerium's own signed-out page: sending it back into the game
 * would need Pomerium's open allow_any_sign_out_redirect_uri flag, which the game leaves off. The sleeping and
 * polling for new claims only happen once they are back in the game.
 */
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

  if (identity.authenticated) location.assign('/.pomerium/sign_out')
  else location.reload()
}
