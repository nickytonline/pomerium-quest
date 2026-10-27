// The end of the quest: fireworks over the kingdom, the Pomeranian, and the cast,
// each with the part they played in Pomerium.
import { useEffect, useRef } from 'react'
import { signOutUrl } from '../game/access.ts'
import { SHEETS } from '../game/sheets.ts'
import { quest, useQuest } from '../game/store.ts'
import { NPC_FRAME, PHISH_FRAME } from '../game/world.ts'

/** The game's sunset palette, so the sky matches the kingdom. */
const SPARKS = ['#ffd86b', '#ff9a5a', '#ff4fb8', '#3fe3f2', '#c6f432', '#f3ecff']

/** Fireworks are drawn in chunky pixels, like everything else in the kingdom. */
const PIXEL = 4

/** How long rockets keep launching; the show then fades out. */
const FIREWORKS_MS = 10_000

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  readonly color: string
}

interface Rocket {
  x: number
  y: number
  readonly vy: number
  readonly burstAt: number
  readonly color: string
  readonly heart: boolean
}

/** Velocities for a burst: a ring of sparks, or now and then the outline of a heart. */
function burst(heart: boolean, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const t = (i / count) * Math.PI * 2

    if (!heart) {
      const speed = 2.2 + Math.random() * 1.6

      return { vx: Math.cos(t) * speed, vy: Math.sin(t) * speed }
    }

    // The classic heart curve, scaled down to a spark's speed.
    const x = 16 * Math.sin(t) ** 3
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))

    return { vx: x * 0.2, vy: y * 0.2 }
  })
}

function useFireworks(canvas: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')

    if (!element || !context) return
    // Motion is opt-in: a player who asked for less motion, or a browser that can't say, gets a still sky.
    const still = !matchMedia('(prefers-reduced-motion: no-preference)').matches
    let rockets: Rocket[] = []
    let sparks: Spark[] = []
    let frame = 0
    let nextLaunch = 0
    let launched = 0
    let startedAt: number | undefined

    const resize = () => {
      element.width = Math.ceil(element.clientWidth / PIXEL)
      element.height = Math.ceil(element.clientHeight / PIXEL)
    }

    resize()
    window.addEventListener('resize', resize)

    const pick = () => SPARKS[Math.floor(Math.random() * SPARKS.length)] ?? '#ffd86b'

    const explode = (x: number, y: number, color: string, heart: boolean) => {
      for (const { vx, vy } of burst(heart, heart ? 48 : 36))
        sparks.push({ x, y, vx: vx / 2, vy: vy / 2, life: 1, color: heart ? '#ff4fb8' : color })
    }

    if (still) {
      // No motion: a sky of frozen bursts instead.
      for (let i = 0; i < 6; i++)
        explode((element.width * (i + 0.5)) / 6, element.height * (0.2 + 0.25 * (i % 2)), pick(), i === 2)

      for (const spark of sparks) {
        context.fillStyle = spark.color
        context.fillRect(Math.round(spark.x + spark.vx * 12), Math.round(spark.y + spark.vy * 12), 1, 1)
      }

      return () => window.removeEventListener('resize', resize)
    }

    const tick = (now: number) => {
      const { width, height } = element
      startedAt ??= now
      const launching = now - startedAt < FIREWORKS_MS

      if (launching && now >= nextLaunch) {
        launched++
        rockets.push({
          x: width * (0.15 + Math.random() * 0.7),
          y: height,
          vy: -(height / 70) * (0.9 + Math.random() * 0.3),
          burstAt: height * (0.15 + Math.random() * 0.3),
          color: pick(),
          heart: launched % 4 === 0,
        })
        nextLaunch = now + 450 + Math.random() * 700
      }

      // Let the last frame fade rather than clearing it, so sparks leave trails.
      context.fillStyle = 'rgb(14 10 29 / 0.25)'
      context.fillRect(0, 0, width, height)

      rockets = rockets.filter((rocket) => {
        rocket.y += rocket.vy
        context.fillStyle = rocket.color
        context.fillRect(Math.round(rocket.x), Math.round(rocket.y), 1, 2)

        if (rocket.y > rocket.burstAt) return true
        explode(rocket.x, rocket.y, rocket.color, rocket.heart)

        return false
      })

      sparks = sparks.filter((spark) => {
        spark.x += spark.vx
        spark.y += spark.vy
        spark.vy += 0.03
        spark.vx *= 0.985
        spark.life -= 0.012
        context.globalAlpha = Math.max(spark.life, 0)
        context.fillStyle = spark.color
        context.fillRect(Math.round(spark.x), Math.round(spark.y), 1, 1)
        context.globalAlpha = 1

        return spark.life > 0
      })

      // After the show, let the last sparks fade, then stop drawing.
      if (launching || rockets.length > 0 || sparks.length > 0) frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [canvas])
}

/** One frame of a 16px-tall sprite sheet, drawn at `scale` (3x by default) without smoothing. */
export function Sprite({
  sheet,
  frame,
  scale = 3,
  className = '',
}: {
  readonly sheet: string
  readonly frame: number
  readonly scale?: number
  readonly className?: string
}) {
  const size = 16 * scale

  return (
    <span
      className={`inline-block shrink-0 [image-rendering:pixelated] ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${sheet})`,
        // Scale by height alone, so the sheet's width (and so its frame count) never has to be known here
        backgroundSize: `auto ${size}px`,
        backgroundPosition: `-${frame * size}px 0`,
      }}
      aria-hidden="true"
    />
  )
}

