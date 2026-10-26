// The way to lose: signing in with a phish. The phish grins, the quest is over, and the
// only way on is to start again.
import { link } from '../game/content.ts'
import { useState } from 'react'
import { SETTLE_MS, useQuest } from '../game/store.ts'
import { PHISH_FRAME } from '../game/world.ts'
import { NPCS, Sprite, playAgain } from './Celebration.tsx'

export function Phished() {
  const open = useQuest((s) => s.phished)

  return open ? <PhishedScreen /> : null
}

function PhishedScreen() {
  const [shownAt] = useState(() => performance.now())
  const idp = link('idp')

  // The Enter that closed the phish's last line lands on Start over too: ignore it.
  const startOver = () => {
    if (performance.now() - shownAt > SETTLE_MS) playAgain()
  }

  return (
    <div
      className="phished-bg fixed inset-0 z-[60] grid place-items-center overflow-y-auto px-4 py-6 text-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="phished-title"
      aria-describedby="phished-story"
    >
      <div className="grid max-w-[52ch] justify-items-center gap-3">
        <div className="relative grid place-items-center">
          {/* The lure's glow, behind the phish's lamp. */}
          <span className="absolute top-[58%] size-28 rounded-full bg-sun/25 blur-2xl" aria-hidden="true" />
          <Sprite
            sheet={NPCS.sheet}
            frame={PHISH_FRAME}
            frames={NPCS.frames}
            scale={9}
            className="relative motion-safe:animate-bob"
          />
        </div>
        <h2
          id="phished-title"
          className="phished-text m-0 font-display text-[clamp(2.2rem,7vw,3.6rem)] leading-none font-bold"
        >
          You were phished!
        </h2>
        <p className="m-0 font-display text-[1.1rem] text-sun">That wasn't the Oracle.</p>
        <div id="phished-story" className="grid gap-2 text-left">
          <p className="m-0">
            A phish in a borrowed robe asked for your sign-in, and you handed it over. Now it walks up to
            every guard as you, and every guard checks it and lets it in. As far as any guard can tell, the
            phish is you: it holds your sign-in, and a guard can only check the identity it's shown.
          </p>
          <p className="m-0 text-muted">
            In Pomerium terms: Pomerium checks every request against who your identity provider says you are.
            Credentials typed into a fake sign-in page let someone else be you. Only sign in on your real
            identity provider's page, check its address, and prefer sign-ins a fake page can't replay, like
            passkeys.
          </p>
          <a className="justify-self-start text-[0.9rem]" href={idp.href} target="_blank" rel="noreferrer">
            Docs: {idp.label} ↗
          </a>
        </div>
        <button
          className="mt-2 motion-safe:animate-blink rounded border-3 border-night-deep bg-lime px-[22px] py-3 font-display text-[1.05rem] text-night-deep shadow-[4px_4px_0_var(--color-night-deep)]"
          type="button"
          onClick={startOver}
          // A held Enter from closing the phish's dialog must not start over unseen.
          onKeyDown={(event) => event.repeat && event.preventDefault()}
          autoFocus
        >
          Start over
        </button>
      </div>
    </div>
  )
}
