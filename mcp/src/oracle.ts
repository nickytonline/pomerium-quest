// The owl's letters to the Oracle (Keycloak, the identity provider): a tool asks him to add the player to
// a group. Pomerium only sees the change once the player signs in again, as with the Captain's letter.
import { z } from 'zod'
import type { Config } from './config.ts'

/** Adds the player with this email to a group at the Oracle. */
export type Grant = (email: string, group: string) => Promise<void>

const TokenResponse = z.object({ access_token: z.string() })
const Found = z.array(z.object({ id: z.string(), name: z.string().optional() }))

export function keycloakGrant(config: Config): Grant {
  const realmUrl = `${config.KEYCLOAK_URL}/realms/${config.KEYCLOAK_REALM}`
  const adminUrl = `${config.KEYCLOAK_URL}/admin/realms/${config.KEYCLOAK_REALM}`

  const ok = async (response: Response) => {
    if (!response.ok) throw new Error(`the Oracle answered ${response.status} to ${response.url}`)

    return response
  }

  // The server signs in to Keycloak as the game's service account, which may only manage users.
  const token = async () => {
    const response = await fetch(`${realmUrl}/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.KEYCLOAK_CLIENT_ID,
        client_secret: config.KEYCLOAK_CLIENT_SECRET,
      }),
    }).then(ok)

    return TokenResponse.parse(await response.json()).access_token
  }

  const find = async (
    path: string,
    params: Record<'exact' | 'email' | 'search', string | undefined>,
    auth: string,
  ) => {
    const url = new URL(`${adminUrl}/${path}`)

    for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value)

    const response = await fetch(url, { headers: { authorization: auth } }).then(ok)

    return Found.parse(await response.json())
  }

  return async (email, group) => {
    const auth = `Bearer ${await token()}`
    const [user] = await find('users', { email, exact: 'true', search: undefined }, auth)

    if (!user) throw new Error(`the Oracle knows no one called ${email}`)

    const groups = await find('groups', { search: group, exact: 'true', email: undefined }, auth)
    const found = groups.find((candidate) => candidate.name === group)

    if (!found) throw new Error(`the Oracle keeps no group called ${group}; run ./quest deploy`)

    await fetch(`${adminUrl}/users/${user.id}/groups/${found.id}`, {
      method: 'PUT',
      headers: { authorization: auth },
    }).then(ok)
  }
}
