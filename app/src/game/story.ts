// What happens when the player talks, reads or asks a guard to let them through a gate. The scene handles
// movement and drawing; this module handles the conversation with Pomerium.
import { probe, refreshClaimsUrl, requestZone, signInUrl, type Outcome } from './access.ts'
import {
  BOOKS,
  LESSONS,
  LESSON_ORDER,
  SIGN_DOCS,
  STALE_DOCS,
  SIGN_TEXT,
  link,
  type LessonId,
  type Page,
  type SignId,
} from './content.ts'
import { decide, routeYaml, type Identity } from './ppl.ts'
import { VISITORS, type VisitorId } from './house.ts'
import { addDeed, citizenshipPages } from './house-story.ts'
import { KNIGHT_QUOTA, hasSteel, isAtLeast, stage, type QuestStage } from './quest-machine.ts'
import { sfx } from './sound.ts'
import { MAX_HP, quest, type DenyView, type LogEntry } from './store.ts'
import type { Gate, GateRequest, NpcId } from './world.ts'
import { zoneById, type Zone } from './zones.ts'

const UPSTREAM = 'http://quest.quest.svc.cluster.local:3000'

/** Townsfolk as Pomerium sees them: the same accounts that visit the player's house. */
const townsperson = (id: VisitorId): Identity => {
  const { email, groups } = VISITORS[id]

  return { authenticated: true, email, groups }
}

const TRAVELER = townsperson('traveler')
const BAKER = townsperson('baker')

const learn = (lesson: LessonId) => quest.learn(lesson, LESSONS[lesson].title)
const identity = () => quest.get().identity

/** The groups the player's session carried before they last signed in again, while known. */
let groupsBeforeSignIn: readonly string[] | null = null
const who = (id: Identity) => (id.authenticated ? id.email : 'anonymous')

const claimsCode = (id: Identity) =>
  JSON.stringify({ email: id.email, email_verified: true, groups: id.groups, deed: id.deed }, null, 2)

const isCitizen = (id: Identity) => id.groups.includes('citizen')

const NOT_A_CITIZEN =
  "Every allow rule needs claim/groups: citizen, and the groups claim in your session doesn't include it. When no rule matches, Pomerium denies the request."

/** The Royal Keep checks three things at once; say which ones the player still lacks. */
function keepRefusal(id: Identity): Refusal {
  const vouched = vouchedGroups()
  const missing: string[] = []

  if (!isCitizen(id)) missing.push('a citizen (the Oracle can make you one)')

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
      text: `The guard of the Royal Keep reads your papers twice. "My orders: only knights who are also scholars. You still need to be ${missing.join(', and ')}."`,
    },
    hint: `The keep's one rule needs claim/groups: citizen, claim/groups: knights and claim/groups: scholars. In an and rule every check must pass; the ✗ lines are the ones your session fails.`,
  }
}

/**
 * Why a guard refused, told twice: as the kingdom sees it, and as Pomerium decided it. In the kingdom the
 * policy is the guard's orders and the session is the papers the player carries.
 */
interface Refusal {
  readonly story: DenyView['story']
  readonly hint: string
}

