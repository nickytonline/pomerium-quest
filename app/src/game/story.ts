// What happens when the player talks, reads or walks into a gate. The scene handles
// movement and drawing; this module handles the conversation with Pomerium.
import { probe, refreshClaimsUrl, requestZone, signInUrl, simulatedIdentity, type Outcome } from './access.ts'
import {
  BOOKS,
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

const BAKER: Identity = {
  authenticated: true,
  email: `baker@${KINGDOM_DOMAIN}`,
  groups: [],
}

const learn = (lesson: LessonId) => quest.learn(lesson, LESSONS[lesson].title)
const identity = () => quest.get().identity
const who = (id: Identity) => (id.authenticated ? id.email : 'anonymous')

const claimsCode = (id: Identity) =>
  JSON.stringify({ email: id.email, email_verified: true, groups: id.groups }, null, 2)

const domainOf = (id: Identity) => id.email.split('@')[1] ?? ''

const NOT_A_CITIZEN = `Every allow rule needs domain: ${KINGDOM_DOMAIN}, and your email's domain doesn't match. When no rule matches, Pomerium denies the request.`

/** The Royal Keep checks three things at once; say which ones the player still lacks. */
function keepRefusal(id: Identity): Refusal {
  const vouched = vouchedGroups()
  const missing: string[] = []

  if (domainOf(id) !== KINGDOM_DOMAIN) missing.push(`a citizen of ${KINGDOM_DOMAIN}`)

  if (!id.groups.includes('knights'))
    missing.push(
      vouched.includes('knights')
        ? "carrying your knight's papers (the Oracle can sign you in again at his temple)"
        : "a knight (the Captain in the Knights' Guild can vouch for you)",
    )

  if (!id.groups.includes('scholars'))
    missing.push(
      vouched.includes('scholars')
        ? "carrying your scholar's papers (the Oracle can sign you in again at his temple)"
        : 'a scholar (read every book in the library, then talk to the Librarian)',
    )

  return {
    story: {
      title: 'Knights who are scholars only',
      text: `The Royal Keep admits only knights who are also scholars. You still need to be ${missing.join(', and ')}.`,
    },
    hint: `The keep's one rule needs domain: ${KINGDOM_DOMAIN}, claim/groups: knights and claim/groups: scholars. In an and rule every check must pass; the ✗ lines are the ones your session fails.`,
  }
}

/** Why a gate refused, told twice: as the kingdom sees it, and as Pomerium decided it. */
interface Refusal {
  readonly story: DenyView['story']
  readonly hint: string
}

function refusal(zone: Zone, method: 'GET' | 'POST', id: Identity): Refusal {
  const citizensOnly = (place: string): Refusal => ({
    story: {
      title: 'Citizens only',
      text: `${place} only opens to citizens of ${KINGDOM_DOMAIN}. You're ${id.email}, from ${domainOf(id)}.`,
    },
    hint: NOT_A_CITIZEN,
  })

  switch (zone.id) {
    case 'town':
      return citizensOnly('The town')
    case 'guild':
      return citizensOnly("The Knights' Guild")
    case 'armory':
      return {
        story: {
          title: 'Knights only',
          text: "The armory is for knights, and you aren't one yet. The Captain in the Knights' Guild can vouch for you.",
        },
        hint: "The armory's only rule needs claim/groups: knights, and the groups claim in your session doesn't include knights.",
      }
    case 'keep':
      return keepRefusal(id)
    case 'library':
      return method === 'POST'
        ? {
            story: {
              title: 'Scribes only',
              text: "Anyone may read the books here, but only scribes may write in the Royal Ledger, and you aren't one.",
            },
            hint: "Writing in the ledger is a POST. The rule for readers only allows GET, so it doesn't match, and the other rule needs the scribes group, which you aren't in. This denial is the lesson.",
          }
        : citizensOnly('The library')
    default:
      return {
        story: { title: 'The gate stays shut', text: "This gate won't open for you." },
        hint: 'No allow rule matched this request, so Pomerium denied it.',
      }
  }
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
      story: {
        title: "The gate doesn't know you",
        text: "Gates here only open for people the Oracle has vouched for, and he hasn't met you yet. His temple is back in Hearth Village.",
      },
      requestLine,
      who: 'anonymous',
      lines: decision.lines,
      hint: 'You have no session yet. Pomerium sends anyone without one to the identity provider to sign in, then back here. Visit the Oracle in his temple back in Hearth Village.',
      links: [link('idp'), link('authz')],
      ...fromPomerium,
    }
  }

  const stale = decision.allow

  const { story, hint } = stale
    ? {
        story: {
          title: 'Old papers',
          text: "The Oracle has named you a knight, but the gate reads the papers he gave you when you signed in, and those don't say so yet. Visit his temple and sign in again for new papers.",
        },
        hint: 'Pomerium said no, yet by the game’s records you qualify. Your session still holds the claims from when you signed in. Pomerium refreshes them from the identity provider from time to time, but signing in again with the Oracle picks up the change now. If you just did, give Pomerium up to a minute to pick up the new claim.',
      }
    : refusal(zone, method, id)

  return {
    status: 403,
    title: 'Access denied',
    story,
    requestLine,
    who: who(id),
    lines: decision.lines,
    hint,
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

      if (zone.id === 'keep') learn('allOf')

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

  if (zone.id === 'keep') {
    learn('allOf')
    quest.openFinale()
  }

  return true
}

