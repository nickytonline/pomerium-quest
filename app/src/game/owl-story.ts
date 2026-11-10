// Chapter two's story: the Falconer, the owl to catch, the perches, and Mochi and their owl. The owl is
// an MCP client, and sending it from a perch is a real MCP tool call through Pomerium (see perch.ts), so
// whether the errand runs is Pomerium's call.
import { sendOwl } from './access.ts'
import { SIGN_DOCS, SIGN_TEXT, STALE_DOCS, link, type Page } from './content.ts'
import { GROUPS } from './groups.ts'
import { mochisOwlFound, owlAtLeast, owlStage, type OwlStage } from './owl-machine.ts'
import { MCP_PATH, OWL_ERRANDS, OWL_TOOLS, aviaryOrigin, isForbidden, type OwlTool } from './owl.ts'
import { FLIGHT_MS, type OwlFlight, type OwlOutcome } from './perch.ts'
import { decide, type Identity } from './ppl.ts'
import { sfx } from './sound.ts'
import { quest, type DenyView } from './store.ts'
import { attempt, groupsBefore, learn, oracleArrives, who, zoneRouteYaml } from './story.ts'
import { zoneById } from './zones.ts'

const identity = () => quest.get().identity
const aviary = () => zoneById('aviary')

const MEET: readonly Page[] = [
  {
    who: 'Falconer',
    text: "So you're the one the keep let through. I'm the Falconer. Your friend Mochi came this way before you, and is waiting in the Eyrie, behind the gate at the far end of these grounds.",
  },
  {
    who: 'Falconer',
    text: 'Mochi lost their owl on the way. It is somewhere out in the open ground. If you find it, Mochi will want it back.',
  },
  {
    who: 'Falconer',
    text: "You won't get to the Eyrie on four paws alone. There are things here a dog can't do: climb the bell tower, or carry a letter to the Oracle. An owl can.",
  },
  {
    who: 'Falconer',
    text: 'In Pomerium terms an owl is an MCP client: a program, often an AI agent, that calls tools on your behalf. The Aviary is an MCP server: it offers the tools. Each perch out in the grounds is one of its tools.',
    links: [link('mcpServer')],
  },
  {
    who: 'Falconer',
    text: "I don't hand owls out. To become a falconer you must catch your own. Yours is sitting just east of here. It hops away when you get close, but it tires after a few hops. Once it stays put, walk up and pick it up.",
  },
]

const CAUGHT: readonly Page[] = [
  {
    who: 'Owl',
    text: 'The owl is too tired to hop again. It blinks at you, then steps onto your shoulder. You caught your owl!',
  },
  {
    who: 'Owl',
    text: 'It has no papers of its own. It flies on your behalf, so it carries yours: Pomerium checks every errand it runs by your papers, the same way a guard checks you at a gate.',
    links: [link('mcpIdentity')],
  },
  {
    who: 'Owl',
    text: 'Each perch in these grounds is one errand. Walk up to any of them and send the owl.',
  },
]

/** Mochi's owl, which the Falconer mentions for as long as it's lost. */
const mochisOwlHint = () =>
  mochisOwlFound()
    ? ''
    : " And keep an eye out for Mochi's owl. Your owl can scout for it, from the perch to the south."

/** What the Falconer says between the story's turns, by how far the owl's errands have got. */
const ADVICE: Record<
  Exclude<OwlStage, 'afar' | 'arrived' | 'turned' | 'vouched' | 'entrusted'>,
  () => string
