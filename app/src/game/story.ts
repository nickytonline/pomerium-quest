// What happens when the player talks, reads or walks into a gate. The scene handles
// movement and drawing; this module handles the conversation with Pomerium.
import { refreshClaimsUrl, requestZone, signInUrl, simulatedIdentity, type Outcome } from './access.ts'
import { BOOKS, END_SIGN, LESSONS, SIGN_DOCS, SIGN_TEXT, link, type LessonId, type Page } from './content.ts'
import { decide, routeYaml, type Identity } from './ppl.ts'
import { KNIGHT_XP, hasSteel, isAtLeast, stage } from './quest-machine.ts'
import { quest, type DenyView } from './store.ts'
import type { NpcId } from './world.ts'
import { KINGDOM_DOMAIN, zoneById, type Zone } from './zones.ts'

const UPSTREAM = 'http://quest.quest.svc.cluster.local:3000'
const TRAVELER: Identity = {
  authenticated: true,
  email: 'wanderer@outlands.net',
  claims: { email: 'wanderer@outlands.net', groups: [] },
}

const learn = (lesson: LessonId) => quest.learn(lesson, LESSONS[lesson].title)
const identity = () => quest.get().identity
const who = (id: Identity) => (id.authenticated ? id.email : 'anonymous')
const groupsOf = (id: Identity) => {
  const groups = id.claims['groups']
  return Array.isArray(groups) ? groups.map(String) : []
}

const claimsCode = (id: Identity) =>
  JSON.stringify({ email: id.email, email_verified: true, groups: groupsOf(id) }, null, 2)

const DENY_HINTS: Record<string, string> = {
  town: `Only citizens of ${KINGDOM_DOMAIN} may enter.`,
  guild: `Only citizens of ${KINGDOM_DOMAIN} may enter.`,
  armory: "Only the knights group may enter. The Captain in the Knights' Guild can vouch for you.",
  library: 'Reading is a GET and passes. Writing is a POST, so this request needs the scribes group.',
}

function denyView(zone: Zone, method: 'GET' | 'POST', path: string, id: Identity, signIn: boolean): DenyView {
  const decision = decide(zone, id, { method, path })
  const requestLine = `${method} ${location.origin}${path}`
  if (signIn) {
    return {
      status: 401,
      title: 'Sign in required',
      requestLine,
      who: 'anonymous',
      lines: decision.lines,
      hint: 'You have no session yet. Pomerium sends anyone without one to the identity provider to sign in, then back here. Visit the Oracle in the temple to the west.',
      links: [link('idp'), link('authz')],
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
      ? 'Pomerium said no, yet by the game’s records you qualify. Your session still holds the claims from when you signed in. Visit the Oracle to refresh them.'
      : (DENY_HINTS[zone.id] ?? 'No allow rule matched this request.'),
    links: stale ? [link('refresh'), link('claims')] : [link('authz'), link('defaultDeny')],
  }
}

/** Sends a request, records it in the access log, and shows the denial screen when refused. */
async function attempt(zone: Zone, method: 'GET' | 'POST', action: string): Promise<Outcome> {
  const { mode } = quest.get()
  const id = identity()
  const path = `${zone.prefix}/${action}`
  const outcome = await requestZone(mode, id, zone, method, action)
  const decision = outcome.kind === 'allow' ? 'ALLOW' : outcome.kind === 'signin' ? 'SIGN IN' : 'DENY'
  quest.log({ decision, method, path, who: who(id) })

  if (outcome.kind === 'signin') quest.showDeny(denyView(zone, method, path, id, true))
  if (outcome.kind === 'deny') {
    const view = denyView(zone, method, path, id, false)
    quest.showDeny(view, () => {
      learn('authz')
      if (view.links.includes(link('refresh'))) learn('refresh')
    })
  }
  if (outcome.kind === 'error') quest.toast(`The gate jammed: ${outcome.message}`, 'deny')
  return outcome
}

export async function enterGate(zoneId: string): Promise<boolean> {
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

export function readSign(signId: string) {
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
      quest.send({ type: 'SIGNED_IN', groups: groupsOf(next) })
      learn('idp')
      quest.say([{ who: 'Oracle', text: `There. You are ${next.email}. Here are your claims.`, code: claimsCode(next) }])
    })
    return
  }

  if (stage() === 'knighted' && !groupsOf(id).includes('knights')) {
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
        quest.send({ type: 'SIGNED_IN', groups: groupsOf(next) })
        quest.say([{ who: 'Oracle', text: 'Signed in again. Your new claims:', code: claimsCode(next) }])
      },
    )
    return
  }

  quest.say([{ who: 'Oracle', text: 'These are your claims as Pomerium sees them.', code: claimsCode(id) }])
}

