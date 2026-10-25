// What happens when the player talks, reads or walks into a gate. The scene handles
// movement and drawing; this module handles the conversation with Pomerium.
import { refreshClaimsUrl, requestZone, signInUrl, simulatedIdentity, type Outcome } from './access.ts'
import {
  BOOKS,
  END_SIGN,
  LESSONS,
  LESSON_ORDER,
  SIGN_DOCS,
  SIGN_TEXT,
  link,
  type LessonId,
  type Page,
} from './content.ts'
import { decide, routeYaml, type Identity } from './ppl.ts'
import { KNIGHT_QUOTA, hasSteel, isAtLeast, stage, type QuestStage } from './quest-machine.ts'
import { MAX_HP, quest, type DenyView, type LogEntry } from './store.ts'
import type { NpcId } from './world.ts'
import { KINGDOM_DOMAIN, zoneById, type Zone, type ZoneId } from './zones.ts'

const UPSTREAM = 'http://quest.quest.svc.cluster.local:3000'

const TRAVELER: Identity = {
  authenticated: true,
  email: 'wanderer@outlands.net',
  groups: [],
}

const learn = (lesson: LessonId) => quest.learn(lesson, LESSONS[lesson].title)
const identity = () => quest.get().identity
const who = (id: Identity) => (id.authenticated ? id.email : 'anonymous')

const claimsCode = (id: Identity) =>
  JSON.stringify({ email: id.email, email_verified: true, groups: id.groups }, null, 2)

const DENY_HINTS: Partial<Record<ZoneId, string>> = {
  town: `Only citizens of ${KINGDOM_DOMAIN} may enter.`,
  guild: `Only citizens of ${KINGDOM_DOMAIN} may enter.`,
  armory: "Only the knights group may enter. The Captain in the Knights' Guild can vouch for you.",
  library:
    'Reading is a GET and passes. Writing is a POST, so this request needs the scribes group. No one in this chapter can make you a scribe: this denial is the lesson.',
}

const LOG_DECISION: Record<Outcome['kind'], LogEntry['decision']> = {
  allow: 'ALLOW',
  signin: 'SIGN IN',
  deny: 'DENY',
  error: 'DENY',
}

function denyView(
  zone: Zone,
  method: 'GET' | 'POST',
  path: string,
  id: Identity,
  signIn: boolean,
  requestId: string | null = null,
): DenyView {
  const decision = decide(zone, id, { method, path })
  const requestLine = `${method} ${location.origin}${path}`
  const fromPomerium = requestId ? { requestId } : {}

  if (signIn) {
    return {
      status: 401,
      title: 'Sign in required',
      requestLine,
      who: 'anonymous',
      lines: decision.lines,
      hint: 'You have no session yet. Pomerium sends anyone without one to the identity provider to sign in, then back here. Visit the Oracle in the temple to the west.',
      links: [link('idp'), link('authz')],
      ...fromPomerium,
    }
  }

  const stale = decision.allow

  return {
    status: 403,
    title: 'Access denied',
    requestLine,
    who: who(id),
    lines: decision.lines,
    hint: stale
      ? 'Pomerium said no, yet by the game’s records you qualify. Your session still holds the claims from when you signed in: visit the Oracle to sign in again. If you just did, give Pomerium up to a minute to pick up the new claim.'
      : (DENY_HINTS[zone.id] ?? 'No allow rule matched this request.'),
    links: stale ? [link('refresh'), link('claims')] : [link('authz'), link('defaultDeny')],
    ...fromPomerium,
  }
}

/** Sends a request, records it in the access log, and shows the denial screen when refused. */
async function attempt(zone: Zone, method: 'GET' | 'POST', action: string): Promise<Outcome> {
  const { mode } = quest.get()
  const id = identity()
  const path = `${zone.prefix}/${action}`
  const outcome = await requestZone(mode, id, zone, method, action)
  const decision = LOG_DECISION[outcome.kind]
  quest.log({ decision, method, path, who: who(id) })

  if (outcome.kind === 'signin') quest.showDeny(denyView(zone, method, path, id, true, outcome.requestId))

  if (outcome.kind === 'deny') {
    const view = denyView(zone, method, path, id, false, outcome.requestId)
    quest.showDeny(view, () => {
      learn('authz')

      if (view.links.includes(link('refresh'))) learn('refresh')
    })
  }

  if (outcome.kind === 'error') quest.toast(`The gate jammed: ${outcome.message}`, 'deny')

  return outcome
}

export async function enterGate(zoneId: ZoneId): Promise<boolean> {
  const zone = zoneById(zoneId)
  const outcome = await attempt(zone, 'GET', 'enter')

  if (outcome.kind !== 'allow') return false
  quest.toast(`ALLOW · GET ${zone.prefix}/enter`, 'allow')
  learn('every')
  learn('route')

  if (zone.id === 'armory' || zone.id === 'library') learn('jwt')

  return true
}