> = {
  seeking: () =>
    'Your owl is still out there, east of here. It hops off when you come near, and it tires after a few hops. Once it stays put, walk up and pick it up.',
  fledged: () =>
    "You caught it! That's the hard part. Now send it to a perch, any perch, and see what the Aviary makes of it. Then come and tell me.",
  falconer: () =>
    `Your papers say falconer, so the Aviary lets your owl in. Try every perch. Two of them never open, for any owl, and that's worth seeing. One matters most: the owl carries my letter to the Oracle, who makes you a keyholder. The Eyrie's gate asks for that.${mochisOwlHint()}`,
  keyholder: () =>
    `Your papers say keyholder. The Eyrie's gate is at the south end of the road. Its guard asks for everything you've earned, in both chapters. Mochi is inside.${mochisOwlFound() ? '' : " Mochi will ask after their owl, and it's still lost somewhere in these grounds."}`,
  triumphant: () =>
    "Same owl, same perches, all along. What changed was what your papers said when the owl got there. That's all Pomerium ever checks.",
}

/** The Falconer has seen the owl turned back, and writes to the Oracle: the player is a falconer. */
async function vouch() {
  const outcome = await attempt(zoneById('keep'), 'POST', 'falconer')

  if (outcome.kind !== 'allow') return
  quest.sendOwl({ type: 'FALCONER_VOUCHED' })

  quest.say(
    [
      {
        who: 'Falconer',
        text: "Turned back, was it? Of course it was. The Aviary only lets in a falconer's owl, and nothing in your papers says falconer.",
      },
      {
        who: 'Falconer',
        text: `But you caught your owl, and that is all it takes. You're a falconer now. I've written to the Oracle: from now on you are in the ${GROUPS.falconers} group.`,
      },
      {
        who: 'Falconer',
        text: "Notice what didn't change: the owl, the perches and the Aviary's orders are the same as a minute ago. Your papers changed. The owl carries yours, so what you may do, it may do.",
        links: [link('mcpIdentity')],
      },
      {
        who: 'Falconer',
        text: 'One catch, and you know it by now: your session still holds the claims from when you signed in. Ah, here comes the Oracle.',
      },
    ],
    () => {
      learn('claims')
      oracleArrives(`The Falconer's letter arrived. I've added ${GROUPS.falconers} to your groups.`)
    },
  )
}

/** The Falconer: sends the player after their owl, vouches for them, then points them at the next errand. */
export function falconer() {
  const stage = owlStage()

  if (stage === 'afar' || stage === 'arrived') {
    quest.say(MEET, () => {
      quest.sendOwl({ type: 'OWL_SOUGHT' })
      quest.toast('Catch your owl: it is just east of the Falconer', 'info')
    })

    return
  }

  if (stage === 'turned') {
    void vouch()

    return
  }

  // A stale session: the Oracle has the group, and comes to sign the player in again.
  if (stage === 'vouched' || stage === 'entrusted') {
    const group = stage === 'vouched' ? GROUPS.falconers : GROUPS.keyholders

    quest.say(
      [
        {
          who: 'Falconer',
          text: 'The Oracle has the letter, but your session still holds the claims from when you signed in. Ah, here he comes.',
        },
      ],
      () => oracleArrives(`The letter arrived. I've added ${group} to your groups.`),
    )

    return
  }

  quest.say([{ who: 'Falconer', text: ADVICE[stage]() }])
}

/**
 * The player reaches for the owl, out in the open. Before the Falconer has sent them after it, it only
 * watches; once it's too tired to hop away it's theirs. Returns whether they caught it.
 */
export function catchOwl() {
  if (owlStage() !== 'seeking') {
    quest.say([
      {
        who: 'Owl',
        text: 'An owl watches you from the grass, head tilted. It is not yours yet. The Falconer can tell you about it.',
      },
    ])

    return false
  }

  quest.sendOwl({ type: 'OWL_CAUGHT' })
  sfx('itemGet')
  quest.say(CAUGHT)

  return true
}

/**
 * The player walks into a perch, where the owl has already hopped: the perch asks whether to send the owl
 * on its errand. Nothing is sent until the player says so.
 */
