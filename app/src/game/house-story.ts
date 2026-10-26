// The player's house: the deed, the letters, the desk, the bell and the visitors (docs/prd/your-house.md).
// Every knock is a real request through Pomerium; the server writes the house's route from the player's
// door rules, and the explanations below come from the same rules.
import { houseStatus, knockAs, knockYourself, openHouse, saveHouse } from './access.ts'
import { LESSONS, LETTERS, link, type Caller, type LessonId, type Letter } from './content.ts'
import { VISITORS, type HouseRule, type HouseState, type Knocker } from './house.ts'
import { houseStage, type LetterStage } from './house-machine.ts'
import { decide, policyYaml, type EvalLine, type Identity } from './ppl.ts'
import { sfx } from './sound.ts'
import { ANONYMOUS, quest, type VisitResult } from './store.ts'

const learn = (lesson: LessonId) => quest.learn(lesson, LESSONS[lesson].title)
const rules = () => quest.get().progress.houseRules

/** The stage's letter, if there's one on the doormat. */
export const currentLetter = (): Letter | null => {
  const stage = houseStage()

  return stage === 'unowned' || stage === 'done' ? null : LETTERS[stage satisfies LetterStage]
}

/** Who each caller is to Pomerium. Slimes carry no session at all. */
function identityOf(who: Caller): Identity {
  if (who === 'you') return quest.get().identity

  if (who === 'slime') return ANONYMOUS

  const visitor = VISITORS[who]

  return { authenticated: true, email: visitor.email, groups: visitor.groups }
}

const nameOf = (who: Caller) => {
  if (who === 'you') return 'You'

  if (who === 'slime') return 'A slime bot'

  return VISITORS[who].name.replace(/^the /, 'The ')
}

/** How the door decided, line by line: the player's rules, or a public route that lets everyone in. */
function doorLines(who: Caller, method: 'GET' | 'POST', path: string): readonly EvalLine[] {
  const saved = rules()

  if (!saved)
    return [
      {
        text: 'allow_public_unauthenticated_access: true',
        ok: true,
        actual: 'open to all, no session needed',
      },
    ]

  return decide({ policy: saved }, identityOf(who), { method, path }, who === 'you' ? 'your' : 'their').lines
}

/** The house's route as Pomerium has it, for the sign outside and the editor. */
export function houseRouteYaml(house: HouseState | null, saved: readonly HouseRule[] | null) {
  const door = saved
    ? ['  policy:', ...policyYaml(saved, 4)]
    : ['  allow_public_unauthenticated_access: true']

  return [
    `- from: https://${location.host}`,
    `  prefix: ${house?.path ?? '/zones/home/<your house>/'}`,
    '  to: http://quest.quest.svc.cluster.local:3000',
    '  pass_identity_headers: true',
    ...door,
  ].join('\n')
}

/** The sage hands over the deed once the player has signed in. */
export function giveDeed() {
  quest.say(
    [
      {
        who: 'Sage',
        text: "One more thing. There's an empty house in the Slime Fields, just below the pond. It's yours now: here's the deed.",
      },
      {
        who: 'Sage',
        text: 'Its door is a Pomerium route like every gate in the kingdom, but you write its rules. The builders left it wide open, with allow_public_unauthenticated_access: everyone gets in, even with no session at all. I hear the slimes have noticed.',
        links: [link('publicRoute')],
      },
    ],
    () => {
      quest.sendHouse({ type: 'DEED_GIVEN' })
      sfx('itemGet')
      quest.toast('You got the deed to your house', 'info')
    },
  )
}

/** Walking in puts the house up as a route, with the rules the player last saved. */
export async function enterHouse(): Promise<HouseState | null> {
  const built = await openHouse(rules())

  if (!built.ok) {
    quest.toast(`The builders couldn't put your house up: ${built.message}`, 'deny')

    return null
  }

  quest.setHouse(built.value)

  if (built.value.version === 'public') learn('publicRoute')

  if (!quest.get().letterRead && currentLetter()) quest.toast('There’s a letter on your doormat', 'info')

  return built.value
}

export function readLetter() {
  const letter = currentLetter()

  if (!letter) {
    quest.say([
      { who: 'Doormat', text: 'No new letters. Your door rules are yours to keep changing at the desk.' },
    ])

    return
  }

  quest.say([{ who: `Letter · ${letter.title}`, text: letter.text }], () =>
    quest.sendHouse({ type: 'LETTER_READ' }),
  )
}

export function readHouseSign() {
  const { house, progress } = quest.get()

  quest.say([
    {
      who: 'Sign · Your house',
      text: progress.houseRules
        ? 'Your door is a route, and its policy is the rules you wrote at the desk.'
        : 'Your door is a route left wide open with allow_public_unauthenticated_access, so Pomerium lets in every request, signed in or not. In a policy, the same thing is written accept: true. The rules you write at the desk replace it. A route with no rules at all would let no one in.',
      code: houseRouteYaml(house, progress.houseRules),
      links: [link('publicRoute'), link('writePolicy')],
    },
  ])
}

/** The table, by how much of the loaf is left. */
export function readTable(left: number, whole: number) {
  let text = 'What’s left of a loaf. Someone has clearly been at it.'

  if (left === whole) text = 'A fresh loaf of bread.'

  if (left === 0) text = 'Crumbs. The traveler was thorough.'

  quest.say([{ who: 'Table', text }])
}