const signPage = (zone: Zone): Page => ({
  who: `Sign · ${zone.name}`,
  text: SIGN_TEXT[zone.id] ?? '',
  code: routeYaml(zone, location.host, UPSTREAM),
  links: SIGN_DOCS[zone.id] ?? [],
})

export function readSign(signId: ZoneId) {
  quest.say([signPage(zoneById(signId))], () => learn('route'))
}

/** Runs a Pomerium sign-in in a frame over the game, then reads the session it left behind. */
function signInWithPomerium(url: string, onSignedIn: (next: Identity) => void, onCancel?: () => void) {
  quest.openSignIn(
    url,
    () => {
      void probe(quest.get().progress).then(({ identity: next }) => {
        if (!next.authenticated) {
          quest.toast('The Oracle did not sign you in', 'deny')

          return
        }

        quest.setIdentity(next)
        quest.send({ type: 'SIGNED_IN', groups: next.groups })
        onSignedIn(next)
      })
    },
    onCancel,
  )
}

const welcome = (next: Identity) =>
  quest.say([
    { who: 'Oracle', text: `There. You are ${next.email}. Here are your claims.`, code: claimsCode(next) },
  ])

const welcomeBack = (next: Identity, onDone?: () => void) =>
  quest.say([{ who: 'Oracle', text: 'Signed in again. Your new claims:', code: claimsCode(next) }], onDone)

/** Groups the Captain or the Librarian asked the Oracle to add, whether or not the session has them yet. */
function vouchedGroups() {
  const vouched: string[] = []

  if (isAtLeast('knighted')) vouched.push('knights')

  if (quest.get().progress.scholar) vouched.push('scholars')

  return vouched
}

/** Groups the Oracle lists for the player that their session doesn't carry yet. */
const staleGroups = () => vouchedGroups().filter((group) => !identity().groups.includes(group))

/** Signs the player in again so their session carries the groups the Oracle has added since. */
function refreshClaims(onDone: () => void) {
  if (quest.get().mode === 'pomerium') {
    signInWithPomerium(
      refreshClaimsUrl(),
      (next) => welcomeBack(next, onDone),
      () => {
        onDone()
        quest.toast("You can sign in again at the Oracle's temple", 'info')
      },
    )

    return
  }

  const sim = quest.get().progress.sim
  quest.progress({ sim: { ...sim, groups: [...sim.groups, ...sim.pendingGroups], pendingGroups: [] } })
  const next = simulatedIdentity(quest.get().progress)
  quest.setIdentity(next)
  quest.send({ type: 'SIGNED_IN', groups: next.groups })
  welcomeBack(next, onDone)
}

const refreshPage = (): Page => ({
  who: 'Oracle',
  text: 'Pomerium decides with the claims in your session, and those are the ones I gave you when you signed in. It refreshes them from me now and then, but that can take a while. Let me sign you in again so your session carries the new one now.',
  code: claimsCode(identity()),
  links: [link('refresh')],
})

/** Rather than send the player back to his temple, the Oracle appears beside them with their new claim. */
function oracleArrives(letter: string) {
  quest.summonOracle()
  quest.say([{ who: 'Oracle', text: letter }, refreshPage()], () => {
    learn('refresh')
    refreshClaims(() => quest.dismissOracle())
  })
}