function refusal(zone: Zone, id: Identity): Refusal {
  const citizensOnly = (place: string): Refusal => ({
    story: {
      title: 'Citizens only',
      text: `The guard lowers a spear across the road. "${place} is for citizens. Those are my orders. Your papers say ${id.email}, but nothing in them says citizen, so I can't let you pass."`,
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
          text: 'The guard doesn\'t budge. "My orders say knights only, and nothing in your papers says knight. The Captain in the Knights\' Guild can vouch for you."',
        },
        hint: "The armory's only rule needs claim/groups: knights, and the groups claim in your session doesn't include knights.",
      }
    case 'keep':
      return keepRefusal(id)
    case 'library':
      return citizensOnly('The library')
    case 'scriptorium':
      if (!isCitizen(id)) return citizensOnly('The scriptorium')

      return {
        story: {
          title: 'Scribes only',
          text: 'The scriptorium guard bars the door. "This room is for writing in the Royal Ledger, and my orders say only scribes may come in. Your papers say you may read, not write."',
        },
        hint: `The scriptorium's path, ${zone.prefix}, is inside the library's, so Pomerium matched this more specific route and checked its policy instead. Its only rule needs claim/groups: scribes, and the groups claim in your session doesn't include scribes. No rule matched, so Pomerium denied it. This denial is the lesson.`,
      }

    default:
      return {
        story: { title: "The guard won't let you pass", text: '"Sorry, my orders don\'t cover you."' },
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
        title: "The guard doesn't know you",
        text: 'The guard holds out a hand. "Papers, please. My orders are to let in only people the Oracle has vouched for, and you have no papers at all. His temple is back in Hearth Village."',
      },
      requestLine,
      who: 'anonymous',
      lines: decision.lines,
      hint: 'You have no session yet. Pomerium sends anyone without one to the identity provider to sign in, then back here. Visit the Oracle in his temple back in Hearth Village.',
      links: [link('idp'), link('authz')],
      ...fromPomerium,
    }
  }

  // The game's view of the session comes from the JWT on its last request, which already carries
  // the new claims. If Pomerium still says no, its authorize step is deciding with what it cached
  // about the user (for up to a minute), not with the papers the player now holds.
  const stale = decision.allow
  // What Pomerium most likely decided with: the groups from before the player signed in again.
  const cached = stale && groupsBeforeSignIn ? { ...id, groups: groupsBeforeSignIn } : null
  const lines = cached ? decide(zone, cached, { method, path }).lines : decision.lines
  const fromCache = stale ? { cachedClaims: { session: id.groups, cached: groupsBeforeSignIn } } : {}

  const { story, hint } = stale
    ? {
        story:
          zone.id === 'armory'
            ? {
                title: 'Easy there, Sir Eager',
                text: 'The guard squints at your papers. "Knighted this very minute, were you? The ink\'s still wet. Go polish your sword for a bit, then come back."',
              }
            : {
                title: 'The ink is still wet',
                text: 'The guard peers at your papers. "A scholar, is it? Then you\'ll know the first rule of scholarship: let the ink dry before you wave it about. Give it a minute."',
              },
        hint: 'Try again in a moment. Once the cached copy expires, Pomerium reads your updated user record and the guard lets you through.',
      }
    : refusal(zone, id)

  return {
    status: 403,
    title: 'Access denied',
    story,
    requestLine,
    who: who(id),
    lines,
    hint,
    links: stale ? STALE_DOCS : [link('authz'), link('defaultDeny')],
    ...fromPomerium,
    ...fromCache,
  }
}

/**
 * Sends a request, records it in the access log, and shows the denial screen when refused. `askSignIn`
 * false skips the sign-in screen, for callers that handle a missing session themselves.
 */
async function attempt(
  zone: Zone,
  method: 'GET' | 'POST',
  action: string,
  askSignIn = true,
): Promise<Outcome> {
  const id = identity()
  const path = `${zone.prefix}/${action}`
  const outcome = await requestZone(zone, method, action)
  const decision = LOG_DECISION[outcome.kind]
  quest.log({ decision, method, path, who: who(id) })

  if (outcome.kind === 'signin' && askSignIn)
    quest.showDeny(denyView(zone, method, path, id, true, outcome.requestId))

  if (outcome.kind === 'deny') {
    const view = denyView(zone, method, path, id, false, outcome.requestId)
    quest.showDeny(view, () => {
      learn('authz')

      if (zone.id === 'keep') learn('allOf')

      if (view.links.includes(link('refresh'))) learn('refresh')
    })
  }

  if (outcome.kind === 'error') quest.toast(`The guard couldn't get an answer: ${outcome.message}`, 'deny')

  return outcome
}

/**
 * Asks a gate's route to let the player through with a GET to enter.
 * Leaving with no session at all means the game lost it, so the caller restarts the player instead.
 */
export async function enterGate(
  { zoneId, method, action }: GateRequest,
  leaving = false,
): Promise<Outcome['kind']> {
  const zone = zoneById(zoneId)
  const outcome = await attempt(zone, method, action, !leaving)

  if (outcome.kind !== 'allow') return outcome.kind
  quest.toast(`ALLOW · ${method} ${zone.prefix}/${action}`, 'allow')
  learn('every')
  learn('route')

  if (zone.id === 'armory' || zone.id === 'library') learn('jwt')

  if (zone.id === 'keep') {
    learn('allOf')
    sfx('victory')
    quest.openFinale()
  }

  return 'allow'
}

const signPage = (signId: SignId, zone: Zone): Page => ({
  who: `Sign · ${zone.name}`,
  text: SIGN_TEXT[signId] ?? '',
  code: routeYaml(zone, location.host, UPSTREAM),
  links: SIGN_DOCS[signId] ?? [],
})

/** Shows a gate's sign: its own words above the route config of the zone the gate asks. */
export function readSign({ signId, zoneId }: Pick<Gate, 'signId' | 'zoneId'>) {
  quest.say([signPage(signId, zoneById(zoneId))], () => learn('route'))
}