export const NPCS = SHEETS.npcs
const ITEMS = SHEETS.items
const DOG = SHEETS.dog

/** Who played whom. The slime's and dog's frames match the item and dog sheets. */
const CAST: readonly {
  readonly name: string
  readonly role: string
  readonly sheet: string
  readonly frame: number
}[] = [
  { name: 'You, the Pomerium Pomeranian', role: 'the user', sheet: DOG, frame: 0 },
  { name: 'The Oracle', role: 'your identity provider', sheet: NPCS, frame: NPC_FRAME.oracle },
  { name: 'The Sage', role: 'your guide to zero trust', sheet: NPCS, frame: NPC_FRAME.sage },
  {
    name: 'The Traveler',
    role: 'a signed-in user the policy turns away',
    sheet: NPCS,
    frame: NPC_FRAME.traveler,
  },
  { name: 'The Baker', role: 'a user the same policy lets in', sheet: NPCS, frame: NPC_FRAME.baker },
  {
    name: 'The Captain',
    role: 'the admin who adds you to the knights group',
    sheet: NPCS,
    frame: NPC_FRAME.captain,
  },
  {
    name: 'The Librarian',
    role: 'the admin who adds you to the scholars group',
    sheet: NPCS,
    frame: NPC_FRAME.librarian,
  },
  {
    name: 'The Armorer',
    role: 'an app behind a route, leaving access to Pomerium',
    sheet: NPCS,
    frame: NPC_FRAME.armorer,
  },
  { name: 'Bot slimes', role: 'automated bots hammering every gate', sheet: ITEMS, frame: 3 },
  { name: 'Phish', role: 'phishing: a fake Oracle after your sign-in', sheet: NPCS, frame: PHISH_FRAME },
]

function CastList({ hidden = false }: { readonly hidden?: boolean }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0 pb-10" aria-hidden={hidden || undefined}>
      <li className="font-display text-[1.1rem] text-sun">Starring</li>
      {CAST.map(({ name, role, sheet, frame }) => (
        <li key={name} className="flex items-center gap-3 text-left">
          <Sprite sheet={sheet} frame={frame} />
          <span>
            <strong className="block font-display text-ink">{name}</strong>
            <span className="text-[0.9rem] text-muted">as {role}</span>
          </span>
        </li>
      ))}
      <li className="pt-2 font-display text-[1.1rem] text-sun">And Pomerium</li>
      <li className="text-muted">as every guard in the kingdom</li>
    </ul>
  )
}

/** Clears progress and signs out of the Oracle, so the next game starts as a stranger. */
export const playAgain = () => {
  const { identity } = quest.get()

  quest.resetProgress()

  if (identity.authenticated) location.assign(signOutUrl())
  else location.reload()
}

/** The final screen, after the Royal Keep's Quest complete. */
export function Celebration() {
  const open = useQuest((s) => s.celebrating)
  const defeated = useQuest((s) => s.defeated)
  const lessons = useQuest((s) => s.progress.lessons.length)

  if (!open) return null

  return <CelebrationScreen stats={`${defeated.bot} bot slimes defeated · ${lessons} lessons learned`} />
}

function CelebrationScreen({ stats }: { readonly stats: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useFireworks(canvas)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      quest.endCelebration()
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="celebration fixed inset-0 z-[60] overflow-hidden bg-night-deep"
      role="dialog"
      aria-modal="true"
      aria-labelledby="celebration-title"
    >
      <canvas
        ref={canvas}
        className="absolute inset-0 size-full [image-rendering:pixelated]"
        aria-hidden="true"
      />
      <div className="relative grid h-full grid-rows-[auto_minmax(0,1fr)_auto] justify-items-center gap-3 px-4 pt-6 pb-4 text-center">
        <div className="grid justify-items-center gap-2">
          <img
            className="h-auto w-[min(260px,52vw)] drop-shadow-[0_12px_40px_rgb(255_79_184/0.45)]"
            src={SHEETS.splash}
            alt="The Pomerium Pomeranian in aviators and a leather jacket"
          />
          <h2
            id="celebration-title"
            className="sunset-text m-0 font-display text-[clamp(2rem,6vw,3.4rem)] leading-none font-bold"
          >
            The kingdom is secure!
          </h2>
          <p className="m-0 max-w-[48ch] text-muted">
            Every guard checked you, every time, and you made it all the way to the Royal Keep.
          </p>
          <p className="m-0 font-display text-[0.9rem] text-lime">{stats}</p>
        </div>
        <section className="credits-window w-[min(520px,100%)]" aria-label="Starring">
          {/* Two copies, scrolled by exactly one, so the credits loop without a seam. */}
          <div className="credits">
            <CastList />
            <CastList hidden />
          </div>
        </section>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            className="motion-safe:animate-blink rounded border-3 border-night-deep bg-lime px-[22px] py-3 font-display text-[1.05rem] text-night-deep shadow-[4px_4px_0_var(--color-night-deep)]"
            type="button"
            onClick={() => quest.endCelebration()}
            autoFocus
          >
            Back to the kingdom
          </button>
          <button
            className="rounded border-2 border-panel-edge bg-panel px-4 py-3 font-display text-ink hover:border-sun"
            type="button"
            onClick={playAgain}
          >
            Play again
          </button>
        </div>
      </div>
    </div>
  )
}
