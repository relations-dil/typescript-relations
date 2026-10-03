import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import * as overscore from '../src/overscore.js'

describe('overscore', () => {
  it('parses every underscore form', () => {
    assert.deepEqual(overscore.parse('a-b__0___1____2_____3'), ['a-b', 0, -1, '2', '-3'])
    assert.deepEqual(overscore.parse('things__a__b__0____1'), ['things', 'a', 'b', 0, '1'])
    assert.deepEqual(overscore.parse('name'), ['name'])
  })

  it('compiles back to the same text', () => {
    assert.equal(overscore.compile(['a-b', 0, -1, '2', '-3']), 'a-b__0___1____2_____3')
    assert.deepEqual(overscore.parse(overscore.compile(['a', 1, 'b'])), ['a', 1, 'b'])
  })

  it('refuses to compile nonsense', () => {
    assert.throws(() => overscore.compile([{} as any]), overscore.OverscoreError)
  })

  it('gets values at a path', () => {
    const data = { things: { a: { b: [{ '1': 'yep' }] } } }

    assert.equal(overscore.get(data, 'things__a__b__0____1'), 'yep')
    assert.equal(overscore.get(data, ['things', 'a', 'b', 0, '1']), 'yep')
    assert.equal(overscore.get(data, 'things__nope'), null)
    assert.equal(overscore.get(data, 'things__a__b__5'), null)
  })

  it('says whether a path is there', () => {
    const data = { a: [1, 2, 3] }

    assert.equal(overscore.has(data, 'a__1'), true)
    assert.equal(overscore.has(data, 'a__9'), false)
    assert.equal(overscore.has(data, 'a___1'), true)
    assert.equal(overscore.has(data, 'b'), false)
  })

  it('sets values, building the structure on the way', () => {
    const data: any = {}

    overscore.set(data, 'things__a__b___2____1', 'yep')

    assert.deepEqual(data, { things: { a: { b: [{ '1': 'yep' }, null] } } })

    overscore.set(data, ['things', 'a', 'b', -2, '1'], 'sure')

    assert.equal((data.things.a.b[0] as any)['1'], 'sure')
  })

  it('refuses mismatched containers', () => {
    assert.throws(() => overscore.set({ a: [] }, 'a__b', 1), overscore.OverscoreError)
    assert.throws(() => overscore.set({ a: {} }, 'a__0', 1), overscore.OverscoreError)
  })
})