function oracle() {
  const { mode, progress } = quest.get()
  const id = identity()

  if (!id.authenticated) {
    const intro: Page[] = [
      { who: 'Oracle', text: "I am the Oracle. I don't open gates. I answer one question: who is this?" },
      {
        who: 'Oracle',
        text: 'In Pomerium terms, I am your identity provider, like Google, Okta or GitHub. Pomerium never sees your password. It sends you to me, I check who you are, and then I give Pomerium a signed token with your claims.',
        links: [link('idp')],
      },
    ]

    if (mode === 'pomerium') {
      quest.say([...intro, { who: 'Oracle', text: 'Step into the light and tell me who you are.' }], () => {
        learn('idp')
        signInWithPomerium(signInUrl(), welcome)
      })

      return
    }

    quest.say(intro, () => {
      quest.progress({ sim: { ...progress.sim, signedIn: true } })
      const next = simulatedIdentity(quest.get().progress)
      quest.setIdentity(next)
      quest.send({ type: 'SIGNED_IN', groups: next.groups })
      learn('idp')
      welcome(next)
    })

    return
  }

  const stale = staleGroups()

  if (stale.length > 0) {
    quest.say(
      [{ who: 'Oracle', text: `I have added ${stale.join(' and ')} to your groups.` }, refreshPage()],
      () => {
        learn('refresh')
        refreshClaims(() => {})
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
            ? 'The Oracle has your new claim, but your session still carries the old one. Visit him in the temple and sign in again, then claim your steel in the armory, east of here across the square.'
            : 'Go claim your steel. The armory is east of here, across the square.',
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
        text: "One catch: your session still holds the claims from when you signed in, so your groups don't say knights yet. Pomerium would catch up on its own in time, but you needn't wait. Ah, here comes the Oracle.",
      },
    ],
    () => {
      learn('claims')
      oracleArrives("The Captain's letter arrived. I've added knights to your groups.")
    },
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
        text: `But this town only lets in people whose email domain is ${KINGDOM_DOMAIN}. Signing in got me to the gate. It didn't get me in.`,
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
          story: {
            title: 'Not a citizen',
            text: `The town gate turns the Traveler away. The Oracle knows them as ${TRAVELER.email}, but the town only opens to citizens of ${KINGDOM_DOMAIN}.`,
          },
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

/** The Traveler's counterpart: same gate, same rule, but this citizen gets in. */
function baker() {
  const town = zoneById('town')
  const path = `${town.prefix}/enter`
  quest.say(
    [
      {
        who: 'Baker',
        text: `Morning! I'm ${BAKER.email}. I bring bread in through the town gate every day.`,
      },
      {
        who: 'Baker',
        text: `The gate checks me every single time, same as everyone. My email domain is ${KINGDOM_DOMAIN}, so its rule matches and it lets me through.`,
      },
      {
        who: 'Baker',
        text: 'The Traveler outside faces the same gate and the same rule. The only difference is who we are.',
        links: [link('authz')],
      },
    ],
    () => {
      quest.log({ decision: 'ALLOW', method: 'GET', path, who: BAKER.email })
      quest.toast(`ALLOW · GET ${path} as ${BAKER.email}`, 'allow')
      learn('authz')
    },
  )
}

const SCRIPTS: Record<NpcId, () => void> = {
  sage: () => {
    if (identity().authenticated) {
      quest.say([
        {
          who: 'Sage',
          text: 'The Oracle vouches for you now. Head north through the Fields Gate. Read the sign beside each gate: it shows the exact rule that gate enforces.',
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
          text: 'Here every gate checks you each time you pass. Pomerium works the same way: each request to each app is checked against that app’s policy.',
          links: [link('every')],
        },
        {
          who: 'Sage',
          text: "Bot slimes and phish roam the fields, and both mean harm. The bots hammer the town gate day and night, but they'll never get in. They can't prove they're citizens, and the gate checks every one of them, every time.",
        },
        {
          who: 'Sage',
          text: "The phish are craftier. They don't storm the gate. They try to trick you into handing over your sign-in, because a gate can't tell a stolen sign-in from yours. Only ever sign in with the Oracle.",
        },
        {
          who: 'Sage',
          text: 'Gates only let in people they can identify. Visit the Oracle in the temple to the west.',
        },
      ],
      () => learn('every'),
    )
  },
  oracle,
  traveler,
  baker,
  captain: () => void captain(),
  armorer: () => {
    const armorerIntro =
      "I forge the blades. I don't decide who gets in: the gate does. It checks your claims on every visit. Its rule is on the sign: only the knights group."

    // The Armorer keeps the forge; the gate decides. Each stage gets a line about what the gate sees.
    const lines: Record<QuestStage, string> = {
      anonymous: armorerIntro,
      citizen: armorerIntro,
      proven: `${armorerIntro} The Captain can vouch for you.`,
      knighted:
        "The Oracle lists you as a knight? Then your session hasn't caught up. The gate reads the claims in your session, and those were set when you signed in: groups: []. Pomerium refreshes them from the Oracle now and then, but sign in with him again and you won't have to wait.",
      knight:
        'Your session says groups: [knights] now, so the gate will let you through. The steel sword is in the chest inside.',
      armed:
        "Same gate, same rule as before you were a knight. You didn't unlock a policy. You gained the claim it was waiting for.",
    }

    const text = lines[stage()]

    quest.say([hasSteel() ? { who: 'Armorer', text, links: [link('onroute')] } : { who: 'Armorer', text }])
  },
  librarian: () => void librarian(),
}

const LIBRARIAN_INTRO: Page[] = [
  {
    who: 'Librarian',
    text: "Read anything you like. There's no gate in here, but the one you came through still checks every request. Opening a book sends a GET to the library, and the gate checks it again, even though you're already inside.",
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
]

async function librarian() {
  const { mode, progress } = quest.get()

  if (progress.scholar) {
    quest.say([
      {
        who: 'Librarian',
        text: 'The Royal Keep lies at the end of the road that runs south, just west of the library. Its gate wants citizens who are knights and scholars, and checks all three at once.',
      },
    ])

    return
  }

  const left = BOOKS.length - progress.booksRead.length

  if (left > 0) {
    quest.say(
      [
        ...LIBRARIAN_INTRO,
        {
          who: 'Librarian',
          text: `I can make you a scholar, though. Scholars read; scribes write. Read every book on my shelves and come back: ${left} of ${BOOKS.length} to go.`,
        },
      ],
      () => learn('request'),
    )

    return
  }

  const outcome = await attempt(zoneById('oracle'), 'POST', 'scholar')

  if (outcome.kind !== 'allow') return
  quest.progress({ scholar: true })

  if (mode === 'simulated') {
    const sim = quest.get().progress.sim
    quest.progress({ sim: { ...sim, pendingGroups: [...sim.pendingGroups, 'scholars'] } })
  }

  quest.say(
    [
      {
        who: 'Librarian',
        text: "You've read every book on my shelves. I've written to the Oracle: from now on you are in the scholars group.",
      },
      {
        who: 'Librarian',
        text: "Scholars read and scribes write, so the ledger still won't take your pen. But the Royal Keep, down the road southwest of here, wants knights who are scholars too.",
        links: [link('claims')],
      },
    ],
    () => oracleArrives("The Librarian's letter arrived. I've added scholars to your groups."),
  )
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
  const which = index % BOOKS.length
  const { booksRead, scholar } = quest.get().progress
  const firstRead = !booksRead.includes(which)

  if (firstRead) quest.progress({ booksRead: [...booksRead, which] })

  quest.say([book], () => {
    for (const id of LESSON_ORDER) if (LESSONS[id].link === lesson) learn(id)

    if (firstRead && !scholar && quest.get().progress.booksRead.length === BOOKS.length)
      quest.toast("You've read every book. The Librarian would like a word.", 'info')
  })
}

export async function writeLedger() {
  const outcome = await attempt(zoneById('library'), 'POST', 'ledger')

  if (outcome.kind === 'allow')
    quest.say([{ who: 'Royal Ledger', text: 'Your words are recorded. You must be a scribe.' }])
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
  const say = (text: string) => quest.say([{ who: 'Village Pond', text }])

  if (hp >= MAX_HP) {
    say("A fish darts past. You're already at full health, so you let it be.")

    return false
  }

  if (left <= 0) {
    say("The fish are wise to you now. You can't catch any more this game.")

    return false
  }

  quest.setHp(hp + 1)
  quest.progress({ fishEaten: progress.fishEaten + 1 })
  say(
    left > 1
      ? `You catch a fish and gulp it down: half a heart restored. The pond has ${hearts(left - 1)} left to give this game.`
      : "You catch a fish and gulp it down: half a heart restored. That's all the pond can give this game.",
  )

  return true
}
