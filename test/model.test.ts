import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  ManyToMany,
  MockSource,
  Model,
  ModelError,
  OneToMany,
  OneToOne,
  UniqueError,
  clear,
  fields,
  int,
  list,
  str
} from '../src/index.js'

class Base extends Model {
  static source = 'example'
}

class Unit extends fields({ id: int, name: str }, Base) {
  declare test: Test
}

class Test extends fields({ id: int, unit_id: int, name: str }, Base) {
  declare unit: Unit
  declare case: Case
}

class Case extends fields({ id: int, test_id: int, name: str }, Base) {
  declare test: Test
}

new OneToMany(Unit, Test)
new OneToOne(Test, Case)

function source(): MockSource {
  clear()
  return new MockSource('example')
}

describe('the README example', () => {
  beforeEach(source)

  it('does everything it says it does', async () => {
    await new Unit('yep').create()

    const yep = await Unit.one({ name: 'yep' }).retrieve()
    assert.equal(yep!.id, 1)

    await new Unit([['people'], ['stuff']]).create()

    const stuff = await Unit.one({ name: 'stuff' }).retrieve()
    stuff!.set({ name: 'things' })
    assert.equal(await stuff!.update(), 1)

    const unit = (await Unit.one(2).retrieve())!
    unit.name = 'thing'

    unit.test.add('moar')
    await unit.update()

    const tests = (await Test.many({ unit__name: 'thing', id__gt: 0 }).retrieve())!
    assert.equal(tests[0].name, 'moar')
  })
})

describe('Model identity', () => {
  beforeEach(source)

  it('derives name, titles, list and unique', () => {
    const identity = Unit.thy()

    assert.equal(identity.TITLE, 'Unit')
    assert.equal(identity.NAME, 'unit')
    assert.equal(identity._id, 'id')
    assert.deepEqual(identity._titles, ['name'])
    assert.deepEqual(identity._list, ['id', 'name'])
    assert.deepEqual(identity._unique, { name: ['name'] })
    assert.deepEqual(identity._order, ['+name'])
  })

  it('underscores a camel case class name', () => {
    class UnitTest extends fields({ id: int, name: str }, Base) {}

    assert.equal(UnitTest.thy().NAME, 'unit_test')
  })

  it('takes an explicit store name', () => {
    class Odd extends fields({ id: int, name: str }, Base) {
      static store = 'weird_table'
    }

    assert.equal(Odd.thy().NAME, 'weird_table')
  })

  it('describes itself', () => {
    const definition = Unit.thy().define()

    assert.equal(definition.name, 'unit')
    assert.equal(definition.source, 'example')
    assert.deepEqual(definition.unique, { name: ['name'] })
    assert.deepEqual(
      definition.fields.map((field: any) => field.name),
      ['id', 'name']
    )
  })

  it('complains about unknown fields in config', () => {
    class Broken extends fields({ id: int, name: str }, Base) {
      static titles = ['nope']
    }

    assert.throws(() => Broken.thy(), ModelError)
  })
})

describe('field declaration shorthands', () => {
  beforeEach(source)

  it('accepts kinds, options, defaults and specs', () => {
    class Thing extends fields(
      {
        id: int,
        name: str,
        status: ['open', 'closed'],
        tags: list,
        rank: () => 3,
        note: { kind: str, none: true, length: 40 }
      },
      Base
    ) {}

    const record = Thing.thy()._fields

    assert.equal(record.field('status')!.default, 'open')
    assert.deepEqual(record.field('status')!.options, ['open', 'closed'])
    assert.equal(record.field('tags')!.none, false)
    assert.equal((record.field('rank')!.kind as any).name, 'int')
    assert.equal(record.field('note')!.length, 40)
  })
})

