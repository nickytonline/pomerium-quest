// Chapter two's story: the Falconer, the owl's perches and the vault. The owl is an MCP client, and every
// errand is a real MCP request through Pomerium (see perch.ts), so what the owl may do is Pomerium's call.
import { sendOwl } from './access.ts'
import { STALE_DOCS, link, type Page } from './content.ts'
import { GROUPS } from './groups.ts'
import { owlAtLeast, owlStage, type OwlStage } from './owl-machine.ts'
import { MCP_PATH, OWL_TOOLS, roostOrigin, type OwlTool, type Roost } from './owl.ts'
import type { OwlCall, OwlOutcome } from './perch.ts'
import { decide, type Identity } from './ppl.ts'
import { sfx } from './sound.ts'
import { quest, type DenyView } from './store.ts'
import { groupsBefore, learn, oracleArrives, who } from './story.ts'
import { zoneById } from './zones.ts'

const identity = () => quest.get().identity

const ROOST_NAME: Record<Roost, string> = { aviary: 'Aviary', rookery: 'Rookery' }

const MEET: readonly Page[] = [
  {
    who: 'Falconer',
    text: 'So you\'re the one the keep let through. I\'m the Falconer. Your friend Mochi came this way before you, and is waiting in the Throne Room at the far end of these grounds. "Send them after me," Mochi said.',
  },
  {
    who: 'Falconer',
    text: "You won't get there on four paws alone. There are things beyond these walls a dog can't do: climb the bell tower, or carry a letter to the Oracle. An owl can. Mochi had one too.",
  },
  {
    who: 'Falconer',
    text: 'Take this one. It will run errands for you. In Pomerium terms the owl is an MCP client: a program, often an AI agent, that calls tools on your behalf. The Aviary is an MCP server: it offers the tools.',
    links: [link('mcpServer')],
  },
  {
    who: 'Falconer',
    text: "The owl has no papers of its own. It flies on your behalf, so it carries yours. Pomerium checks every tool it calls against the route's policy, by your papers, the same way a guard checks you at a gate.",
    links: [link('mcpIdentity')],
  },
  {
    who: 'Falconer',
    text: 'Send it from the perch beside me. Start by asking it who it flies for.',
  },
]

/** What the Falconer says once the player has the owl, by how far its errands have got. */
const ADVICE: Record<Exclude<OwlStage, 'afar' | 'arrived' | 'vouched' | 'entrusted'>, string> = {
  fledged: `Try every errand at the perch. One of them the Aviary will refuse, and that's worth seeing. When you're ready, have the owl deliver my letter: it asks the Oracle to add you to the ${GROUPS.falconers} group, and the Mews east of here opens only to falconers.`,
  falconer:
    "You're a falconer now. The Mews will open for you, east along the road. Inside is the Rookery's perch: the same owl and the same tools, but a different route with different orders. The errand the Aviary refused is allowed there.",
  keyholder:
    'Your papers say keyholder. The Royal Vault is at the end of the road, east of the Mews. Go and see what the kingdom keeps there. Then take the lane south between the two, to the Throne Room.',
  crowned:
    "You hold the Royal Seal. One gate is left: the Throne Room, south down the lane between the Mews and the vault. Its guard asks for everything you've earned, in both chapters. Mochi is inside.",
  triumphant:
    "Same owl, same tools, all along. What changed was which route it flew to, and what your papers said when it got there. That's all Pomerium ever checks.",
}

/** The Falconer: gives the player the owl, then points them at the next errand. */
export function falconer() {
  const stage = owlStage()

  if (stage === 'afar' || stage === 'arrived') {
    quest.say(MEET, () => {
      quest.sendOwl({ type: 'OWL_GIVEN' })
      sfx('itemGet')
      quest.toast('The owl hops onto your shoulder', 'info')
    })

    return
  }

  // A stale session: the Oracle has the group, and comes to sign the player in again.
  if (stage === 'vouched' || stage === 'entrusted') {
    const group = stage === 'vouched' ? GROUPS.falconers : GROUPS.keyholders

    quest.say(
      [
        {
          who: 'Falconer',
          text: `The Oracle has the owl's letter, but your session still holds the claims from when you signed in. Ah, here he comes.`,
        },
      ],
      () => oracleArrives(`The owl's letter arrived. I've added ${group} to your groups.`),
    )

    return
  }

  quest.say([{ who: 'Falconer', text: ADVICE[stage] }])
}

/** The player walks up to a perch: its panel opens and the owl asks the roost what tools it offers. */
export function visitPerch(roost: Roost) {
  if (!owlAtLeast('fledged')) {
    quest.say([
      {
        who: 'Perch',
        text: 'An owl watches you from its perch, head tilted. It belongs to the Falconer. Talk to them first.',
      },
    ])

    return
  }

  sfx('hoot')
  quest.openPerch(roost)
  void flyOwl(roost, { method: 'tools/list' })
}

