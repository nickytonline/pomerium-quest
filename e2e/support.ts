import { expect } from 'vite-plus/test'

import { GROUPS } from '../app/src/game/groups.ts'

const PORT = process.env['QUEST_PORT'] ?? '443'
const DOMAIN = process.env['QUEST_DOMAIN'] ?? 'localhost.pomerium.io'
const SUFFIX = PORT === '443' ? '' : `:${PORT}`

export const GAME = `https://game.${DOMAIN}${SUFFIX}`
export const AVIARY = `https://aviary.${DOMAIN}${SUFFIX}`
export const ORACLE = `https://oracle.${DOMAIN}${SUFFIX}`

/** The townsfolk who visit houses have fixed addresses; players may sign up with any. */
export const TOWNSFOLK = 'game.localhost.pomerium.io'
export const PLAYERS = 'players.example'

export { GROUPS }

/** Keeps runs started in the same second (or in the same run, in parallel files) from sharing accounts. */
export const RUN = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
export const PASSWORD = `e2e-${RUN}-pass`

const JSON_ACCEPT = 'application/json'

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Polls until the answer is the wanted one (or the tries run out) and returns the last answer. */
export async function until<T>(
  ask: () => Promise<T>,
  wanted: (answer: T) => boolean,
  tries: number,
  everyMs: number,
): Promise<T> {
  let answer = await ask()

  for (let attempt = 1; attempt < tries && !wanted(answer); attempt++) {
    await sleep(everyMs)
    answer = await ask()
  }

  return answer
}

/** Anything JSON can carry: what the game sends and what it answers. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/** One field of a JSON body; a dotted name reaches into nested objects. Empty when it isn't there. */
export function field(body: string, dotted: string): string {
  try {
    const parsed: Json = JSON.parse(body)

    // SAFETY: a step into something that isn't an object reads undefined (or throws), which the next lines handle.
    const value = dotted
      .split('.')
      .reduce((node, key) => (node as { [key: string]: Json })[key] as Json, parsed)

    if (value === undefined) return ''

    const text = JSON.stringify(value)

    return text.startsWith('"') ? JSON.parse(text) : text
  } catch {
    return ''
  }
}

const unescapeAttribute = (value: string) => value.replaceAll('&amp;', '&')

/** The first form on a Keycloak page: its action, with HTML entities undone. */
function formAction(page: string): string {
  const action = /action="([^"]*)"/.exec(page)?.[1]

  return action ? unescapeAttribute(action) : ''
}

interface Cookie {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly hostOnly: boolean
}

export interface Reply {
  readonly status: number
  readonly url: string
  readonly body: string
}

/** A browser with a cookie jar: follows redirects across hosts, as `curl -L -c -b` did. */
export class Player {
  readonly #cookies = new Map<string, Cookie>()

  constructor(readonly email: string) {}