const signPage = (zone: Zone): Page => ({
  who: `Sign · ${zone.name}`,
  text: SIGN_TEXT[zone.id] ?? '',
  code: routeYaml(zone, location.host, UPSTREAM),
  links: SIGN_DOCS[zone.id] ?? [],
})

export function readSign(signId: ZoneId | 'end') {
  if (signId === 'end') {
    quest.say(END_SIGN)

    return
  }

  quest.say([signPage(zoneById(signId))], () => learn('route'))
}

function goTo(url: string) {
  location.assign(url)
}

function oracle() {
  const { mode, progress } = quest.get()
  const id = identity()

  if (!id.authenticated) {
    const intro: Page[] = [
      { who: 'Oracle', text: "I am the Oracle. I don't open gates. I answer one question: who is this?" },
      {
        who: 'Oracle',
        text: 'In Pomerium terms, I am your identity provider, like Google, Okta or GitHub. Pomerium never sees your password. It sends you to me, and I send you back with signed claims.',
        links: [link('idp')],
      },
    ]

    if (mode === 'pomerium') {
      quest.say(
        [
          ...intro,
          {
            who: 'Oracle',
            text: 'Step into the light. You will leave the game for a moment to sign in with me, then come straight back.',
          },
        ],
        () => {
          learn('idp')
          goTo(signInUrl())
        },
      )

      return
    }

    quest.say(intro, () => {
      quest.progress({ sim: { ...progress.sim, signedIn: true } })
      const next = simulatedIdentity(quest.get().progress)
      quest.setIdentity(next)
      quest.send({ type: 'SIGNED_IN', groups: next.groups })
      learn('idp')
      quest.say([
        {
          who: 'Oracle',
          text: `There. You are ${next.email}. Here are your claims.`,
          code: claimsCode(next),
        },
      ])
    })

    return
  }

  if (stage() === 'knighted' && !id.groups.includes('knights')) {
    quest.say(
      [
        { who: 'Oracle', text: "The Captain's letter arrived. I have added knights to your groups." },
        {
          who: 'Oracle',
          text: 'Your session still holds the claims I gave you when you signed in, and Pomerium decides with those. Sign in again so your session carries the new claim.',
          code: claimsCode(id),
          links: [link('refresh')],
        },
      ],
      () => {
        learn('refresh')

        if (mode === 'pomerium') {
          goTo(refreshClaimsUrl())

          return
        }

        const sim = quest.get().progress.sim
        quest.progress({ sim: { ...sim, groups: [...sim.groups, ...sim.pendingGroups], pendingGroups: [] } })
        const next = simulatedIdentity(quest.get().progress)
        quest.setIdentity(next)
        quest.send({ type: 'SIGNED_IN', groups: next.groups })
        quest.say([{ who: 'Oracle', text: 'Signed in again. Your new claims:', code: claimsCode(next) }])
      },
    )

    return
  }

  quest.say([{ who: 'Oracle', text: 'These are your claims as Pomerium sees them.', code: claimsCode(id) }])
}

async function captain() {
  const { defeated, mode } = quest.get()

  if (isAtLeast('knighted')) {
    quest.say([
      {
        who: 'Captain',
        text:
          stage() === 'knighted'
            ? 'The Oracle has your new claim, but your session still carries the old one. Visit her in the temple and sign in again, then claim your steel in the armory east of the square.'
            : 'Go claim your steel. The armory is east of the square.',
      },
    ])

    return
  }

  if (stage() !== 'proven') {
    quest.say([
      { who: 'Captain', text: 'The armory is for knights only.' },
      {
        who: 'Captain',
        text: 'Two pests plague the fields. Bot slimes hammer every gate at once, never tiring. Phish lurk in the pond, dangling a friendly light to lure folk into handing over their sign-in.',
      },
      {
        who: 'Captain',
        text: `Prove yourself: defeat ${KNIGHT_QUOTA} of each, then come back. Bot slimes: ${Math.min(defeated.bot, KNIGHT_QUOTA)} of ${KNIGHT_QUOTA}. Phish: ${Math.min(defeated.phish, KNIGHT_QUOTA)} of ${KNIGHT_QUOTA}.`,
      },
    ])

    return
  }

  const outcome = await attempt(zoneById('guild'), 'POST', 'knight')

  if (outcome.kind !== 'allow') return
  quest.send({ type: 'KNIGHTED' })

  if (mode === 'simulated') {
    const sim = quest.get().progress.sim
    quest.progress({ sim: { ...sim, pendingGroups: ['knights'] } })
  }

  quest.say(
    [
      {
        who: 'Captain',
        text: "Well fought. I've written to the Oracle: from now on you are in the knights group.",
      },
      {
        who: 'Captain',
        text: 'Notice what changed. Not the armory: its policy is the same as yesterday. Your identity changed. The Oracle now lists you in groups: [knights].',
      },
      {
        who: 'Captain',
        text: "Pomerium reads groups from your identity provider. It doesn't decide who is a knight. It checks the claim.",
        links: [link('claims')],
      },
      {
        who: 'Captain',
        text: 'One catch: your session still holds the claims from when you signed in, so your groups still read []. Return to the Oracle and sign in again to carry the new claim.',
        links: [link('refresh')],
      },
    ],
    () => learn('claims'),
  )
}