const toolOf = (call: OwlCall) => (call.method === 'tools/call' ? call.tool : undefined)

/** A refused flight, told twice like any refusal: the keeper's words, then how Pomerium decided. */
function refusedView(roost: Roost, call: OwlCall, id: Identity, requestId: string | null): DenyView {
  const zone = zoneById(roost)
  const tool = toolOf(call)
  const request = { method: 'POST', path: MCP_PATH, tool } as const
  const decision = decide(zone, id, request)
  // As at a gate: the game's view of the session already qualifies, so Pomerium decided with the copy of
  // the user's claims it cached before the last sign-in.
  const stale = decision.allow
  const before = groupsBefore()
  const cached = stale && before ? { ...id, groups: before } : null

  const fromPomerium = requestId ? { requestId } : {}
  const fromCache = stale ? { cachedClaims: { session: id.groups, cached: before } } : {}

  const told = (): Pick<DenyView, 'story' | 'hint' | 'links'> => {
    if (stale) {
      return {
        story: {
          title: 'The ink is still wet',
          text: `The ${ROOST_NAME[roost]}'s keeper squints at the papers tied to the owl's leg. "Fresh from the Oracle, are they? Let the ink dry a minute, then send the owl again."`,
        },
        hint: 'Try again in a moment. Once the cached copy expires, Pomerium reads your updated user record and lets the owl through.',
        links: STALE_DOCS,
      }
    }

    if (roost === 'aviary' && tool === OWL_TOOLS.openVault) {
      return {
        story: {
          title: 'Not that errand',
          text: 'The owl is turned back at the Aviary\'s window. "Any errand but that one," says the keeper. "My orders name the vault, and they say no, whoever the owl flies for."',
        },
        hint: `The allow rule matched: you are everything the keep asks for. But the deny rule names this tool, mcp_tool: ${tool}, and a deny always beats an allow. Pomerium read the tool's name from the tools/call request itself. It answers a refused MCP request with a JSON-RPC error rather than a 403 page, so an MCP client can read the refusal: that is the 200 above.`,
        links: [link('mcpTool'), link('denyWins')],
      }
    }

    if (roost === 'rookery') {
      return {
        story: {
          title: "Falconers' owls only",
          text: 'The Rookery\'s keeper holds up a hand. "This window is for falconers\' owls, and nothing in these papers says falconer."',
        },
        hint: `The Rookery's only rule needs claim/groups: ${GROUPS.falconers}. The owl flies with your session, and its groups claim doesn't include ${GROUPS.falconers}, so Pomerium refused the whole route, even a request that only lists the tools.`,
        links: [link('mcpServer'), link('authz')],
      }
    }

    return {
      story: {
        title: "The owl isn't let in",
        text: `The ${ROOST_NAME[roost]}'s keeper waves the owl off. "My orders don't cover whoever sent you."`,
      },
      hint: 'No allow rule matched this request, so Pomerium refused it. The owl flies with your session: what you may not do, it may not do.',
      links: [link('mcpServer'), link('authz')],
    }
  }

  return {
    status: 200,
    title: tool ? 'Tool call refused' : 'MCP request refused',
    requestLine: `POST ${roostOrigin(location.origin, roost)}${MCP_PATH} · ${call.method}${tool ? ` ${tool}` : ''}`,
    who: who(id),
    lines: cached ? decide(zone, cached, request).lines : decision.lines,
    ...told(),
    ...fromPomerium,
    ...fromCache,
  }
}

/** The owl's letter reached the Oracle: the perch closes, and he comes to sign the player in again. */
function letterDelivered(pages: readonly Page[], group: string) {
  quest.closePerch()
  quest.say(pages, () => {
    learn('claims')
    oracleArrives(`The owl's letter arrived. I've added ${group} to your groups.`)
  })
}

/** What each errand does in the kingdom once Pomerium has allowed it and the tool has run. */
const DONE: Record<OwlTool, (roost: Roost) => void> = {
  [OWL_TOOLS.whoami]: () => learn('mcpIdentity'),
  [OWL_TOOLS.ringBell]: () => {
    sfx('bell')
    quest.toast('High above the Aviary, the bell rings twice', 'info')
  },
  [OWL_TOOLS.deliverLetter]: () => {
    if (owlStage() !== 'fledged') return
    quest.sendOwl({ type: 'LETTER_DELIVERED' })
    letterDelivered(
      [
        {
          who: 'Falconer',
          text: `The owl is back, and the letter is gone from its leg. The Oracle has it: from now on you are in the ${GROUPS.falconers} group.`,
        },
        {
          who: 'Falconer',
          text: 'Notice who wrote to the Oracle. Not you: a tool, called by your owl, with your identity. Pomerium allowed the call, so the Aviary acted for you. That is why it matters which tools an agent may call.',
          links: [link('mcpIdentity')],
        },
        {
          who: 'Falconer',
          text: 'And you know the catch by now: your session still holds the claims from when you signed in. Here comes the Oracle.',
        },
      ],
      GROUPS.falconers,
    )
  },
  [OWL_TOOLS.openVault]: () => {
    if (owlStage() !== 'falconer') return
    quest.sendOwl({ type: 'VAULT_OPENED' })
    letterDelivered(
      [
        {
          who: 'Rookery',
          text: `The owl returns with a wax seal in its beak. The same tool the Aviary refused ran here: the Oracle now lists you in the ${GROUPS.keyholders} group.`,
        },
        {
          who: 'Rookery',
          text: 'The tool never changed, and neither did the server behind it. The route did. The Aviary and the Rookery are two routes to one MCP server, and each route has its own policy.',
          links: [link('onroute'), link('mcpTool')],
        },
      ],
      GROUPS.keyholders,
    )
  },
}