export function visitPerch(tool: OwlTool) {
  if (!owlAtLeast('fledged')) {
    quest.say([
      {
        who: `Perch · ${OWL_ERRANDS[tool].title}`,
        text: `An empty perch. Its errand is ${tool}, but you have no owl to send. The Falconer can tell you how to get one.`,
      },
    ])

    return
  }

  const { title, description } = OWL_ERRANDS[tool]

  quest.openPerch(tool)
  quest.say([
    {
      who: `Perch · ${title}`,
      text: `Your owl looks back at you from the perch. This errand is ${tool}. ${description} Send the owl?`,
      choices: [
        { label: 'Send the owl', pick: () => void flyOwl(tool) },
        { label: 'Not now', pick: leavePerch },
      ],
    },
  ])
}

const LOG_DECISION: Record<OwlOutcome['kind'], 'ALLOW' | 'DENY' | 'SIGN IN'> = {
  tools: 'ALLOW',
  result: 'ALLOW',
  refused: 'DENY',
  signin: 'SIGN IN',
  error: 'DENY',
}

const logFlight = (flight: OwlFlight, what: string, id: Identity) =>
  quest.log({
    decision: LOG_DECISION[flight.outcome.kind],
    method: 'MCP',
    path: `aviary · ${what}`,
    who: who(id),
  })

/** What the Aviary's sign adds once the owl has asked for the list of tools, by how Pomerium answered. */
function toolsPage(flight: OwlFlight | null): Page {
  const sign = `Sign · ${aviary().name}`
  const outcome = flight?.outcome

  if (outcome?.kind === 'tools') {
    return {
      who: sign,
      text: 'Your owl asked the Aviary which tools it offers (a tools/list request), and this is the list that came back. Each one has a perch in these grounds.',
      code: outcome.tools.map((tool) => `${tool.name} · ${tool.title ?? ''}`).join('\n'),
      links: [link('mcpServer')],
    }
  }

  if (outcome?.kind === 'refused') {
    const refused = {
      who: sign,
      text: `Your owl asked the Aviary which tools it offers (a tools/list request), and Pomerium turned it back. The route asks for ${GROUPS.falconers}, and your papers don't say so. Even the list of tools is behind the policy.`,
      links: [link('mcpServer'), link('authz')],
    }

    // Pomerium's own answer, when it sent one: the JSON-RPC error an MCP client reads.
    return flight?.response ? { ...refused, code: flight.response } : refused
  }

  return {
    who: sign,
    text: "Your owl couldn't reach the Aviary to ask which tools it offers. Try the sign again.",
  }
}

/**
 * The Aviary's sign: the MCP server's route, then its list of tools. The list is a real tools/list request,
 * so only an owl Pomerium lets in comes back with it.
 */
export async function readAviarySign() {
  const zone = aviary()

  const sign: Page = {
    who: `Sign · ${zone.name}`,
    text: SIGN_TEXT.aviary ?? '',
    code: zoneRouteYaml(zone),
    links: SIGN_DOCS.aviary ?? [],
  }

  if (!owlAtLeast('fledged')) {
    quest.say(
      [
        sign,
        {
          who: sign.who,
          text: 'The Aviary gives its list of tools to any owl it lets in. You have no owl to ask for it yet.',
        },
      ],
      () => learn('mcpServer'),
    )

    return
  }

  const id = identity()
  const sent = await sendOwl({ method: 'tools/list' })

  if (sent.ok) logFlight(sent.value, 'tools/list', id)

  quest.say([sign, toolsPage(sent.ok ? sent.value : null)], () => learn('mcpServer'))
}