function traveler() {
  const town = zoneById('town')
  const path = `${town.prefix}/enter`
  quest.say(
    [
      { who: 'Traveler', text: "The Oracle knows me. I'm wanderer@outlands.net, signed in and everything." },
      {
        who: 'Traveler',
        text: `But this town only lets in people whose email domain is ${KINGDOM_DOMAIN}. Signing in got me to the guard. It didn't get me in.`,
      },
      {
        who: 'Traveler',
        text: 'Signing in says who you are. Policy says where you can go.',
        links: [link('authz')],
      },
    ],
    () => {
      quest.log({ decision: 'DENY', method: 'GET', path, who: TRAVELER.email })
      quest.showDeny(
        {
          status: 403,
          title: 'Access denied',
          onBehalfOf: 'the Traveler',
          requestLine: `GET ${location.origin}${path}`,
          who: TRAVELER.email,
          lines: decide(town, TRAVELER, { method: 'GET', path }, 'their').lines,
          hint: `Their domain is ${TRAVELER.email.split('@')[1]}, and only citizens of ${KINGDOM_DOMAIN} may enter. This was the Traveler's request: your own access hasn't changed.`,
          links: [link('authz'), link('defaultDeny')],
        },
        () => learn('authz'),
      )
    },
  )
}

const SCRIPTS: Record<NpcId, () => void> = {
  sage: () => {
    if (identity().authenticated) {
      quest.say([
        {
          who: 'Sage',
          text: 'The Oracle vouches for you now. Head north through the Fields Gate. Read the sign beside each gate: it shows the exact rule its guard enforces.',
        },
      ])

      return
    }

    quest.say(
      [
        { who: 'Sage', text: "You're awake. Good. The kingdom has changed while you slept." },
        {
          who: 'Sage',
          text: 'Our neighbors in Wallhold trusted one big wall. Once a raider got over it, every room inside was theirs.',
        },
        {
          who: 'Sage',
          text: 'Here every gate has a guard, and every guard checks you each time you pass. Pomerium works the same way: each request to each app is checked against that app’s policy.',
          links: [link('every')],
        },
        {
          who: 'Sage',
          text: 'Guards only let in people they can identify. Visit the Oracle in the temple to the west.',
        },
      ],
      () => learn('every'),
    )
  },
  oracle,
  traveler,
  captain: () => void captain(),
  armorer: () => {
    const armorerIntro =
      "I forge the blades. I don't decide who gets in: the gate does. It's the guard here, and it checks your claims on every visit. Its rule is on the sign: only the knights group."

    // The Armorer keeps the forge; the gate is the guard. Each stage gets a line about what the gate sees.
    const lines: Record<QuestStage, string> = {
      anonymous: armorerIntro,
      citizen: armorerIntro,
      proven: `${armorerIntro} The Captain can vouch for you.`,
      knighted:
        "The Oracle lists you as a knight? Then your session hasn't caught up. The gate reads the claims in your session, and those were set when you signed in: groups: []. Sign in with the Oracle again.",
      knight:
        'Your session says groups: [knights] now, so the gate will let you through. The steel sword is in the chest inside.',
      armed:
        "Same gate, same rule as before you were a knight. You didn't unlock a policy. You gained the claim it was waiting for.",
    }

    const text = lines[stage()]

    quest.say([hasSteel() ? { who: 'Armorer', text, links: [link('onroute')] } : { who: 'Armorer', text }])
  },
  librarian: () =>
    quest.say(
      [
        {
          who: 'Librarian',
          text: "Read anything you like. There's no guard in here, but the gate you came through still checks every request. Opening a book sends a GET to the library, and the gate checks it again, even though you're already inside.",
        },
        {
          who: 'Librarian',
          text: "The Royal Ledger on the lectern is different. Writing in it sends a POST, and the gate's rule only lets scribes do that. Go ahead and try: the denial will show you which rule failed.",
          links: [link('request')],
        },
        {
          who: 'Librarian',
          text: "And no, I can't make you a scribe. No one in the kingdom can yet. The point is to watch the rule that fails.",
        },
      ],
      () => learn('request'),
    ),
}