const LOG_DECISION: Record<OwlOutcome['kind'], 'ALLOW' | 'DENY' | 'SIGN IN'> = {
  tools: 'ALLOW',
  result: 'ALLOW',
  refused: 'DENY',
  signin: 'SIGN IN',
  error: 'DENY',
}

/**
 * Sends the owl on one errand and tells the story of how it went. The request and Pomerium's answer land
 * in the perch's panel and the access log either way.
 */
export async function flyOwl(roost: Roost, call: OwlCall) {
  const id = identity()
  const tool = toolOf(call)
  quest.perchBusy(true)
  const sent = await sendOwl(roost, call)

  if (!sent.ok) {
    quest.perchBusy(false)
    quest.toast(`The owl never left the perch: ${sent.message}`, 'deny')

    return
  }

  const flight = sent.value
  const { outcome } = flight

  quest.perchFlew(flight)

  quest.log({
    decision: LOG_DECISION[outcome.kind],
    method: 'MCP',
    path: `${roost} · ${call.method}${tool ? ` ${tool}` : ''}`,
    who: who(id),
  })

  switch (outcome.kind) {
    case 'tools':
      learn('mcpServer')

      return
    case 'result':
      if (outcome.failed) quest.toast('The owl came back with nothing. See what the tool said.', 'deny')
      else if (tool) DONE[tool](roost)

      return
    case 'refused':
      sfx('denied')
      quest.showDeny(refusedView(roost, call, id, outcome.requestId), () => {
        // The lesson is the deny rule that names one tool, not a route that refuses everything.
        if (roost === 'aviary' && tool === OWL_TOOLS.openVault) learn('mcpTool')
      })

      return
    case 'signin':
      quest.toast('The owl has no papers to fly with. Sign in with the Oracle again.', 'deny')

      return
    case 'error':
      quest.toast(`The owl lost its way: ${outcome.message}`, 'deny')
  }
}

/** The chest in the Royal Vault. Only a keyholder gets this far. */
export function openVaultChest(): boolean {
  if (owlStage() !== 'keyholder') return false
  quest.sendOwl({ type: 'TREASURE_TAKEN' })
  sfx('itemGet')
  quest.say([
    {
      who: 'Royal Vault',
      text: "Inside the chest lies the Royal Seal: the kingdom's own signing key. The owl lands on the rim and hoots, rather pleased with itself.",
    },
    {
      who: 'Royal Vault',
      text: 'You never touched the lock. An owl asked for the key on your behalf, and Pomerium checked every errand it ran: who it flew for, which route it flew to, and which tool it called.',
      links: [link('mcpTool')],
    },
    {
      who: 'Royal Vault',
      text: 'One gate is left. Carry the seal to the Throne Room, where Mochi is waiting: the lane runs south between the Mews and the vault.',
    },
  ])

  return true
}

/** Mochi, the friend who went ahead: finding them in the Throne Room ends the quest. */
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

  quest.say(
    [
      {
        who: 'Mochi',
        text: "You made it! I knew you would. I've been keeping a spot on the carpet warm for you.",
      },
      {
        who: 'Mochi',
        text: 'The guard read my papers at that gate too, top to bottom, same as yours. Nobody waved me through for having been here before, and nobody let you in for knowing me. One route, one policy, checked for each of us, every time.',
        links: [link('every'), link('allOf')],
      },
      {
        who: 'Mochi',
        text: 'Come on. The whole kingdom wants to celebrate.',
      },
    ],
    () => {
      quest.sendOwl({ type: 'REUNITED' })
      sfx('victory')
      quest.openChapterTwoEnd()
    },
  )
}

/** The throne, behind the quest's last gate. Nobody sits on it. */
export function readThrone() {
  quest.say([
    {
      who: 'Throne',
      text: "The throne is empty, and has been for years. Nobody needs to sit here and decide who comes and goes. Every gate in the kingdom asks Pomerium, every time, and Pomerium reads the gate's orders.",
      links: [link('every')],
    },
  ])
}