describe('create, retrieve, update, delete', () => {
  beforeEach(source)

  it('creates one and many', async () => {
    const one = await new Unit('solo').create()
    assert.equal(one.id, 1)

    const many = await new Unit([['a'], ['b'], { name: 'c' }]).create()
    assert.equal(many.size, 3)
    assert.deepEqual(many.name, ['a', 'b', 'c'])
  })

  it('counts', async () => {
    await new Unit([['a'], ['b']]).create()

    assert.equal(await Unit.many().count(), 2)
    assert.equal(await Unit.many({ name: 'a' }).count(), 1)
  })

  it('errors on a missing one, unless told not to', async () => {
    await assert.rejects(() => Unit.one({ name: 'nope' }).retrieve(), ModelError)
    assert.equal(await Unit.one({ name: 'nope' }).retrieve(false), null)
  })

  it('errors when one matches many', async () => {
    await new Unit([['a'], ['b']]).create()

    await assert.rejects(() => Unit.one({ id__gt: 0 }).retrieve(), ModelError)
  })

  it('refuses to read before retrieving', () => {
    assert.throws(() => Unit.one({ name: 'a' }).id, /not retrieved yet/)
  })

  it('mass updates', async () => {
    await new Unit([['a'], ['b']]).create()

    assert.equal(await Unit.many({ name: 'a' }).set({ name: 'z' }).update(), 1)
    assert.equal(await Unit.many({ name: 'z' }).count(), 1)
  })

  it('deletes', async () => {
    await new Unit([['a'], ['b']]).create()

    assert.equal(await Unit.many({ name: 'a' }).delete(), 1)
    assert.equal(await Unit.many().count(), 1)
  })

  it('enforces unique indexes and rolls back', async () => {
    await new Unit('a').create()

    await assert.rejects(() => new Unit([['b'], ['a']]).create(), UniqueError)

    assert.equal(await Unit.many().count(), 1)
  })

  it('sorts and limits', async () => {
    await new Unit([['c'], ['a'], ['b']]).create()

    const sorted = (await Unit.many().retrieve())!
    assert.deepEqual(sorted.name, ['a', 'b', 'c'])

    const down = (await Unit.many().sort('-name').retrieve())!
    assert.deepEqual(down.name, ['c', 'b', 'a'])

    const page = (await Unit.many().limit({ page: 2, perPage: 2 }).retrieve())!
    assert.deepEqual(page.name, ['c'])
  })

  it('bulk inserts without reading ids back', async () => {
    const bulk = Unit.bulk(2)

    await bulk.queue('a')
    await bulk.queue('b')
    await bulk.queue('c')
    await bulk.create()

    assert.equal(await Unit.many().count(), 3)
  })

  it('exports and serialises', async () => {
    const unit = await new Unit('a').create()

    assert.deepEqual(unit.export(), { id: 1, name: 'a' })
    assert.equal(JSON.stringify(unit), '{"id":1,"name":"a"}')
  })
})

describe('one to many', () => {
  beforeEach(source)

  it('creates children through the parent', async () => {
    const unit = new Unit('a')
    unit.test.add('one').add('two')
    await unit.create()

    assert.equal(await Test.many().count(), 2)

    const tests = (await Test.many({ unit_id: unit.id }).retrieve())!
    assert.deepEqual(tests.name, ['one', 'two'])
  })

  it('filters a child by the parent', async () => {
    const first = new Unit('a')
    first.test.add('x')
    await first.create()

    const second = new Unit('b')
    second.test.add('y')
    await second.create()

    const tests = (await Test.many({ unit__name: 'b' }).retrieve())!
    assert.deepEqual(tests.name, ['y'])
  })

  it('filters a parent by its children', async () => {
    const first = new Unit('a')
    first.test.add('x')
    await first.create()

    await new Unit('b').create()

    const units = (await Unit.many({ test__name: 'x' }).retrieve())!
    assert.deepEqual(units.name, ['a'])
  })

  it('reaches the parent from a child', async () => {
    const unit = new Unit('a')
    unit.test.add('x')
    await unit.create()

    const test = (await Test.one({ name: 'x' }).retrieve())!
    const parent = (await test.unit.retrieve())!
    assert.equal(parent.name, 'a')
  })
})

