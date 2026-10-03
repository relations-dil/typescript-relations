import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { LocalSource, MockSource, Model, OneToMany, UniqueError, clear, int, list, str } from '../src/index.js'
import type { StorageLike } from '../src/index.js'

// localStorage, without a browser.
class FakeStorage implements StorageLike {
  items: Map<string, string> = new Map()

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }
}

class Base extends Model {
  static source = 'local'
}

class Unit extends Base {
  static fields = { id: int, name: str, tags: new Set(['a', 'b', 'c']), notes: list }
}

class Test extends Base {
  static fields = { id: int, unit_id: int, name: str }
}

new OneToMany(Unit, Test)

describe('LocalSource', () => {
  let storage: FakeStorage

  // A page load: a fresh source over whatever the storage already holds.
  const load = (options: Record<string, any> = {}) => new LocalSource('local', { storage, key: 'app', ...options })

  beforeEach(() => {
    clear()
    storage = new FakeStorage()
  })

  it('is a source of its own kind', () => {
    const local = load()

    assert.equal(LocalSource.KIND, 'local')
    assert.equal(MockSource.KIND, 'mock')
    assert.equal(local.key, 'app')
  })

  it('keeps records across a reload', async () => {
    load()

    await new Unit([['people'], ['stuff']]).create()
    await new Test({ unit_id: 2, name: 'moar' }).create()

    // The page goes away; a new one starts over the same storage.
    clear()
    load()

    const units: any = await Unit.many().sort('id').retrieve()
    assert.deepEqual(units.name, ['people', 'stuff'])

    const test: any = await Test.one({ name: 'moar' }).retrieve()
    assert.equal(test.unit_id, 2)
  })

  it('keeps counting ids from where it left off', async () => {
    load()
    await new Unit([['one'], ['two']]).create()

    clear()
    load()
    const unit: any = await new Unit('three').create()

    assert.equal(unit.id, 3)
  })

  it('keeps unique indexes across a reload', async () => {
    load()
    await new Unit('once').create()

    clear()
    load()

    await assert.rejects(() => new Unit('once').create(), UniqueError)
  })

  it('keeps sets and lists as they were', async () => {
    load()
    await new Unit({ name: 'full', tags: new Set(['c', 'a']), notes: [1, { two: [3] }] }).create()

    clear()
    load()
    const unit: any = await Unit.one({ name: 'full' }).retrieve()

    assert.deepEqual([...unit.tags], ['a', 'c'])
    assert.deepEqual(unit.notes, [1, { two: [3] }])
  })

  it('saves updates', async () => {
    load()
    await new Unit('before').create()

    const unit: any = await Unit.one({ name: 'before' }).retrieve()
    unit.name = 'after'
    assert.equal(await unit.update(), 1)

    clear()
    load()

    assert.equal(await Unit.many({ name: 'before' }).count(), 0)
    assert.equal(await Unit.many({ name: 'after' }).count(), 1)
  })

  it('saves deletes', async () => {
    load()
    await new Unit([['stay'], ['go']]).create()

    assert.equal(await Unit.one({ name: 'go' }).delete(), 1)

    clear()
    load()

    const left: any = await Unit.many().retrieve()

    assert.deepEqual(left.name, ['stay'])
  })

  it('does not save a write that failed', async () => {
    load()
    await new Unit('only').create()
    const saved = storage.getItem('app')

    await assert.rejects(() => new Unit('only').create(), UniqueError)

    assert.equal(storage.getItem('app'), saved)
  })

  it('writes plain JSON', async () => {
    load()
    await new Unit('plain').create()

    const parsed = JSON.parse(storage.getItem('app') as string)

    assert.deepEqual(parsed.ids, { unit: 1 })
    assert.deepEqual(parsed.data.unit[0], [1, { name: 'plain', tags: [], notes: [], id: 1 }])
  })

  it('starts empty when nothing was saved', async () => {
    load()

    assert.equal(await Unit.many().count(), 0)
    assert.equal(storage.getItem('app'), null)
  })

  it('uses its name for the key when none is given', async () => {
    new LocalSource('local', { storage })

    await new Unit('named').create()

    assert.ok(storage.getItem('relations:local'))
  })

  it('refuses to start over storage that is not JSON, rather than overwrite it', () => {
    storage.setItem('app', 'not json')

    assert.throws(() => load(), /app in storage isn't valid JSON/)
    assert.equal(storage.getItem('app'), 'not json')
  })

  it('needs somewhere to keep things', () => {
    assert.throws(() => new LocalSource('local', {}), /no localStorage here/)
  })

  it('uses the page localStorage when it has one', async () => {
    const page = new FakeStorage()
    ;(globalThis as any).localStorage = page

    try {
      new LocalSource('local', { key: 'page' })
      await new Unit('there').create()

      assert.ok(page.getItem('page'))
    } finally {
      delete (globalThis as any).localStorage
    }
  })

  it('forgets everything on reset, and the models still work', async () => {
    const local = load()
    await new Unit('gone').create()
    await new Test({ unit_id: 1, name: 'too' }).create()

    local.reset()

    assert.equal(storage.getItem('app'), null)
    assert.equal(await Unit.many().count(), 0)
    assert.equal(await Test.many().count(), 0)

    const unit: any = await new Unit('gone').create()
    assert.equal(unit.id, 1)
  })
})
