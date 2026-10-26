// The player's house: the deed, the letters, the desk and the visitors (docs/prd/your-house.md).
// Every knock is a real request through Pomerium; the server writes the house's route from the player's
// door rules, and the explanations below come from the same rules.
import { houseStatus, knockAs, knockYourself, openHouse, saveHouse } from './access.ts'
import { LESSONS, LETTERS, link, type Caller, type LessonId, type Letter } from './content.ts'
import { VISITOR_IDS, VISITORS, type HouseRule, type HouseState, type VisitorId } from './house.ts'
import { houseStage, type LetterStage } from './house-machine.ts'
import { decide, policyYaml, type Identity } from './ppl.ts'
import { sfx } from './sound.ts'
import { ANONYMOUS, quest } from './store.ts'

const learn = (lesson: LessonId) => quest.learn(lesson, LESSONS[lesson].title)
const rules = () => quest.get().progress.houseRules

/** The stage's letter, if there's one on the desk. */
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

  if (!quest.get().letterRead && currentLetter()) quest.toast('There’s a letter on your desk', 'info')

  return built.value
}

/** Reads the letter waiting on the desk, then does whatever comes next (opening the door rules). */
export function readLetter(then: () => void) {
  const letter = currentLetter()

  if (!letter) {
    then()

    return
  }

  quest.say([{ who: `Letter · ${letter.title}`, text: letter.text }], () => {
    quest.sendHouse({ type: 'LETTER_READ' })
    then()
  })
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

  if (built.value.live) tookHold()
  else {
    quest.toast('Your rules are on the route. Waiting for Pomerium to take them up…', 'info')
    void watchForPomerium(built.value.version)
  }

  return built
}

/** Pomerium enforces the new rules: the letter's visitors come by to try them. */
function tookHold() {
  quest.toast('Pomerium is enforcing your new door rules.', 'allow')
  void checkLetter()
}

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
      tookHold()

      return
    }
  }

  // Each knock waits for the rules, so the letter's visitors can still try them.
  quest.toast("Pomerium hasn't confirmed your new rules yet.", 'info')
  void checkLetter()
}

/** One knock on the player's house, as Pomerium answered it: 200 let in, 401 no session, 403 refused. */
interface Visit {
  readonly who: Caller
  readonly method: 'GET' | 'POST'
  readonly status: number
}

/** One knock, through Pomerium: the server knocks as a townsperson or slime; the player knocks as themselves. */
async function knock(who: Caller, method: 'GET' | 'POST', house: HouseState): Promise<Visit> {
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

  return { who, method, status }
}

/** A slime on the doorstep tries the door; true when Pomerium lets it in. */
export async function slimeKnocks(): Promise<boolean> {
  const { house } = quest.get()

  if (!house) return false

  return (await knock('slime', 'GET', house)).status === 200
}

/** Whether a townsperson is welcome right now, by knocking as them. */
export async function visitorWelcome(who: VisitorId): Promise<boolean> {
  const { house } = quest.get()

  if (!house) return false

  return (await knock(who, 'GET', house)).status === 200
}

export const travelerWelcome = () => visitorWelcome('traveler')

/**
 * Whether Pomerium turns the player away from their own door: a real knock with their own session. Only
 * a 403 counts, so a lost session or a builders' hiccup never locks them out.
 */
export async function youRefused(): Promise<boolean> {
  let { house } = quest.get()

  if (!rules()) return false

  if (!house) {
    const built = await openHouse(rules())

    if (!built.ok) return false
    quest.setHouse(built.value)
    house = built.value
  }

  return (await knock('you', 'GET', house)).status === 403
}

/** Who the door rules let in, of the folk the player knows, as the explainer reads them. */
function welcomeNow() {
  const policy = rules() ?? []

  const lets = (who: VisitorId | 'slime') =>
    decide({ policy }, identityOf(who), { method: 'GET', path: '/' }, 'their').allow

  const names = VISITOR_IDS.filter(lets).map((id) => `${VISITORS[id].name} (${VISITORS[id].email})`)

  if (lets('slime')) names.push('slimes with no session at all')

  if (names.length === 0) return 'Right now they let in no one at all.'

  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join('')

  return `Right now they let in ${list}, but not you.`
}

/**
 * The player's own door turned them away: whoever tells them (a guard showing them out, or the door
 * itself) says who it lets in now, then the desk opens so they can fix it from the doorstep.
 */
export function lockedOut(shownOut: boolean) {
  const who = shownOut ? 'Guard' : 'Your door'

  const first = shownOut
    ? "Sorry, I know it's your house. But your new door rules don't let you in, so out you go."
    : "Your door won't open for you. Your door rules don't let you in."

  quest.say(
    [
      { who, text: `${first} ${welcomeNow()}` },
      {
        who,
        text: "Pomerium doesn't know whose house this is. It checks each request against the route's rules, and no allow rule matches you. Luckily the builders' office is a route of its own, so you can fix your door rules from right here.",
        links: [link('writePolicy')],
      },
    ],
    () => quest.openHouseEditor(),
  )
}

/** What one visit should have done but didn't, as the house tells it. */
function missed(result: Visit & { readonly wanted: boolean }) {
  const visit = result.method === 'POST' ? ' knocking (a POST)' : ''
  const kept = result.who === 'you' ? 'were kept out' : 'was kept out'
  const got = result.status === 200 ? 'got in' : kept

  return `${nameOf(result.who)}${visit} ${got}, but the letter wants them ${result.wanted ? 'let in' : 'kept out'}.`
}

/**
 * Everyone the letter names knocks, for real, once Pomerium enforces new rules. The letter is solved
 * when Pomerium's answers match what it asks for.
 */
async function checkLetter() {
  const { house } = quest.get()
  const letter = currentLetter()

  if (!house || !letter) return

  const results = await Promise.all(
    letter.expect.map(async (call) => ({
      ...(await knock(call.who, call.method, house)),
      wanted: call.allowed,
    })),
  )

  // The player may have saved again while the visitors were on their way: that save checks for itself.
  if (currentLetter() !== letter || quest.get().house?.version !== house.version) return

  const wrong = results.filter((result) => (result.status === 200) !== result.wanted)

  // The player's own door turned them away: the house tells them that story instead (lockedOut).
  if (results.some((result) => result.who === 'you' && result.status === 403) && quest.get().house?.live)
    return
  const usesDeny = rules()?.some((rule) => rule.action === 'deny') ?? false
  const who = `Letter · ${letter.title}`

  if (wrong.length > 0) {
    quest.say([{ who, text: `Not quite. ${wrong.map(missed).join(' ')} Change your rules at the desk.` }])

    return
  }

  if (letter.needsDeny && !usesDeny) {
    quest.say([{ who, text: 'The right visitors got in, but this letter wants a deny rule.' }])

    return
  }

  sfx('victory')
  quest.say([{ who, text: letter.solved }], () => {
    quest.sendHouse({ type: 'LETTER_SOLVED' })
    learn(letter.lesson)
  })
}