/** Runs a Pomerium sign-in in a frame over the game, then reads the session it left behind. */
function signInWithPomerium(url: string, onSignedIn: (next: Identity) => void, onCancel?: () => void) {
  quest.openSignIn(
    url,
    () => {
      void probe().then(({ identity: next }) => {
        if (!next.authenticated) {
          quest.toast('The Oracle did not sign you in', 'deny')

          return
        }

        groupsBeforeSignIn = identity().authenticated ? identity().groups : null
        quest.setIdentity(next)
        quest.signedIn(next)
        onSignedIn(next)
      })
    },
    onCancel,
  )
}

/** What the Oracle says to a newcomer who has signed in: the sage has news. */
const SAGE_HINT: Page = {
  who: 'Oracle',
  text: 'Before you go anywhere, speak with the sage. They have news for you.',
}

/** The Oracle makes an invited newcomer a citizen and grants their deed, then signs them in again to carry both. */
const grantCitizenship = () =>
  quest.say(
    [
      ...citizenshipPages(),
      {
        who: 'Oracle',
        text: 'Your session still holds the claims I gave you at sign-in, so let me sign you in again. Then it will carry them.',
        links: [link('refresh')],
      },
    ],
    () => {
      learn('refresh')

      void addDeed().then((added) => {
        if (!added) {
          quest.toast("The Oracle couldn't grant your claims. Talk to him again.", 'deny')

          return
        }

        quest.send({ type: 'CITIZEN_GRANTED' })
        refreshClaims(() => {})
      })
    },
  )

const welcome = (next: Identity) =>
  quest.say([
    { who: 'Oracle', text: `There. You are ${next.email}. Here are your claims.`, code: claimsCode(next) },
    ...(stage() === 'newcomer' ? [SAGE_HINT] : []),
  ])

const welcomeBack = (next: Identity, onDone?: () => void) =>
  quest.say(
    [
      {
        who: 'Oracle',
        text: 'Signed in again. Your new claims are below. Guards may take up to a minute to hear of them.',
        code: claimsCode(next),
      },
    ],
    onDone,
  )

/** Groups the Captain or the Librarian asked the Oracle to add, whether or not the session has them yet. */
function vouchedGroups() {
  const vouched: string[] = []

  if (isAtLeast('granted')) vouched.push('citizen')

  if (isAtLeast('knighted')) vouched.push('knights')

  if (quest.get().progress.scholar) vouched.push('scholars')

  return vouched
}

/** Groups the Oracle lists for the player that their session doesn't carry yet. */
const staleGroups = () => vouchedGroups().filter((group) => !identity().groups.includes(group))

/** Signs the player in again so their session carries the groups the Oracle has added since. */
function refreshClaims(onDone: () => void) {
  signInWithPomerium(
    refreshClaimsUrl(),
    (next) => welcomeBack(next, onDone),
    () => {
      onDone()
      quest.toast("You can sign in again at the Oracle's temple", 'info')
    },
  )
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
  const id = identity()

  if (!id.authenticated) {
    const intro: Page[] = [
      { who: 'Oracle', text: "I am the Oracle. I don't guard gates. I answer one question: who is this?" },
      {
        who: 'Oracle',
        text: 'In Pomerium terms, I am your identity provider, like Google, Okta or GitHub. Pomerium never sees your password. It sends you to me, I check who you are, and then I give Pomerium a signed token with your claims.',
        links: [link('idp')],
      },
    ]

    quest.say(
      [
        ...intro,
        {
          who: 'Oracle',
          text: `Step into the light and tell me who you are. New here? Introduce yourself with your email and a password.`,
        },
      ],
      () => {
        learn('idp')
        signInWithPomerium(signInUrl(), welcome)
      },
    )

    return
  }

  // The sage tells a newcomer they're entitled to citizenship and a house; the Oracle grants both after that.
  if (stage() === 'newcomer') {
    quest.say([SAGE_HINT])

    return
  }

  if (stage() === 'invited') {
    grantCitizenship()

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
  const { defeated } = quest.get()

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
        text: 'Bot slimes plague the fields, hammering every gate at once, never tiring. And watch for strangers in dark robes, dressed as the Oracle. Those are phish, and no sword will help you there.',
      },
      {
        who: 'Captain',
        text: `Prove yourself: defeat ${KNIGHT_QUOTA} bot slimes, then come back. So far: ${Math.min(defeated.bot, KNIGHT_QUOTA)} of ${KNIGHT_QUOTA}.`,
      },
    ])

    return
  }

  const outcome = await attempt(zoneById('guild'), 'POST', 'knight')

  if (outcome.kind !== 'allow') return
  quest.send({ type: 'KNIGHTED' })

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
        text: "But this town only lets in citizens, and the Oracle hasn't made me one. Signing in got me as far as the guard. It didn't get me past them.",
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
            text: `The town guard turns the Traveler away. The Oracle knows them as ${TRAVELER.email}, but the town only opens to citizens.`,
          },
          requestLine: `GET ${location.origin}${path}`,
          who: TRAVELER.email,
          lines: decide(town, TRAVELER, { method: 'GET', path }, 'their').lines,
          hint: "Their groups claim has no citizen in it, and only citizens may enter. This was the Traveler's request: your own access hasn't changed.",
          links: [link('authz'), link('defaultDeny')],
        },
        () => learn('authz'),
      )
    },
  )
}

