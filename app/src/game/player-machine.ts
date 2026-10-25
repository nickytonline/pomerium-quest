// What the player is doing, as a statechart. Two regions run side by side:
//
//   action: idle ⇄ walking, idle → awaitingGate → walking | idle, idle → attacking → idle
//   body:   vulnerable → invulnerable (1 s after a hit) → vulnerable
//
// The scene asks "can I act?" and sends events; positions and tweens stay in Phaser.
import { createActor, setup } from 'xstate'

export const SWING_MS = 200
export const INVULNERABLE_MS = 1000

export type PlayerEvent =
  | { readonly type: 'WALK' }
  | { readonly type: 'ARRIVED' }
  | { readonly type: 'GATE' }
  | { readonly type: 'GATE_DENIED' }
  | { readonly type: 'SWING' }
  | { readonly type: 'HIT' }

export const playerMachine = setup({
  types: {
    // SAFETY: XState type-carrier idiom; the value is never read at runtime.
    events: {} as PlayerEvent,
  },
}).createMachine({
  id: 'player',
  type: 'parallel',
  states: {
    action: {
      initial: 'idle',
      states: {
        idle: { on: { WALK: 'walking', GATE: 'awaitingGate', SWING: 'attacking' } },
        walking: { on: { ARRIVED: 'idle' } },
        // Waiting for Pomerium to answer: allowed → walk through, denied → stay put.
        awaitingGate: { on: { WALK: 'walking', GATE_DENIED: 'idle' } },
        attacking: { after: { [SWING_MS]: 'idle' } },
      },
    },
    body: {
      initial: 'vulnerable',
      states: {
        vulnerable: { on: { HIT: 'invulnerable' } },
        invulnerable: { after: { [INVULNERABLE_MS]: 'vulnerable' } },
      },
    },
  },
})

export function startPlayer() {
  const actor = createActor(playerMachine).start()
  const snapshot = () => actor.getSnapshot()

  return {
    send: (event: PlayerEvent) => actor.send(event),
    stop: () => actor.stop(),
    /** Free to start a new action: not walking, swinging, or waiting on a gate. */
    idle: () => snapshot().matches({ action: 'idle' }),
    walking: () => snapshot().matches({ action: 'walking' }),
    invulnerable: () => snapshot().matches({ body: 'invulnerable' }),
  }
}