export const talk = (npc: NpcId) => SCRIPTS[npc]()

export function openChest(): boolean {
  if (hasSteel() || stage() !== 'knight') return false
  quest.send({ type: 'STEEL_TAKEN' })
  quest.say(
    [
      { who: 'Armory', text: 'You found the Steel Sword! Strong enough to break cracked rock.' },
      {
        who: 'Armory',
        text: "In Pomerium the policy lives on the route. People don't carry policies around. They carry identity, and each route decides.",
        links: [link('onroute')],
      },
    ],
    () => learn('onroute'),
  )

  return true
}

export async function readBook(index: number) {
  const book = BOOKS[index % BOOKS.length]

  if (!book) return
  const outcome = await attempt(zoneById('library'), 'GET', `books/${index}`)

  if (outcome.kind !== 'allow') return
  const lesson = book.links?.[0]
  quest.say([book], () => {
    for (const id of LESSON_ORDER) if (LESSONS[id].link === lesson) learn(id)
  })
}

export async function writeLedger() {
  const outcome = await attempt(zoneById('library'), 'POST', 'ledger')

  if (outcome.kind === 'allow')
    quest.say([{ who: 'Royal Ledger', text: 'Your words are recorded. You must be a scribe.' }])
}

// game.localhost.pomerium.io → localhost.pomerium.io; a bare host like localhost stays as is.
const siblingDomain = () => {
  const [first, ...rest] = location.hostname.split('.')

  return rest.length > 0 ? rest.join('.') : first
}

/** The town fountain restores half a heart per drink, up to two full hearts each game. */
export const FOUNTAIN_LIMIT = 4

const hearts = (halves: number) => {
  const whole = Math.floor(halves / 2)

  if (halves % 2 === 0) return `${whole} ${whole === 1 ? 'heart' : 'hearts'}`

  return whole ? `${whole}½ hearts` : 'half a heart'
}

export function drinkFromFountain() {
  const { hp, progress } = quest.get()
  const left = FOUNTAIN_LIMIT - progress.fountainHealed
  const say = (text: string) => quest.say([{ who: 'Town Fountain', text }])

  if (hp >= MAX_HP) {
    say("Cool, fresh water. You're already at full health.")

    return
  }

  if (left <= 0) {
    say("The water still runs, but it can't restore any more hearts this game.")

    return
  }

  quest.setHp(hp + 1)
  quest.progress({ fountainHealed: progress.fountainHealed + 1 })
  say(
    left > 1
      ? `You drink the cool water and feel a little better: half a heart restored. The fountain has ${hearts(left - 1)} left to give this game.`
      : "You drink the cool water and feel a little better: half a heart restored. That's all the fountain can give this game.",
  )
}

// The forge is scenery: something to read in the armory, never something to take.
export const readAnvil = () =>
  quest.say([
    {
      who: 'Anvil',
      text: 'A heavy iron anvil, its face worn bright by years of hammering. Every blade in the kingdom was shaped here. Forging a sword never decided who may carry it through the gate.',
    },
  ])

export const readWorkbench = () =>
  quest.say([
    {
      who: 'Workbench',
      text: "Hammers, tongs and a whetstone, laid out in neat rows. They belong to the Armorer, and you're only here to look.",
    },
  ])

/** Each fish from the village pond restores half a heart, up to two full hearts each game. */
export const FISH_LIMIT = 4

/** Eats a caught fish if it would help. Returns false to leave the fish in the pond. */
export function eatFish(): boolean {
  const { hp, progress } = quest.get()
  const left = FISH_LIMIT - progress.fishEaten

  if (hp >= MAX_HP) {
    quest.toast("You're full. The fish can stay in the pond for now.", 'info')

    return false
  }

  if (left <= 0) {
    quest.toast("You've eaten all the fish you can this game.", 'info')

    return false
  }

  quest.setHp(hp + 1)
  quest.progress({ fishEaten: progress.fishEaten + 1 })
  quest.toast(
    left > 1
      ? `You catch a fish and eat it: half a heart restored. Fish can give ${hearts(left - 1)} more this game.`
      : "You catch a fish and eat it: half a heart restored. That's the last the pond can give this game.",
    'info',
  )

  return true
}

export function nightGate() {
  quest.log({ decision: 'NO ROUTE', method: 'GET', path: 'night-market', who: who(identity()) })
  quest.showDeny(
    {
      status: 404,
      title: 'No route',
      requestLine: `GET https://night-market.${siblingDomain()}/`,
      who: who(identity()),
      lines: [],
      hint: 'Pomerium only proxies addresses it has a route for, and there is no route for the Night Market yet. You have reached the end of chapter one: the market opens in chapter two, with time-based rules.',
      links: [link('notFound')],
    },
    () => {
      learn('notFound')
      quest.say(END_SIGN)
    },
  )
}