/** A refused flight, told twice like any refusal: the keeper's words, then how Pomerium decided. */
function refusedView(tool: OwlTool, id: Identity, flight: OwlFlight, requestId: string | null): DenyView {
  const zone = aviary()
  const request = { method: 'POST', path: MCP_PATH, tool } as const
  const decision = decide(zone, id, request)
  // As at a gate: the game's view of the session already qualifies, so Pomerium decided with the copy of
  // the user's claims it cached before the last sign-in.
  const stale = decision.allow
  const before = groupsBefore()
  const cached = stale && before ? { ...id, groups: before } : null

  const fromPomerium = requestId ? { requestId } : {}
  const fromCache = stale ? { cachedClaims: { session: id.groups, cached: before } } : {}

  // Pomerium answers a refused MCP request with a JSON-RPC error, not a 403 page.
  const readable =
    'Pomerium answers a refused MCP request with a JSON-RPC error rather than a 403 page, so an MCP client can read the refusal: that is the 200 above.'

  const told = (): Pick<DenyView, 'story' | 'hint' | 'links'> => {
    if (stale) {
      return {
        story: {
          title: 'The ink is still wet',
          text: 'The Aviary\'s keeper squints at the papers tied to the owl\'s leg. "Fresh from the Oracle, are they? Let the ink dry a minute, then send the owl again."',
        },
        hint: 'Try again in a moment. Once the cached copy expires, Pomerium reads your updated user record and lets the owl in.',
        links: STALE_DOCS,
      }
    }

    if (!id.groups.includes(GROUPS.falconers)) {
      return {
        story: {
          title: "Falconers' owls only",
          text: 'The owl is back with nothing, turned away at the Aviary. "Whose owl is this?" its keeper had called, reading the papers on its leg. "Nothing in here says falconer. I don\'t care which perch it flew from."',
        },
        hint: `The Aviary's allow rule needs claim/groups: ${GROUPS.falconers}. The owl flies on your behalf, so Pomerium checked your session, and its groups claim doesn't include ${GROUPS.falconers}. No allow rule matched, so Pomerium refused the request before the MCP server saw it, whichever tool it named. ${readable}`,
        links: [link('mcpServer'), link('authz')],
      }
    }

    if (isForbidden(tool)) {
      return {
        story: {
          title: 'This perch never opens',
          text: 'The owl comes back with nothing: the Aviary waved it off. "Not that errand," its keeper said. "My orders name every errand that starts with open, and they say no, whoever the owl flies for."',
        },
        hint: `The allow rule matched: you are a falconer. But the deny rule matches any tool whose name starts with open_, and this call names ${tool}. A deny always beats an allow. Pomerium read the tool's name from the tools/call request itself. ${readable}`,
        links: [link('mcpTool'), link('denyWins')],
      }
    }

    return {
      story: {
        title: "The owl isn't let in",
        text: 'The Aviary\'s keeper waves the owl off. "My orders don\'t cover whoever sent you."',
      },
      hint: 'No allow rule matched this request, so Pomerium refused it. The owl flies on your behalf: what you may not do, it may not do.',
      links: [link('mcpServer'), link('authz')],
    }
  }

  return {
    status: 200,
    title: 'Tool call refused',
    requestLine: `POST ${aviaryOrigin(location.origin)}${MCP_PATH} · tools/call ${tool}`,
    who: who(id),
    lines: cached ? decide(zone, cached, request).lines : decision.lines,
    rpc: { request: flight.request, response: flight.response },
    ...told(),
    ...fromPomerium,
    ...fromCache,
  }
}

/** A part of the story that waits until the player leaves the perch, so they can read the call first. */
let afterPerch: (() => void) | undefined

/** Leaves the perch, then tells whatever the last errand set in motion. */
export function leavePerch() {
  const next = afterPerch
  afterPerch = undefined
  quest.closePerch()
  next?.()
}