describe('one to one', () => {
  beforeEach(source)

  it('allows exactly one child', async () => {
    const unit = new Unit('a')
    unit.test.add('x')
    await unit.create()

    const test = (await Test.one({ name: 'x' }).retrieve())!
    test.case.add('c')
    await test.update()

    assert.equal(await Case.many().count(), 1)

    const again = (await Test.one({ name: 'x' }).retrieve())!
    again.case.add('d')
    assert.throws(() => again.case.add('e'), ModelError)
  })
})

describe('many to many', () => {
  class Sister extends fields({ id: int, name: str, brother_id: list }, Base) {}

  class Brother extends fields({ id: int, name: str, sister_id: list }, Base) {}

  class Tie extends fields({ sister_id: int, brother_id: int }, Base) {
    static id = null
    static unique = { sister_brother: ['sister_id', 'brother_id'] }
  }

  new ManyToMany(Sister, Brother, Tie)

  beforeEach(source)

  async function fixture() {
    const jane = await new Sister({ name: 'jane' }).create()
    const mary = await new Sister({ name: 'mary' }).create()

    await new Brother({ name: 'tom', sister_id: [jane.id, mary.id] }).create()
    await new Brother({ name: 'dick', sister_id: [jane.id] }).create()

    return { jane, mary }
  }

  it('ties both sides', async () => {
    const { jane } = await fixture()

    const tom = (await Brother.one({ name: 'tom' }).retrieve())!
    assert.equal(tom.sister_id.length, 2)

    const reloaded = (await Sister.one({ id: jane.id }).retrieve())!
    assert.equal(reloaded.brother_id.length, 2)
  })

  it('filters by tie ids', async () => {
    const { jane, mary } = await fixture()

    const both = (await Brother.many({ sister_id__all: [jane.id, mary.id] }).retrieve())!
    assert.deepEqual(both.name, ['tom'])

    const either = (await Brother.many({ sister_id__any: [mary.id] }).retrieve())!
    assert.deepEqual(either.name, ['tom'])
  })

  it('filters by a sibling attribute', async () => {
    await fixture()

    const sisters = (await Sister.many({ brother__name: 'dick' }).retrieve())!
    assert.deepEqual(sisters.name, ['jane'])
  })

  it('deletes ties with the record', async () => {
    await fixture()

    await Brother.many({ name: 'tom' }).delete()

    const jane = (await Sister.one({ name: 'jane' }).retrieve())!
    assert.equal(jane.brother_id.length, 1)
  })
})

class Owner extends fields({ id: int, name: str }, Base) {
  declare item: Item
}

class Item extends fields({ id: int, owner_id: int, name: str }, Base) {
  static titles = ['owner_id', 'name']
}

new OneToMany(Owner, Item)

describe('titles', () => {
  beforeEach(source)

  it('builds titles keyed by id', async () => {
    await new Unit([['a'], ['b']]).create()

    const titles = await Unit.many().titles()

    assert.deepEqual(titles.ids, [1, 2])
    assert.deepEqual(titles.get(1), ['a'])
    assert.deepEqual(titles.fields, ['name'])
  })

  it('pulls a parent title through a relation', async () => {
    const owner = new Owner('gaf')
    owner.item.add('spanner')
    await owner.create()

    const titles = await Item.many().titles()

    assert.deepEqual(titles.get(1), ['gaf', 'spanner'])
  })
})

describe('fuzzy matching', () => {
  beforeEach(source)

  it('matches on title fields', async () => {
    await new Unit([['alpha'], ['beta']]).create()

    const found = (await Unit.many({ like: 'lph' }).retrieve())!
    assert.deepEqual(found.name, ['alpha'])
  })
})

describe('queries', () => {
  beforeEach(source)

  it('describes what would run without running it', () => {
    assert.equal(new Unit('a').query().action, 'CREATE')
    assert.equal(Unit.many().query().action, 'RETRIEVE')
    assert.equal(Unit.many().query('count').action, 'COUNT')
    assert.equal(Unit.many().query('delete').action, 'DELETE')
  })
})
