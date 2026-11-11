// Starting over: a restart, a death, a phish and Play again all end here. The Oracle takes the player's claims
// back first, then the player signs out, so the game starts again from a login that carries none.
import { probe, requestZone } from './access.ts'
import { quest } from './store.ts'
import { zoneById } from './zones.ts'

/**
 * Starts the game over. A signed-in player's claims are taken back at the Oracle and their session ends, so they
 * log in again to begin. The sleeping and polling for new claims only happen once they are back in the game.
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
  markRestarted()

  if (identity.authenticated) await endSession()

  location.reload()
}

/**
 * Ends the Pomerium session without leaving the game. A page visit would stop on Pomerium's signed-out page,
 * and landing back in the game needs the open allow_any_sign_out_redirect_uri flag, which the game leaves off.
 * A fetch follows the redirect to the authenticate service, which ends the session, and a frame couldn't:
 * that service refuses to be framed. The response is opaque, so it can't say whether the session ended.
 */
async function signOut() {
  try {
    await fetch('/.pomerium/sign_out', { mode: 'no-cors', credentials: 'include' })
  } catch {
    // The probe that follows shows whether the session ended: a lapsed one asks for a login.
  }
}

/**
 * Signs out, then asks Pomerium whether the session is really gone, and tries once more if it is not. Returns
 * the last answer. A session that survives both is dealt with at the next boot, which the restart marker keeps.
 */
export async function endSession() {
  await signOut()

  const first = await probe()

  if (!first.identity.authenticated) return first

  await signOut()

  return probe()
}

const RESTARTED_KEY = 'quest:restarted'

/** Remembers across the reload that this game was just started over, so a session that outlives it is not trusted. */
function markRestarted() {
  try {
    sessionStorage.setItem(RESTARTED_KEY, '1')
  } catch {
    // Without storage the restart still works: the sign-in only loses its check for leftover claims.
  }
}

/** True from a restart until a session has been handled: any claims it carries belong to the game that ended. */
export function wasRestarted() {
  try {
    return sessionStorage.getItem(RESTARTED_KEY) === '1'
  } catch {
    return false
  }
}

/** Forgets the restart once its leftover claims have been dealt with. */
export function settleRestart() {
  try {
    sessionStorage.removeItem(RESTARTED_KEY)
  } catch {
    // Nothing was stored.
  }
}