/** What each errand does in the kingdom once Pomerium has allowed it and the tool has run. */
const DONE: Partial<Record<OwlTool, () => void>> = {
  [OWL_TOOLS.whoami]: () => learn('mcpIdentity'),
  [OWL_TOOLS.scoutGrounds]: () =>
    quest.toast('From high up, your owl saw another owl in the trees, in the south-east corner', 'info'),
  [OWL_TOOLS.deliverLetter]: () => {
    if (owlStage() !== 'falconer') return
    quest.sendOwl({ type: 'LETTER_DELIVERED' })

    afterPerch = () =>
      quest.say(
        [
          {
            who: 'Owl',
            text: `The letter is gone from the owl's leg, and a note from the Oracle is tied there in its place. From now on you are in the ${GROUPS.keyholders} group.`,
          },
          {
            who: 'Owl',
            text: 'Notice who wrote to the Oracle. Not you: a tool, called by your owl, on your behalf. Pomerium allowed the call, so the Aviary acted for you. That is why it matters which tools an agent may call.',
            links: [link('mcpIdentity')],
          },
          {
            who: 'Owl',
            text: 'And you know the catch by now: your session still holds the claims from when you signed in. Here comes the Oracle.',
          },
        ],
        () => {
          learn('claims')
          oracleArrives(`The owl's letter arrived. I've added ${GROUPS.keyholders} to your groups.`)
        },
      )
  },
}

/**
 * What an errand sounds like from the ground, while the owl is still out of sight: the bell rings up in the
 * tower before the owl comes back to say so.
 */
const HEARD: Partial<Record<OwlTool, () => void>> = {
  [OWL_TOOLS.ringBell]: () => {
    sfx('bell')
    quest.toast('High above the grounds, the bell tolls three times', 'info')
  },
}

/** What the text box says once the owl has landed: the same words whether the errand ran or was refused. */
const BACK = 'Your owl is back on its perch, and it has a message for you.'

/**
 * The owl is back, in full view on its perch, and nothing opens over it until the player asks. `read`
 * shows what it brought: the perch's panel for an errand that ran, the refusal screen for one that didn't.
 * `notNow` is what happens when the player would rather not read it.
 */
function tellReturn(tool: OwlTool, read: () => void, notNow: () => void) {
  quest.say([
    {
      who: `Perch · ${OWL_ERRANDS[tool].title}`,
      text: BACK,
      choices: [
        { label: 'Read the message', pick: read },
        { label: 'Not now', pick: notNow },
      ],
    },
  ])
}

/** A refused errand moves the story on whether or not the player reads why: the owl was turned back. */
function turnedBack() {
  if (owlStage() !== 'fledged') return

  quest.sendOwl({ type: 'OWL_TURNED_BACK' })
  quest.toast('Tell the Falconer the owl was turned back', 'info')
}

/** What the player learns from a refused errand, once they have read why Pomerium refused it. */
function afterRefusal(tool: OwlTool, id: Identity) {
  learn('mcpServer')

  // The lesson is the deny rule that names a class of tools, not a route that refuses everything.
  if (id.groups.includes(GROUPS.falconers) && isForbidden(tool)) {
    learn('mcpTool')
    learn('denyWins')
  }

  turnedBack()
}

const flies = () => matchMedia('(prefers-reduced-motion: no-preference)').matches

/** Waits out a part of the owl's flight, for players who have motion on; with it off the owl doesn't fly. */
const watch = (ms: number) =>
  flies() ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve()

/**
 * Sends the owl on a perch's errand, which is one tool call, and tells the story of how it went. The owl
 * flies out while the request does, and comes back to the perch with the answer. Nothing covers the owl as
 * it lands: the text box says it has a message, and reading it explains the call in the kingdom's words and
 * in Pomerium's: the perch's panel for an errand that ran, the refusal screen for one Pomerium turned back.
 */
