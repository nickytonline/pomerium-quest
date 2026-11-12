import { execFileSync } from 'node:child_process'

import { beforeAll, describe, expect, it } from 'vite-plus/test'

import { type Player, becomeCitizen, field, newPlayer, rules, until } from './support.ts'

let home: Player
let path = ''

beforeAll(async () => {
  home = await newPlayer('idle')
  await becomeCitizen(home)
  path = field((await home.builder('open', { rules: null })).body, 'path')
  await home.liveWithin(60)
})

describe('Idle houses', () => {
  it('has no route once the house is removed', async () => {
    const houseId = path.split('/')[3]

    execFileSync(
      'kubectl',
      ['--context', 'k3d-quest', '-n', 'quest-houses', 'delete', 'ingress', `house-${houseId}`],
      {
        stdio: 'ignore',
      },
    )

    const gone = await until(
      () => home.status(`${path}knock`),
      (code) => code === 404,
      30,
      1000,
    )

    expect(gone).toBe(404)
  })

  it('rebuilds it from the saved rules when the owner walks back in', async () => {
    expect((await home.builder('open', rules([]))).status).toBe(200)
  })

  it('answers its owner again', async () => {
    expect(await home.status(`${path}knock`)).toBe(200)
  })
})