  #cookieHeader(host: string) {
    return this.#cookies
      .values()
      .flatMap((cookie) =>
        host === cookie.domain || (!cookie.hostOnly && host.endsWith(`.${cookie.domain}`))
          ? [`${cookie.name}=${cookie.value}`]
          : [],
      )
      .toArray()
      .join('; ')
  }

  #store(host: string, setCookies: readonly string[]) {
    for (const line of setCookies) {
      const [pair = '', ...attributes] = line.split(';').map((part) => part.trim())
      const at = pair.indexOf('=')
      const name = pair.slice(0, at)
      const value = pair.slice(at + 1)

      const attribute = (wanted: string) =>
        attributes.find((part) => part.toLowerCase().startsWith(`${wanted}=`))?.split('=')[1]

      const domainAttribute = attribute('domain')?.replace(/^\./, '')
      const domain = domainAttribute ?? host
      const key = `${domain}|${name}`
      const maxAge = attribute('max-age')
      const expires = attribute('expires')

      const expired =
        (maxAge !== undefined && Number(maxAge) <= 0) ||
        (expires !== undefined && Date.parse(expires) <= Date.now())

      if (expired || value === '') this.#cookies.delete(key)
      else this.#cookies.set(key, { name, value, domain, hostOnly: domainAttribute === undefined })
    }
  }

  /** One request with this player's cookies, following redirects only when asked. */
  async fetch(
    method: string,
    url: string,
    headers: Headers = new Headers(),
    body?: string,
    follow = false,
  ): Promise<Reply> {
    let at = url
    let verb = method
    let payload = body
    const sent = new Headers(headers)

    for (let hop = 0; hop < 20; hop++) {
      const host = new URL(at).hostname
      const cookie = this.#cookieHeader(host)

      const init: RequestInit = {
        method: verb,
        redirect: 'manual',
        headers: sent,
        signal: AbortSignal.timeout(300_000),
      }

      if (cookie) sent.set('cookie', cookie)

      if (payload !== undefined) init.body = payload

      const response = await fetch(at, init)
      const text = await response.text()

      this.#store(host, response.headers.getSetCookie())

      const location = response.headers.get('location')

      if (!follow || !location || response.status < 300 || response.status > 399) {
        return { status: response.status, url: at, body: text }
      }

      at = new URL(location, at).toString()

      // As browsers and curl do: a redirect after a POST becomes a GET, except 307 and 308.
      if (response.status !== 307 && response.status !== 308) {
        verb = 'GET'
        payload = undefined
        sent.delete('content-type')
      }
    }

    throw new Error(`too many redirects from ${url}`)
  }

  /** A call to the game, asking for JSON, with a JSON body when there is one. */
  send(method: string, path: string, body?: Json): Promise<Reply> {
    const headers = new Headers({ accept: JSON_ACCEPT })

    if (body !== undefined) headers.set('content-type', 'application/json')

    return this.fetch(
      method,
      `${GAME}${path}`,
      headers,
      body === undefined ? undefined : JSON.stringify(body),
    )
  }

  async status(path: string, method = 'GET'): Promise<number> {
    return (await this.send(method, path)).status
  }

  async get(path: string): Promise<string> {
    return (await this.send('GET', path)).body
  }

  /** Starts a sign-in through Pomerium and returns the Oracle's sign-in page. */
  async signInPage(): Promise<string> {
    return (await this.fetch('GET', `${GAME}/zones/oracle/signin`, new Headers(), undefined, true)).body
  }

  /** Signs a new player up from the Oracle's sign-in page; returns where the browser lands. */
  async signUp(): Promise<string> {
    const link = /href="([^"]*registration[^"]*)"/.exec(await this.signInPage())?.[1]

    expect(link, "the Oracle's sign-up link").toBeTruthy()

    const form = await this.fetch(
      'GET',
      `${ORACLE}${unescapeAttribute(link ?? '')}`,
      new Headers(),
      undefined,
      true,
    )

    const action = formAction(form.body)

    expect(action, "the Oracle's sign-up form").toBeTruthy()

    const fields = new URLSearchParams({
      email: this.email,
      password: PASSWORD,
      'password-confirm': PASSWORD,
    })

    const landed = await this.fetch(
      'POST',
      action,
      new Headers({ 'content-type': 'application/x-www-form-urlencoded' }),
      fields.toString(),
      true,
    )

    return landed.url
  }

  /**
   * Waits for Pomerium to refresh the session until the Oracle's answer matches the expected claim, as the
   * game does: it never signs out (that would need Pomerium's open allow_any_sign_out_redirect_uri flag).
   * The Oracle's access tokens last 30 seconds, so Pomerium refreshes in about a minute.
   */
  async refreshed(claim: RegExp): Promise<'refreshed' | 'timeout'> {
    const seen = await until(
      () => this.get('/zones/oracle/'),
      (body) => claim.test(body),
      50,
      3000,
    )

    return claim.test(seen) ? 'refreshed' : 'timeout'
  }

  /** Waits for a gate to answer 200, since new claims take a moment to reach Pomerium. */
  gateUntilOpen(path: string): Promise<number> {
    return until(
      () => this.status(path),
      (code) => code === 200,
      45,
      2000,
    )
  }

  /** Asks the Aviary through the perch. */
  perch(body: Json): Promise<Reply> {
    return this.send('POST', '/zones/perch/aviary', body)
  }

  /** Asks the Aviary until Pomerium's answer is the kind wanted. */
  async perchUntil(body: Json, kind: string): Promise<string> {
    const answer = await until(
      async () => field((await this.perch(body)).body, 'outcome.kind'),
      (got) => got === kind,
      45,
      2000,
    )

    return answer
  }

  /** The Builders' Yard: the game server writes the house of whoever Pomerium signed in. */
  builder(action: string, body: Json): Promise<Reply> {
    return this.send('POST', `/zones/builder/${action}`, body)
  }

  async knock(knocker: string, method = 'GET'): Promise<string> {
    return field((await this.builder('knock', { knocker, method })).body, 'status')
  }

  /** Asks the builders until Pomerium has taken up the house's latest rules. */
  async liveWithin(seconds: number): Promise<boolean> {
    const answer = await until(
      async () => field((await this.builder('status', {})).body, 'live'),
      (live) => live === 'true',
      seconds,
      1000,
    )

    return answer === 'true'
  }

  /** Saves rules, waiting out the builders' pause between saves; returns the status of the save itself. */
  async save(rules: Json): Promise<number> {
    return until(
      async () => (await this.builder('save', rules)).status,
      (code) => code !== 503,
      30,
      1000,
    )
  }
}

/** A player with a fresh account on the Oracle, signed in. */
export async function newPlayer(name: string): Promise<Player> {
  const player = new Player(`${name}-${RUN}@${PLAYERS}`)
  await player.signUp()

  return player
}

/**
 * A newcomer isn't a citizen until the Oracle says so: the Oracle grants the citizens group and the deed,
 * and the player's session refreshes to carry them.
 */
export async function becomeCitizen(player: Player) {
  expect(
    await player.status('/zones/oracle/citizen', 'POST'),
    'the Oracle grants citizenship and a deed',
  ).toBe(200)
  await player.refreshed(/"deed":"[0-9a-f-]{36}"/)
  expect(await player.get('/zones/oracle/'), 'the new session carries a deed claim').toMatch(
    /"deed":"[0-9a-f-]{36}"/,
  )

  // Pomerium takes a moment to see the new claims; wait, so the first request after this isn't a stale 403.
  expect(
    await player.gateUntilOpen('/zones/town/enter'),
    'town opens once the session carries citizens',
  ).toBe(200)
}

/** Makes the player a knight and a scholar, so the keep opens: one refresh covers both. */
export async function reachTheKeep(player: Player) {
  expect(await player.status('/zones/guild/knight', 'POST'), 'the Captain knights the player').toBe(200)
  expect(await player.status('/zones/oracle/scholar', 'POST'), 'the Librarian names a scholar').toBe(200)
  await player.refreshed(/"scholars"/)
  expect(await player.gateUntilOpen('/zones/keep/enter'), 'the keep opens').toBe(200)
}

export const tools = { method: 'tools/list' }
export const call = (tool: string) => ({ method: 'tools/call', tool })
export const rules = (list: Json[]) => ({ rules: list })
export const emailIs = (email: string) => ({ kind: 'email', is: email })
export const claimGroup = (value: string) => ({ kind: 'claim', claim: 'groups', value })