async function captain() {
  const { xp, mode } = quest.get()
  if (isAtLeast('knighted')) {
    quest.say([
      {
        who: 'Captain',
        text: 'Go claim your steel. The armory is east of the square. If the guard turns you away, ask the Oracle to refresh your claims.',
      },
    ])
    return
  }
  if (stage() !== 'proven') {
    quest.say([
      { who: 'Captain', text: 'The armory is for knights only.' },
      {
        who: 'Captain',
        text: `Prove yourself first: clear ${KNIGHT_XP} slimes from the fields, then come back. Slimes defeated: ${Math.min(xp, KNIGHT_XP)} of ${KNIGHT_XP}.`,
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
      { who: 'Captain', text: "Well fought. I've written to the Oracle: from now on you are in the knights group." },
      {
        who: 'Captain',
        text: 'Notice what changed. Not the armory: its policy is the same as yesterday. Your identity changed. The Oracle now lists you in groups: [knights].',
      },
      {
        who: 'Captain',
        text: "Pomerium reads groups from your identity provider. It doesn't decide who is a knight. It checks the claim.",
        links: [link('claims')],
      },
    ],
    () => learn('claims'),
  )
}

function traveler() {
  const town = zoneById('town')
  quest.say(
    [
      { who: 'Traveler', text: "The Oracle knows me. I'm wanderer@outlands.net, signed in and everything." },
      {
        who: 'Traveler',
        text: `But this town only lets in people whose email domain is ${KINGDOM_DOMAIN}. Signing in got me to the guard. It didn't get me in.`,
      },
      { who: 'Traveler', text: 'Signing in says who you are. Policy says where you can go.', links: [link('authz')] },
    ],
    () => {
      quest.log({ decision: 'DENY', method: 'GET', path: `${town.prefix}/enter`, who: TRAVELER.email })
      quest.showDeny(denyView(town, 'GET', `${town.prefix}/enter`, TRAVELER, false), () => learn('authz'))
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
    if (hasSteel()) {
      quest.say([
        {
          who: 'Armorer',
          text: "You didn't unlock a policy. The policy was always there. You gained the claim it was waiting for.",
          links: [link('onroute')],
        },
      ])
      return
    }
    quest.say([
      {
        who: 'Armorer',
        text: "Knights only, I'm afraid. Nothing personal: the guard doesn't know you. He knows the policy and your claims.",
      },
    ])
  },
  librarian: () =>
    quest.say(
      [
        {
          who: 'Librarian',
          text: 'Read anything you like. Opening a book is a GET request, and the guard checks it every time.',
        },
        {
          who: 'Librarian',
          text: 'The Royal Ledger is different. Writing in it is a POST, and only scribes may do that. Go ahead and try: the denial will show you which rule failed.',
          links: [link('request')],
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
    for (const [id, entry] of Object.entries(LESSONS)) {
      // SAFETY: Object.entries over LESSONS yields its own keys.
      if (entry.link === lesson) learn(id as LessonId)
    }
  })
}

export async function writeLedger() {
  const outcome = await attempt(zoneById('library'), 'POST', 'ledger')
  if (outcome.kind === 'allow') quest.say([{ who: 'Royal Ledger', text: 'Your words are recorded. You must be a scribe.' }])
}

export function nightGate() {
  quest.log({ decision: 'NO ROUTE', method: 'GET', path: 'night-market', who: who(identity()) })
  quest.showDeny(
    {
      status: 404,
      title: 'No route',
      requestLine: `GET https://night-market.${location.hostname.split('.').slice(1).join('.')}`,
      who: who(identity()),
      lines: [],
      hint: 'Pomerium only proxies addresses it has a route for. There is no route for the Night Market yet: it opens in chapter two, with time-based rules.',
      links: [link('notFound')],
    },
    () => learn('notFound'),
  )
}