export async function flyOwl(tool: OwlTool) {
  const id = identity()
  const flew = flies()
  sfx('hoot')
  quest.perchPhase('out')
  const away = watch(FLIGHT_MS.out + FLIGHT_MS.away)
  const [sent] = await Promise.all([sendOwl({ method: 'tools/call', tool }), away])

  if (!sent.ok) {
    leavePerch()
    quest.toast(`The owl never left the perch: ${sent.message}`, 'deny')

    return
  }

  const flight = sent.value
  const { outcome } = flight

  const heard = outcome.kind === 'result' && !outcome.failed ? HEARD[tool] : undefined

  if (heard) {
    heard()
    await watch(FLIGHT_MS.heard)
  }

  // The owl calls from out of sight just before it comes back into view. With motion off it never left.
  // It keeps quiet when the errand is already being heard: the bell tolls it home.
  if (flew && !heard) {
    sfx('hoot')
    await watch(FLIGHT_MS.call)
  }

  quest.perchPhase('back')
  await watch(FLIGHT_MS.back)
  logFlight(flight, `tools/call ${tool}`, id)

  switch (outcome.kind) {
    case 'tools':
      leavePerch()

      return
    case 'result':
      quest.perchFlew(flight)

      if (outcome.failed) quest.toast('The owl came back with nothing. See what the tool said.', 'deny')
      else DONE[tool]?.()

      tellReturn(tool, () => quest.explainPerch(), leavePerch)

      return
    case 'refused':
      leavePerch()
      sfx('denied')
      tellReturn(
        tool,
        () => quest.showDeny(refusedView(tool, id, flight, outcome.requestId), () => afterRefusal(tool, id)),
        turnedBack,
      )

      return
    case 'signin':
      leavePerch()
      quest.toast('The owl has no papers to fly with. Sign in with the Oracle again.', 'deny')

      return
    case 'error':
      leavePerch()
      quest.toast(`The owl lost its way: ${outcome.message}`, 'deny')
  }
}

/** Mochi's owl, lost in the open ground: a second MCP client, which flies on Mochi's behalf. */
export function findMochisOwl() {
  if (mochisOwlFound()) return false

  quest.sendOwl({ type: 'MOCHIS_OWL_FOUND' })
  sfx('itemGet')
  quest.say([
    {
      who: "Mochi's owl",
      text: "A white owl sits low in the trees, a teal ribbon on its leg. This is Mochi's owl! It looks you over, then flutters down and settles on your back, beside your own.",
    },
    {
      who: "Mochi's owl",
      text: "Mochi's owl is an MCP client too, like yours, but it flies on Mochi's behalf, not yours. Your papers are no use to it, and it runs no errands for you. It will ride with you until you find Mochi.",
      links: [link('mcpIdentity')],
    },
  ])

  return true
}

const SAME_GATE: Page = {
  who: 'Mochi',
  text: 'The guard read my papers at that gate too, top to bottom, same as yours. Nobody waved me through for having been here before, and nobody let you in for knowing me. One route, one policy, checked for each of us, every time.',
  links: [link('every'), link('allOf')],
}

/** Mochi, the friend who went ahead: bringing them their owl ends the quest. */
export function friend() {
  if (owlStage() === 'triumphant') {
    quest.say([
      {
        who: 'Mochi',
        text: 'Still here! Go on, have a look around the kingdom. No gate in it is closed to you now, and every one of them will still check.',
      },
    ])

    return
  }

  if (!mochisOwlFound()) {
    quest.say([
      { who: 'Mochi', text: 'You made it! I knew you would.' },
      SAME_GATE,
      {
        who: 'Mochi',
        text: "Have you seen my owl? I lost it out in the grounds, somewhere past the perches. The gate let you in without it, mind: a gate checks your claims, not what you carry. But I'd dearly like it back.",
      },
    ])

    return
  }

  quest.say(
    [
      { who: 'Mochi', text: 'You made it! And is that… you found my owl!' },
      SAME_GATE,
      {
        who: 'Mochi',
        text: 'Thank you for finding it. It flies on my behalf, the way your owl flies on yours: the same Aviary and the same policy, each of us checked by our own papers.',
        links: [link('mcpIdentity')],
      },
      { who: 'Mochi', text: 'Come on. The whole kingdom wants to celebrate.' },
    ],
    () => {
      quest.sendOwl({ type: 'REUNITED' })
      sfx('victory')
      quest.openChapterTwoEnd()
    },
  )
}