/** Puts the player's door rules up as the house's policy. */
export async function saveDoorRules(next: readonly HouseRule[]) {
  quest.toast('The builders are at work on your door…', 'info')
  const built = await saveHouse(next)

  quest.log({
    decision: built.ok ? 'ALLOW' : 'DENY',
    method: 'POST',
    path: '/zones/builder/save',
    who: quest.get().identity.email,
  })

  if (!built.ok) return built

  quest.progress({ houseRules: next })
  quest.setHouse(built.value)
  sfx('gateClose')
  learn('writePolicy')

  if (built.value.live) quest.toast(TOOK_HOLD, 'allow')
  else {
    quest.toast('Your rules are on the route. Waiting for Pomerium to take them up…', 'info')
    void watchForPomerium(built.value.version)
  }

  return built
}

const TOOK_HOLD = 'Pomerium is enforcing your new door rules. Ring the bell to see who gets in.'

/** How often, and for how long, the game asks whether Pomerium has taken up a save yet. */
const STATUS_EVERY_MS = 1_000
const STATUS_FOR_MS = 3 * 60_000

/** Asks the builders until Pomerium enforces this version of the rules, then says so. */
async function watchForPomerium(version: string) {
  for (let waited = 0; waited < STATUS_FOR_MS; waited += STATUS_EVERY_MS) {
    await new Promise((resolve) => setTimeout(resolve, STATUS_EVERY_MS))
    const status = await houseStatus()

    // A newer save has its own watch.
    if (status.ok && status.value.version !== version) return

    if (status.ok && status.value.live) {
      quest.setHouse(status.value)
      quest.toast(TOOK_HOLD, 'allow')

      return
    }
  }

  quest.toast(
    "Pomerium hasn't confirmed your new rules yet. Ring the bell: each knock waits for them.",
    'info',
  )
}

/** One knock, through Pomerium: the server knocks as a townsperson or slime; the player knocks as themselves. */
async function knock(who: Caller, method: 'GET' | 'POST', house: HouseState): Promise<VisitResult> {
  const path = `${house.path}knock`
  let status = 0

  if (who === 'you') status = await knockYourself(house.path, method)
  else {
    const answer = await knockAs(who, method)
    status = answer.ok ? answer.value.status : 0
  }

  const id = identityOf(who)

  quest.log({
    decision: status === 200 ? 'ALLOW' : 'DENY',
    method,
    path,
    who: id.authenticated ? id.email : 'anonymous (a slime bot)',
  })

  return { who, method, status, lines: doorLines(who, method, path) }
}

/** A slime on the doorstep tries the door; true when Pomerium lets it in. */
export async function slimeKnocks(): Promise<boolean> {
  const { house } = quest.get()

  if (!house) return false

  return (await knock('slime', 'GET', house)).status === 200
}

/** Whether the traveler is welcome right now, by knocking as them. */
export async function travelerWelcome(): Promise<boolean> {
  const { house } = quest.get()

  if (!house) return false

  return (await knock('traveler', 'GET', house)).status === 200
}

const EVERYONE: readonly Knocker[] = ['baker', 'traveler', 'captain', 'librarian', 'slime']

/**
 * Rings the bell: everyone the letter names knocks, for real. With no letter, all the townsfolk and a
 * slime come by. The results screen shows Pomerium's answers next to what the letter asked for.
 */
export async function ringBell() {
  const house = quest.get().house ?? (await enterHouse())

  if (!house) return
  sfx('bell')
  quest.toast('You ring the bell. Footsteps outside…', 'info')
  const letter = currentLetter()

  const calls = letter
    ? letter.expect
    : [
        { who: 'you' as const, method: 'GET' as const },
        ...EVERYONE.map((who) => ({ who, method: 'GET' as const })),
      ]

  const results = await Promise.all(
    calls.map(async (call) => {
      const result = await knock(call.who, call.method, house)

      return 'allowed' in call ? { ...result, wanted: call.allowed } : result
    }),
  )

  const visitsRight = results.every(
    (result) => result.wanted === undefined || (result.status === 200) === result.wanted,
  )

  const usesDeny = rules()?.some((rule) => rule.action === 'deny') ?? false
  const missingDeny = Boolean(letter?.needsDeny) && !usesDeny
  const solved = Boolean(letter) && visitsRight && !missingDeny

  const story = storyOf(letter, solved)

  if (visitsRight && missingDeny)
    quest.showVisits({ story, results, solved, note: 'Right visitors, but this letter wants a deny rule.' })
  else quest.showVisits({ story, results, solved })

  if (!solved || !letter) return
  quest.sendHouse({ type: 'LETTER_SOLVED' })
  learn(letter.lesson)
  sfx('victory')
}

/** Who came by, as the kingdom tells it. */
function storyOf(letter: Letter | null, solved: boolean) {
  if (!letter)
    return 'The townsfolk come by one by one, and a slime bounces up the path. Here is how your door answered.'

  if (solved) return letter.solved

  return `Not quite: "${letter.title}". Compare who got in with what the letter asked, change your rules at the desk and ring again.`
}

export const callerName = nameOf