/** The Traveler's counterpart: same guard, same orders, but this citizen gets in. */
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
        text: `The guard checks me every single time, same as everyone. My groups claim says citizen, so I match the guard's orders and I'm let through.`,
      },
      {
        who: 'Baker',
        text: 'The Traveler outside faces the same guard and the same orders. The only difference is who we are.',
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

/** The sage once the player has signed in: a newcomer is told they're entitled to citizenship and a house. */
function sageAfterSignIn() {
  switch (stage()) {
    case 'newcomer':
      quest.say(
        [
          {
            who: 'Sage',
            text: "The Oracle knows who you are. That's not the same as being a citizen: the guards in town want to see it in your papers.",
            links: [link('claims')],
          },
          {
            who: 'Sage',
            text: "You're about to become a citizen. And every citizen is entitled to a house outside the walls: an empty one in the Slime Fields, just below the pond.",
          },
          {
            who: 'Sage',
            text: 'Go and see the Oracle again. He will put two claims in your papers: a group called citizen, and the deed to your house.',
          },
        ],
        () => quest.send({ type: 'SAGE_SPOKE' }),
      )

      return
    case 'invited':
      quest.say([
        {
          who: 'Sage',
          text: 'Go and see the Oracle, in his temple to the west. He will put your citizen group and the deed to your house in your papers.',
        },
      ])

      return
    case 'granted':
      quest.say([
        {
          who: 'Sage',
          text: 'The Oracle has made you a citizen, but your papers still show the old claims. Visit him once more, and he will sign you in again.',
        },
      ])

      return
    default:
      quest.say([
        {
          who: 'Sage',
          text: 'Head north through the Fields Gate. A guard stands at every gate, and the sign beside it shows the exact orders that guard follows.',
        },
        {
          who: 'Sage',
          text: 'Your house stands out in the Slime Fields, just below the pond. Nobody guards it but its own door rules, and the slimes have noticed.',
        },
      ])
  }
}

const SCRIPTS: Record<NpcId, () => void> = {
  sage: () => {
    if (identity().authenticated) {
      sageAfterSignIn()

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
          text: 'Here every guard checks you each time you pass. Pomerium works the same way: each request to each app is checked against that app’s policy.',
          links: [link('every')],
        },
        {
          who: 'Sage',
          text: "Bot slimes and phish roam the fields, and both mean harm. The bots hammer the town gate day and night, but they'll never get in. They can't prove they're citizens, and the guard checks every one of them, every time.",
        },
        {
          who: 'Sage',
          text: "The phish are craftier. They don't storm the gate. They dress up as the Oracle, robes and all, and offer to sign you in, because a guard can't tell stolen papers from yours. The real Oracle keeps to his temple. Only ever sign in there.",
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
  baker,
  captain: () => void captain(),
  armorer: () => {
    const armorerIntro =
      "I forge the blades. I don't decide who gets in: the guard does. The guard checks your claims on every visit. Their orders are on the sign: only the knights group."

    // The Armorer keeps the forge; the guard decides. Each stage gets a line about what the guard sees.
    const lines: Record<QuestStage, string> = {
      anonymous: armorerIntro,
      newcomer: armorerIntro,
      invited: armorerIntro,
      granted: armorerIntro,
      citizen: armorerIntro,
      proven: `${armorerIntro} The Captain can vouch for you.`,
      knighted:
        "The Oracle lists you as a knight? Then your session hasn't caught up. The guard reads the claims in your session, and those were set when you signed in: groups: []. Pomerium refreshes them from the Oracle now and then, but sign in with him again and you won't have to wait.",
      knight:
        'Your session says groups: [knights] now, so the guard will let you through. The steel sword is in the chest inside.',
      armed:
        "Same guard, same orders as before you were a knight. You didn't unlock a policy. You gained the claim it was waiting for.",
    }

    const text = lines[stage()]

    quest.say([hasSteel() ? { who: 'Armorer', text, links: [link('onroute')] } : { who: 'Armorer', text }])
  },
  librarian: () => void librarian(),
}

const LIBRARIAN_INTRO: Page[] = [
  {
    who: 'Librarian',
    text: "Read anything you like. The guard at the front door still checks every request, even now that you're inside. Opening a book sends a GET to the library, and the guard checks it again.",
  },
  {
    who: 'Librarian',
    text: "My shelves are for reading only. The library's rule lets citizens send a GET, which reads, and nothing else. A rule can check the request itself, not just who sent it.",
    links: [link('request')],
  },
  {
    who: 'Librarian',
    text: "The Royal Ledger is next door, in the scriptorium. Its path is inside the library's, but it's a route of its own, with a guard who follows its own rule: scribes only. Go ahead and try: the denial will show you which rule failed.",
  },
  {
    who: 'Librarian',
    text: "And no, I can't make you a scribe. No one in the kingdom can yet. The point is to watch the rule that fails.",
  },
]

async function librarian() {
  const { progress } = quest.get()

  if (progress.scholar) {
    quest.say([
      {
        who: 'Librarian',
        text: 'The Royal Keep lies at the end of the road that runs south, just west of the library. Its guard wants citizens who are knights and scholars, and checks all three at once.',
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

/** The address a phish's sign-in page lives at: close to the kingdom's, and not it. */
const PHISH_DOMAIN = 'game-login.net'

/**
 * A phish, dressed as the Oracle, offers to sign the player in. Accepting loses the game;
 * refusing sends it away (`onTurnedAway`).
 */
export function meetPhish(onTurnedAway: () => void) {
  quest.say([
    {
      who: 'Oracle?',
      text: "Ah, there you are! I am the Oracle. Your session is about to expire, and then every guard will turn you away. Quick, there's no time to walk back to the temple.",
    },
    {
      who: 'Oracle?',
      text: `Just sign in with me right here. My page is at oracle.${PHISH_DOMAIN}. Your email and password, that's all I need.`,
      choices: [
        {
          label: 'Sign in here',
          pick: () => {
            sfx('laugh')
            quest.say([{ who: 'Oracle?', text: 'Thank you kindly. Heh. Heh heh heh…' }], () =>
              quest.fallForPhish(),
            )
          },
        },
        {
          label: 'No. I only sign in at the temple.',
          pick: () =>
            quest.say(
              [
                {
                  who: 'Oracle?',
                  text: 'Hmph. Suit yourself. The robe slips as it turns away: no beard, just scales.',
                },
                {
                  who: 'Pomerium Quest',
                  text: `That was a phish. The real Oracle never comes looking for your password, and his page is never at ${PHISH_DOMAIN}. Only ever sign in with your real identity provider.`,
                  links: [link('idp')],
                },
              ],
              onTurnedAway,
            ),
        },
      ],
    },
  ])
}

export function openChest(): boolean {
  if (hasSteel() || stage() !== 'knight') return false
  quest.send({ type: 'STEEL_TAKEN' })
  sfx('itemGet')
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

  sfx('drink')
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
      text: 'A heavy iron anvil, its face worn bright by years of hammering. Every blade in the kingdom was shaped here. Forging a sword never decided who may carry it past the guard.',
    },
  ])

export const readWorkbench = () =>
  quest.say([
    {
      who: 'Workbench',
      text: "Hammers, tongs and a whetstone, laid out in neat rows. They belong to the Armorer, and you're only here to look.",
    },
  ])

/** Each fish from a pond restores half a heart, up to two full hearts each game. */
export const FISH_LIMIT = 4

/** Eats a caught fish if it would help. Returns false to leave the fish in the pond. */
export function eatFish(): boolean {
  const { hp, progress } = quest.get()
  const left = FISH_LIMIT - progress.fishEaten
  const say = (text: string) => quest.say([{ who: 'Pond', text }])

  if (hp >= MAX_HP) {
    say("A fish darts past. You're already at full health, so you let it be.")

    return false
  }

  if (left <= 0) {
    say("The fish are wise to you now. You can't catch any more this game.")

    return false
  }

  sfx('chomp')
  quest.setHp(hp + 1)
  quest.progress({ fishEaten: progress.fishEaten + 1 })
  say(
    left > 1
      ? `You catch a fish and gulp it down: half a heart restored. The ponds have ${hearts(left - 1)} left to give this game.`
      : "You catch a fish and gulp it down: half a heart restored. That's all the ponds can give this game.",
  )

  return true
}
