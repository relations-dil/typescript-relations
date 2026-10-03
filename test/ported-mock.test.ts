/**
 * Ported from python-relations:
 *
 *   test/test_relations/test_unittest.py  (MockQuery / MockSource)
 *   test/test_relations/test_source.py    (Source)
 *
 * Translation notes (see the report accompanying this file):
 *
 *  - Python's implicit "read a field and it retrieves for you" is gone, so every place
 *    Python leaned on it has an explicit `await ...retrieve()` here.
 *  - `source.data` / `source.unique` hold Maps in the port, so they are flattened with
 *    `plain()` / `uniques()` before comparing with the Python-shaped literals.
 *  - Unique index values are `JSON.stringify` output (`{"name":"ya"}`) rather than
 *    Python's `json.dumps` output (`{"name": "ya"}`). Only the separator differs.
 *  - `test_rollback` (decorator + MagicMock), the `TestUnitTest` assertion-helper class,
 *    and the `unittest.mock.patch` reflection tests that have no JS analogue are skipped;
 *    the patched-method tests that *do* translate are done by shadowing the method on the
 *    instance and recording calls.
 */

import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  Field,
  ManyToMany,
  Migrations,
  MockQuery,
  MockSource,
  Model,
  ModelError,
  OneToMany,
  OneToOne,
  Source,
  UniqueError,
  bool,
  clear,
  dict,
  fields,
  float,
  int,
  list,
  set,
  source as registeredSource,
  str
} from '../src/index.js'

// --------------------------------------------------------------------------- ip stand-ins

/** Stand-in for Python's `ipaddress.IPv4Address`. */
class IPv4Address {
  address: string

  constructor(value: any) {
    const text = typeof value === 'string' ? value : String(value?.address ?? value)
    const octets = text.split('.')

    if (octets.length !== 4 || octets.some((octet) => !/^\d+$/.test(octet) || Number(octet) > 255)) {
      throw new Error(`${text} does not appear to be an IPv4 address`)
    }

    this.address = octets.map((octet) => String(Number(octet))).join('.')
  }

  get compressed(): string {
    return this.address
  }

  /** Python's `int(ip)`. */
  __int__(): number {
    return this.address.split('.').reduce((total, octet) => total * 256 + Number(octet), 0)
  }

  toString(): string {
    return this.address
  }

  static of(value: number): IPv4Address {
    return new IPv4Address([24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.'))
  }
}

/** Python's `int(ipaddress.IPv4Address(text))`. */
function ipInt(text: string): number {
  return new IPv4Address(text).__int__()
}

/** Stand-in for Python's `ipaddress.IPv4Network`. */
class IPv4Network {
  network: string
  prefix: number

  constructor(value: any) {
    const text = typeof value === 'string' ? value : String(value?.address ?? value)
    const [address, bits] = text.split('/')

    this.prefix = bits === undefined ? 32 : Number(bits)

    if (!Number.isInteger(this.prefix) || this.prefix < 0 || this.prefix > 32) {
      throw new Error(`${text} does not appear to be an IPv4 network`)
    }

    const mask = this.prefix === 0 ? 0 : (0xffffffff << (32 - this.prefix)) >>> 0
    const base = (new IPv4Address(address).__int__() & mask) >>> 0

    this.network = IPv4Address.of(base).compressed
  }

  get compressed(): string {
    return `${this.network}/${this.prefix}`
  }

  get first(): IPv4Address {
    return new IPv4Address(this.network)
  }

  get last(): IPv4Address {
    const size = this.prefix === 32 ? 0 : 2 ** (32 - this.prefix) - 1
    return IPv4Address.of((new IPv4Address(this.network).__int__() + size) >>> 0)
  }

  toString(): string {
    return this.compressed
  }
}

/** Python's `subnet_attr`. */
function subnetAttr(values: Record<string, any>, value: IPv4Network): void {
  values.address = String(value)

  const min = value.first
  const max = value.last

  values.min_address = String(min)
  values.min_value = min.__int__()
  values.max_address = String(max)
  values.max_value = max.__int__()
}

// --------------------------------------------------------------------------- models

class SourceModel extends Model {
  static source = 'UnittestSource'
}

class Simple extends fields({ id: int, name: str }, SourceModel) {
  declare plain: any
}

class Plain extends fields({ simple_id: int, name: str }, SourceModel) {
  static id = null
  declare simple: any
}

new OneToMany(Simple, Plain)

class Meta extends fields(
  {
    id: int,
    name: str,
    flag: bool,
    spend: float,
    people: set,
    stuff: list,
    things: { kind: dict, extract: 'for__0____1' },
    push: { kind: str, inject: 'stuff___1__relations.io____1' }
  },
  SourceModel
) {}

class Net extends fields(
  {
    id: int,
    ip: {
      kind: IPv4Address,
      attr: { compressed: 'address', __int__: 'value' },
      init: 'address',
      titles: 'address',
      extract: ['address', 'value']
    },
    subnet: {
      kind: IPv4Network,
      attr: subnetAttr,
      init: 'address',
      titles: 'address'
    }
  },
  SourceModel
) {
  static titles = 'ip__address'
  static index = 'ip__address'
}

class Unit extends fields({ id: int, name: { kind: str, format: 'fancy' } }, SourceModel) {
  declare test: any
}

class Test extends fields({ id: int, unit_id: int, name: { kind: str, format: 'shmancy' } }, SourceModel) {
  declare unit: any
  declare case: any
}

class Case extends fields({ id: int, test_id: int, name: str }, SourceModel) {
  declare test: any
}

new OneToMany(Unit, Test)
new OneToOne(Test, Case)

class Sis extends fields({ id: int, name: str, bro_id: set }, SourceModel) {
  declare bro: any
}

class Bro extends fields({ id: int, name: str, sis_id: set }, SourceModel) {
  declare sis: any
}

class SisBro extends fields({ bro_id: int, sis_id: int }, SourceModel) {
  static id = null
}

new ManyToMany(Sis, Bro, SisBro)

// --------------------------------------------------------------------------- helpers

let source: MockSource

function setUp(): void {
  clear()
  source = new MockSource('UnittestSource')
}

/** `source.data` as the plain nested object Python compares against. */
function plain(mock: MockSource = source): Record<string, any> {
  return Object.fromEntries(
    Object.entries(mock.data).map(([name, records]) => [name, Object.fromEntries(records)])
  )
}

/** `source.unique` as the plain nested object Python compares against. */
function uniques(mock: MockSource = source): Record<string, any> {
  return Object.fromEntries(
    Object.entries(mock.unique).map(([name, indexes]) => [
      name,
      Object.fromEntries(Object.entries(indexes).map(([index, ids]) => [index, Object.fromEntries(ids)]))
    ])
  )
}

/** Python's `assertRaisesRegex`, for a rejected promise. */
async function rejects(work: () => Promise<any>, kind: any, message?: string): Promise<void> {
  await assert.rejects(work, (error: any) => {
    assert.ok(
      error instanceof kind,
      `expected ${kind.name}, got ${error?.constructor?.name}: ${error?.message}`
    )

    if (message !== undefined) {
      assert.ok(
        String(error.message).includes(message),
        `expected message to contain ${JSON.stringify(message)}, got ${JSON.stringify(error.message)}`
      )
    }

    return true
  })
}

/** Python's `throws`, for a synchronous call. */
function throwsWith(work: () => any, kind: any, message?: string): void {
  assert.throws(work, (error: any) => {
    assert.ok(
      error instanceof kind,
      `expected ${kind.name}, got ${error?.constructor?.name}: ${error?.message}`
    )

    if (message !== undefined) {
      assert.ok(
        String(error.message).includes(message),
        `expected message to contain ${JSON.stringify(message)}, got ${JSON.stringify(error.message)}`
      )
    }

    return true
  })
}

/** Python's `ddl` directory, per test, cleaned up after. */
async function withTemp(work: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'relations-mock-'))

  try {
    await work(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const SIMPLE_DEFINITION = {
  source: 'UnittestSource',
  name: 'simple',
  title: 'Simple',
  fields: [
    { name: 'id', kind: 'int', store: 'id', none: true, auto: true },
    { name: 'name', kind: 'str', store: 'name', none: false }
  ],
  id: 'id',
  unique: { name: ['name'] },
  index: {}
}

const MIGS_DEFINITION = {
  source: 'UnittestSource',
  name: 'migs',
  fields: [
    { name: 'fie', store: 'fie', kind: 'int' },
    { name: 'foe', store: 'foe', kind: 'int' }
  ]
}

const MIGS_MIGRATION = {
  source: 'UnittestSource',
  name: 'mig',
  fields: {
    add: [{ name: 'fee', store: 'fee', kind: 'int' }],
    remove: ['fie'],
    change: { foe: { name: 'fum', kind: 'float' } }
  }
}

const MIGS_CHANGED = {
  ACTION: 'change',
  DEFINITION: MIGS_DEFINITION,
  MIGRATION: {
    source: 'UnittestSource',
    name: 'mig',
    fields: [
      { ACTION: 'add', name: 'fee', store: 'fee', kind: 'int' },
      { ACTION: 'remove', name: 'fie', store: 'fie', kind: 'int' },
      {
        ACTION: 'change',
        DEFINITION: { name: 'foe', store: 'foe', kind: 'int' },
        MIGRATION: { name: 'fum', kind: 'float' }
      }
    ]
  }
}

// =========================================================================== TestQuery

describe('MockQuery', () => {
  beforeEach(setUp)

  it('test___init__', () => {
    const query = new MockQuery('ACTION')

    assert.equal(query.action, 'ACTION')
  })

  it('test_bind', () => {
    const query = new MockQuery('QUERY').bind('MODEL' as any)

    assert.equal(query.model, 'MODEL')
  })
})

// =========================================================================== TestSource (mock)

describe('MockSource', () => {
  beforeEach(setUp)

  it('test___init__', () => {
    clear()

    const unit = new MockSource('unit')

    assert.equal(unit.name, 'unit')
    assert.equal(registeredSource('unit'), unit)
  })

  it('test_init', () => {
    class Check extends fields({ id: int, name: str }) {}

    const model = new Check()

    source.init(model)

    assert.deepEqual(source.ids, { check: 0 })
    assert.deepEqual(plain(), { check: {} })
    // Divergence: Python instantiates a child model during _propagate, which registers
    // `case` with the source as a side effect. The port only reaches for children that
    // already exist, so an untouched Case never registers.
    assert.deepEqual(uniques(), { check: { name: {} } })
    assert.equal(model._fields.field('id')!.auto, true)
  })

  it('test_field_define', () => {
    const field = new Field(int, { store: '_id' })

    source.fieldInit(field)

    const definitions: any[] = []

    source.fieldDefine(field.define(), definitions)

    assert.deepEqual(definitions, [{ kind: 'int', store: '_id', none: true }])
  })

  it('test_define', () => {
    assert.deepEqual(Simple.define(), [{ ACTION: 'add', ...SIMPLE_DEFINITION }])
  })

  it('test_field_add', () => {
    const field = new Field(int, { store: '_id' })

    source.fieldInit(field)

    const migrations: any[] = []

    source.fieldAdd(field.define(), migrations)

    assert.deepEqual(migrations, [{ ACTION: 'add', kind: 'int', store: '_id', none: true }])
  })

  it('test_field_remove', () => {
    const field = new Field(int, { store: '_id' })

    source.fieldInit(field)

    const migrations: any[] = []

    source.fieldRemove(field.define(), migrations)

    assert.deepEqual(migrations, [{ ACTION: 'remove', kind: 'int', store: '_id', none: true }])
  })

  it('test_field_change', () => {
    const field = new Field(int, { store: '_id' })

    source.fieldInit(field)

    const migrations: any[] = []

    source.fieldChange(field.define(), { kind: 'float' }, migrations)

    assert.deepEqual(migrations, [
      {
        ACTION: 'change',
        DEFINITION: { kind: 'int', store: '_id', none: true },
        MIGRATION: { kind: 'float' }
      }
    ])
  })

  it('test_model_add', () => {
    assert.deepEqual(source.modelAdd(Simple.thy().define()), [{ ACTION: 'add', ...SIMPLE_DEFINITION }])
  })

  it('test_model_remove', () => {
    assert.deepEqual(source.modelRemove(Simple.thy().define()), [{ ACTION: 'remove', ...SIMPLE_DEFINITION }])
  })

  it('test_model_change', () => {
    assert.deepEqual(source.modelChange(MIGS_DEFINITION, MIGS_MIGRATION), [MIGS_CHANGED])
  })

  it('test_extract', () => {
    assert.equal(
      MockSource.extract(new Meta(), { things: { for: [{ '1': 'yep' }] } })['things__for__0____1'],
      'yep'
    )
    assert.equal(MockSource.extract(new Meta(), {})['things__for__0____1'], null)
  })

  it('test_uniques', async () => {
    await new Simple('ya').create()

    const sure = new Simple('sure')

    source.uniques(sure, sure.export(), 2)

    assert.deepEqual(Object.fromEntries(source.unique.simple.name), {
      1: '{"name":"ya"}',
      2: '{"name":"sure"}'
    })

    source.uniques(sure, sure.export(), 2)

    throwsWith(
      () => source.uniques(sure, sure.export(), 3),
      UniqueError,
      'simple: value {"name":"sure"} violates unique name'
    )
  })

  it('test_create_query', () => {
    assert.equal(source.createQuery(null as any).action, 'CREATE')
  })

  it('test_create', async () => {
    const simple = new Simple('sure')

    simple.plain.add('fine')

    await simple.create()

    assert.equal(simple.id, 1)
    assert.equal(simple._action, 'update')
    assert.equal((simple._record as any)._action, 'update')
    assert.equal(simple.plain[0].simple_id, 1)
    assert.equal(simple.plain._action, 'update')
    assert.equal(simple.plain[0]._record._action, 'update')

    const simples = await Simple.bulk().add('ya').create()

    assert.deepEqual(simples._models, [])

    const yep = await new Meta(
      'yep',
      true,
      3.5,
      new Set(['tom']),
      [1, null],
      { a: 1, for: [{ '1': 'yep' }] },
      'sure'
    ).create()

    assert.equal((await Meta.one(yep.id).retrieve())!.flag, true)

    const nope = await new Meta('nope', false).create()

    assert.equal((await Meta.one(nope.id).retrieve())!.flag, false)

    assert.deepEqual(source.ids, { simple: 2, plain: 1, meta: 2 })

    assert.deepEqual(plain(), {
      simple: {
        1: { id: 1, name: 'sure' },
        2: { id: 2, name: 'ya' }
      },
      plain: {
        1: { simple_id: 1, name: 'fine' }
      },
      meta: {
        1: {
          id: 1,
          name: 'yep',
          flag: true,
          spend: 3.5,
          people: ['tom'],
          stuff: [1, { 'relations.io': { '1': 'sure' } }],
          things: { a: 1, for: [{ '1': 'yep' }] },
          things__for__0____1: 'yep'
        },
        2: {
          id: 2,
          name: 'nope',
          flag: false,
          spend: null,
          people: [],
          stuff: [{ 'relations.io': { '1': null } }],
          things: {},
          things__for__0____1: null
        }
      }
    })

    // Divergence: Python instantiates a child model during _propagate, which registers
    // `case` with the source as a side effect. The port only reaches for children that
    // already exist, so an untouched Case never registers.
    assert.deepEqual(uniques(), {
      simple: {
        name: {
          1: '{"name":"sure"}',
          2: '{"name":"ya"}'
        }
      },
      plain: {
        'simple_id-name': {
          1: '{"name":"fine","simple_id":1}'
        }
      },
      meta: {
        name: {
          1: '{"name":"yep"}',
          2: '{"name":"nope"}'
        }
      }
    })

    await rejects(
      () => new Simple('sure').create(),
      ModelError,
      'simple: value {"name":"sure"} violates unique name'
    )

    // Python passes _bulk through the constructor; the port has no such keyword.
    const sis = new Sis('Sally', { bro_id: [2, 3, 4] })
    sis._bulk = true

    await rejects(() => sis.create(), ModelError, 'cannot create ties in bulk')
  })

  it('test_model_like', async () => {
    await new Unit([['stuff'], ['people']]).create()

    const unit = Unit.one({ like: 'p' })

    assert.deepEqual(await source.modelLike(unit), [{ id: 2, name: 'people' }])

    await unit.retrieve()

    unit.test.add('things')
    await unit.update()

    const test = Test.many({ like: 'p' })

    assert.deepEqual(await source.modelLike(test), [{ id: 1, unit_id: 2, name: 'things' }])
    assert.equal(test.overflow, false)

    // Python passes _chunk through the constructor; the port has no such keyword.
    const chunked = Test.many({ like: 'p' })
    chunked._chunk = 1

    assert.deepEqual(await source.modelLike(chunked), [{ id: 1, unit_id: 2, name: 'things' }])
    assert.equal(chunked.overflow, true)
  })

  it('test_model_sort', async () => {
    const unit = await new Unit([['stuff'], ['people'], ['things']]).create()

    MockSource.modelSort(unit)
    assert.deepEqual(unit.name, ['people', 'stuff', 'things'])

    unit._sort = ['-id']
    MockSource.modelSort(unit)
    assert.deepEqual(unit.name, ['things', 'people', 'stuff'])
    assert.equal(unit._sort, null)
  })

  it('test_model_limit', () => {
    const unit = Unit.many()

    unit._models = [1, 2, 3] as any
    MockSource.modelLimit(unit)
    assert.deepEqual(unit._models, [1, 2, 3])
    assert.equal(unit.overflow, false)

    unit._models = [1, 2, 3] as any
    unit._limit = 4
    unit._offset = 0
    MockSource.modelLimit(unit)
    assert.deepEqual(unit._models, [1, 2, 3])
    assert.equal(unit.overflow, false)

    unit._models = [1, 2, 3] as any
    unit._limit = 2
    MockSource.modelLimit(unit)
    assert.deepEqual(unit._models, [1, 2])
    assert.equal(unit.overflow, true)

    unit._models = [1, 2, 3] as any
    unit._offset = 1
    MockSource.modelLimit(unit)
    assert.deepEqual(unit._models, [2, 3])
    assert.equal(unit.overflow, true)
  })

  it('test_count_query', () => {
    assert.equal(source.countQuery(null as any).action, 'COUNT')
  })

  it('test_count', async () => {
    await new Unit([['stuff'], ['people']]).create()

    assert.equal(await Unit.many().count(), 2)
    assert.equal(await Unit.many({ name: 'people' }).count(), 1)
    assert.equal(await Unit.many({ like: 'p' }).count(), 1)

    const tom = await new Bro('Tom').create()
    await new Sis('Sally', { bro_id: [tom.id] }).create()
    await new Sis('Mary').create()

    assert.equal(await Sis.many({ bro_id: [tom.id] }).count(), 1)
    assert.equal(await Sis.many({ bro_id: [999] }).count(), 0)
  })

  it('test_retrieve_query', () => {
    assert.equal(source.retrieveQuery(null as any).action, 'RETRIEVE')
  })

  it('test_retrieve', async () => {
    await new Unit([['stuff'], ['people']]).create()

    await rejects(
      () => Unit.one({ name__in: ['people', 'stuff'] }).retrieve(),
      ModelError,
      'unit: more than one retrieved'
    )

    const missing = Unit.one({ name: 'things' })

    await rejects(() => missing.retrieve(), ModelError, 'unit: none retrieved')

    assert.equal(await missing.retrieve(false), null)

    const unit = (await Unit.one({ name: 'people' }).retrieve())!

    assert.equal(unit.id, 2)
    assert.equal(unit._action, 'update')
    assert.equal((unit._record as any)._action, 'update')

    assert.equal((await Unit.many({ name: 'people' }).limit(1).retrieve())!.overflow, true)
    assert.equal((await Unit.many({ name: 'people' }).limit(2).retrieve())!.overflow, false)

    unit.test.add('things')[0].case.add('persons')
    await unit.update()

    // Python: Meta("yep", True, 1.1, {"tom"}, [1, None], {"a": 1}) - a trailing positional
    // dict is indistinguishable from named values in JS, so `things` has to be named here.
    await new Meta({
      name: 'yep',
      flag: true,
      spend: 1.1,
      people: new Set(['tom']),
      stuff: [1, null],
      things: { a: 1 }
    }).create()

    const meta = (await Meta.one({ name: 'yep' }).retrieve())!

    assert.equal(meta.flag, true)
    assert.equal(meta.spend, 1.1)
    assert.deepEqual(meta.people, new Set(['tom']))
    assert.deepEqual(meta.stuff, [1, { 'relations.io': { '1': null } }])
    assert.deepEqual(meta.things, { a: 1 })

    assert.deepEqual((await Unit.many().retrieve())!.name, ['people', 'stuff'])
    assert.deepEqual((await Unit.many().sort('-name').limit(1).retrieve())!.name, ['stuff'])
    assert.deepEqual((await Unit.many().sort('-name').limit(0).retrieve())!.name, [])

    assert.deepEqual((await Unit.many({ like: 'p' }).retrieve())!.name, ['people'])

    const liked = (await Test.many({ like: 'p' }).retrieve())!
    assert.deepEqual(liked.name, ['things'])
    assert.equal(liked.overflow, false)

    const chunked = Test.many({ like: 'p' })
    chunked._chunk = 1
    await chunked.retrieve()
    assert.deepEqual(chunked.name, ['things'])
    assert.equal(chunked.overflow, true)

    await new Meta({
      name: 'dive',
      people: new Set(['tom', 'mary']),
      stuff: [1, 2, 3, null],
      things: { a: { b: [1, 2], c: 'sure' }, '4': 5, for: [{ '1': 'yep' }] }
    }).create()

    const metas = async (criteria: any) => (await Meta.many(criteria).retrieve())!

    assert.equal((await metas({ people: new Set(['tom', 'mary']) }))[0].name, 'dive')
    assert.equal((await metas({ stuff: [1, 2, 3, { 'relations.io': { '1': null } }] }))[0].name, 'dive')
    assert.equal(
      (await metas({ stuff__not_in: [1, [1, 2, 3, { 'relations.io': { '1': null } }]] }))[0].name,
      'yep'
    )

    const dived = { a: { b: [1, 2], c: 'sure' }, '4': 5, for: [{ '1': 'yep' }] }

    assert.equal((await metas({ things: dived }))[0].name, 'dive')
    assert.equal((await metas({ things__in: dived }))[0].name, 'dive')
    assert.equal((await metas({ things__not_in: dived }))[0].name, 'yep')

    assert.equal((await metas({ stuff__1: 2 }))[0].name, 'dive')
    assert.equal((await metas({ things__a__b__0: 1 }))[0].name, 'dive')
    assert.equal((await metas({ things__a__c__like: 'su' }))[0].name, 'dive')
    assert.equal((await metas({ things__a__d__null: true }))[0].name, 'dive')
    assert.equal((await metas({ things____4: 5 }))[0].name, 'dive')

    assert.equal((await metas({ things__a__b__0__gt: 1 })).size, 0)
    assert.equal((await metas({ things__a__c__notlike: 'su' })).size, 0)
    assert.equal((await metas({ things__a__d__null: false })).size, 0)
    assert.equal((await metas({ things___4: 6 })).size, 0)

    assert.equal((await metas({ things__a__b__has: 1 })).size, 1)
    assert.equal((await metas({ things__a__b__has: 3 })).size, 0)
    assert.equal((await metas({ things__a__b__any: [1, 3] })).size, 1)
    assert.equal((await metas({ things__a__b__any: [4, 3] })).size, 0)
    assert.equal((await metas({ things__a__b__all: [2, 1] })).size, 1)
    assert.equal((await metas({ things__a__b__all: [3, 2, 1] })).size, 0)

    assert.equal((await metas({ people__has: 'mary' })).size, 1)
    assert.equal((await metas({ people__has: 'dick' })).size, 0)
    assert.equal((await metas({ people__any: ['mary', 'dick'] })).size, 1)
    assert.equal((await metas({ people__any: ['harry', 'dick'] })).size, 0)
    assert.equal((await metas({ people__all: ['mary', 'tom'] })).size, 1)
    assert.equal((await metas({ people__all: ['tom', 'dick', 'mary'] })).size, 0)

    await new Net({ ip: '1.2.3.4', subnet: '1.2.3.0/24' }).create()
    await new Net().create()

    const nets = async (criteria: any) => (await Net.many(criteria).retrieve())!

    assert.equal((await nets({ like: '1.2.3.' }))[0].ip.compressed, '1.2.3.4')
    assert.equal((await nets({ ip__address__like: '1.2.3.' }))[0].ip.compressed, '1.2.3.4')
    assert.equal((await nets({ ip__value__gt: ipInt('1.2.3.0') }))[0].ip.compressed, '1.2.3.4')
    assert.equal((await nets({ subnet__address__like: '1.2.3.' }))[0].ip.compressed, '1.2.3.4')
    assert.equal((await nets({ subnet__min_value: ipInt('1.2.3.0') }))[0].ip.compressed, '1.2.3.4')

    assert.equal((await nets({ ip__address__notlike: '1.2.3.' })).size, 0)
    assert.equal((await nets({ ip__value__lt: ipInt('1.2.3.0') })).size, 0)
    assert.equal((await nets({ subnet__address__notlike: '1.2.3.' })).size, 0)
    assert.equal((await nets({ subnet__max_value: ipInt('1.2.3.0') })).size, 0)

    const tom = await new Bro('Tom').create()
    const dick = await new Bro('Dick').create()

    const dot = await new Sis('Dot').create()
    const nikki = await new Sis('Nikki').create()

    const mary = await new Sis('Mary', { bro_id: [tom.id, dick.id] }).create()
    const harry = await new Bro('Harry', { sis_id: [dot.id, nikki.id] }).create()

    assert.deepEqual((await mary.bro.retrieve()).id, [dick.id, tom.id])
    assert.deepEqual((await harry.sis.retrieve()).id, [dot.id, nikki.id])

    assert.equal((await Sis.many({ bro_id: [tom.id] }).retrieve())!.size, 1)
    assert.equal((await Sis.many({ bro_id: [tom.id] }).retrieve())![0].name, 'Mary')

    assert.equal((await Bro.many({ sis_id: [dot.id] }).retrieve())!.size, 1)
    assert.equal((await Bro.many({ sis_id: [dot.id] }).retrieve())![0].name, 'Harry')

    assert.equal((await Sis.many({ bro_id: [999] }).retrieve())!.size, 0)
  })

  it('test_retrieve_ties_query', async () => {
    const tom = await new Bro('Tom').create()
    const dick = await new Bro('Dick').create()
    const harry = await new Bro('Harry').create()

    await new Sis('Mary', { bro_id: [tom.id, dick.id] }).create()
    await new Sis('Sue', { bro_id: [tom.id] }).create()
    await new Sis('Ann', { bro_id: [dick.id, harry.id] }).create()

    const sisters = async (criteria: any) => (await Sis.many(criteria).retrieve())!
    const brothers = async (criteria: any) => (await Bro.many(criteria).retrieve())!

    // has: tied to that one brother
    assert.deepEqual([...(await sisters({ bro_id__has: tom.id })).name].sort(), ['Mary', 'Sue'])
    assert.deepEqual((await sisters({ bro_id__has: harry.id })).name, ['Ann'])
    assert.equal((await sisters({ bro_id__has: 999 })).size, 0)

    // any: tied to at least one of them
    assert.deepEqual([...(await sisters({ bro_id__any: [tom.id, harry.id] })).name].sort(), [
      'Ann',
      'Mary',
      'Sue'
    ])
    assert.deepEqual((await sisters({ bro_id__any: [harry.id] })).name, ['Ann'])
    assert.equal((await sisters({ bro_id__any: [999] })).size, 0)

    // all: tied to every one of them
    assert.deepEqual((await sisters({ bro_id__all: [tom.id, dick.id] })).name, ['Mary'])
    assert.deepEqual([...(await sisters({ bro_id__all: [dick.id] })).name].sort(), ['Ann', 'Mary'])
    assert.equal((await sisters({ bro_id__all: [tom.id, harry.id] })).size, 0)

    // all must de-dupe the requested list
    assert.deepEqual([...(await sisters({ bro_id__all: [dick.id, dick.id] })).name].sort(), ['Ann', 'Mary'])

    // negation
    assert.deepEqual((await sisters({ bro_id__not_has: tom.id })).name, ['Ann'])
    assert.deepEqual([...(await sisters({ bro_id__not_any: [harry.id] })).name].sort(), ['Mary', 'Sue'])

    // symmetric
    const jane = await new Sis('Jane').create()
    const joan = await new Sis('Joan').create()

    await new Bro('Bob', { sis_id: [jane.id, joan.id] }).create()
    await new Bro('Bill', { sis_id: [jane.id] }).create()

    assert.deepEqual([...(await brothers({ sis_id__has: jane.id })).name].sort(), ['Bill', 'Bob'])
    assert.deepEqual((await brothers({ sis_id__all: [jane.id, joan.id] })).name, ['Bob'])
    assert.deepEqual((await brothers({ sis_id__any: [joan.id] })).name, ['Bob'])
  })

  it('test_retrieve_ties_attr', async () => {
    const tom = await new Bro('Tom').create()
    const dick = await new Bro('Dick').create()
    const harry = await new Bro('Harry').create()

    await new Sis('Mary', { bro_id: [tom.id, dick.id] }).create()
    await new Sis('Sue', { bro_id: [tom.id] }).create()
    await new Sis('Ann', { bro_id: [dick.id, harry.id] }).create()

    const sisters = async (criteria: any) => (await Sis.many(criteria).retrieve())!
    const brothers = async (criteria: any) => (await Bro.many(criteria).retrieve())!

    assert.deepEqual([...(await sisters({ bro__name: 'Tom' })).name].sort(), ['Mary', 'Sue'])
    assert.deepEqual((await sisters({ bro__name: 'Harry' })).name, ['Ann'])
    assert.equal((await sisters({ bro__name: 'Ghost' })).size, 0)

    assert.deepEqual([...(await sisters({ bro__name__in: ['Tom', 'Harry'] })).name].sort(), [
      'Ann',
      'Mary',
      'Sue'
    ])
    assert.deepEqual((await sisters({ bro__name__like: 'arr' })).name, ['Ann'])

    assert.deepEqual([...(await sisters({ bro__name__not_in: ['Tom'] })).name].sort(), ['Ann', 'Mary'])

    assert.deepEqual((await sisters({ bro__name: 'Dick', bro__id: harry.id })).name, [])
    assert.deepEqual([...(await sisters({ bro__name: 'Dick', bro__id: dick.id })).name].sort(), [
      'Ann',
      'Mary'
    ])

    const jane = await new Sis('Jane').create()
    const joan = await new Sis('Joan').create()

    await new Bro('Bob', { sis_id: [jane.id, joan.id] }).create()
    await new Bro('Bill', { sis_id: [jane.id] }).create()

    assert.deepEqual([...(await brothers({ sis__name: 'Jane' })).name].sort(), ['Bill', 'Bob'])
    assert.deepEqual((await brothers({ sis__name__in: ['Joan'] })).name, ['Bob'])
  })

  it('test_titles_query', () => {
    assert.equal(source.titlesQuery(null as any).action, 'TITLES')
  })

  it('test_titles', async () => {
    const unit = await new Unit('people').create()
    await unit.test.add('stuff').add('things').create()

    const titles = await Unit.many().titles()

    assert.equal(titles.id, 'id')
    assert.deepEqual(titles.fields, ['name'])
    assert.deepEqual(titles.parents, {})
    assert.deepEqual(titles.format, ['fancy'])

    assert.deepEqual(titles.ids, [1])
    assert.deepEqual(titles.get(1), ['people'])

    const tests = await Test.many().titles()

    assert.equal(tests.id, 'id')
    assert.deepEqual(tests.fields, ['unit_id', 'name'])

    assert.equal(tests.parents['unit_id'].id, 'id')
    assert.deepEqual(tests.parents['unit_id'].fields, ['name'])
    assert.deepEqual(tests.parents['unit_id'].parents, {})
    assert.deepEqual(tests.parents['unit_id'].format, ['fancy'])

    assert.deepEqual(tests.format, ['fancy', 'shmancy'])

    assert.deepEqual(tests.ids, [1, 2])
    assert.deepEqual(tests.get(1), ['people', 'stuff'])
    assert.deepEqual(tests.get(2), ['people', 'things'])

    await new Net({ ip: '1.2.3.4', subnet: '1.2.3.0/24' }).create()

    assert.deepEqual((await Net.many().titles()).get(1), ['1.2.3.4'])

    const tom = await new Bro('Tom').create()
    await new Sis('Sally', { bro_id: [tom.id] }).create()

    assert.equal((await Sis.many({ bro_id: [tom.id] }).titles()).ids.length, 1)
  })

  it('test_update_query', () => {
    assert.equal(source.updateQuery(null as any).action, 'UPDATE')
  })

  it('test_update', async () => {
    await new Unit([['people'], ['stuff']]).create()

    assert.equal(await Unit.many({ id: 2 }).set({ name: 'things' }).update(), 1)

    await rejects(
      () => Unit.many({ id: 2 }).set({ name: 'people' }).update(),
      ModelError,
      'unit: value {"name":"people"} violates unique name'
    )

    const unit = (await Unit.one(2).retrieve())!

    unit.name = 'thing'
    unit.test.add('moar')

    assert.equal(await unit.update(), 1)
    assert.equal(unit.name, 'thing')
    assert.equal(unit.test[0].id, 1)
    assert.equal(unit.test[0].name, 'moar')

    await rejects(() => Plain.one().update(), ModelError, 'plain: nothing to update from')

    const again = (await Unit.one(2).retrieve())!
    again.name = 'people'

    await rejects(() => again.update(), ModelError, 'unit: value {"name":"people"} violates unique name')

    const ping = await new Net({ ip: '1.2.3.4', subnet: '1.2.3.0/24' }).create()
    const pong = await new Net({ ip: '5.6.7.8', subnet: '5.6.7.0/24' }).create()

    await Net.many().set({ subnet: '9.10.11.0/24' }).update()

    assert.equal((await Net.one(ping.id).retrieve())!.subnet.compressed, '9.10.11.0/24')
    assert.equal((await Net.one(pong.id).retrieve())!.subnet.compressed, '9.10.11.0/24')

    await (await Net.one(ping.id).retrieve())!.set({ ip: '13.14.15.16' }).update()

    assert.equal((await Net.one(ping.id).retrieve())!.ip.compressed, '13.14.15.16')
    assert.equal((await Net.one(pong.id).retrieve())!.ip.compressed, '5.6.7.8')

    await new Sis('Sally').create()
    const bro = await new Bro('Harry').create()

    await Sis.many({ name: 'Sally' }).set({ bro_id: [bro.id] }).update()

    const sis = (await Sis.one({ name: 'Sally' }).retrieve())!

    assert.deepEqual((await (await Bro.one({ name: 'Harry' }).retrieve())!.sis.retrieve()).id, [sis.id])

    const tom = await new Bro('Tom').create()
    const dick = await new Bro('Dick').create()

    const dot = await new Sis('Dot').create()
    const nikki = await new Sis('Nikki').create()

    tom.sis_id = [nikki.id, dot.id] as any
    dot.bro_id = [tom.id, dick.id] as any

    await tom.update()
    await dot.update()

    assert.deepEqual((await (await Bro.one({ name: 'Tom' }).retrieve())!.sis.retrieve()).id, [
      dot.id,
      nikki.id
    ])
    assert.deepEqual((await (await Sis.one({ name: 'Dot' }).retrieve())!.bro.retrieve()).id, [
      dick.id,
      tom.id
    ])
    assert.deepEqual((await (await Bro.one({ name: 'Dick' }).retrieve())!.sis.retrieve()).id, [dot.id])
    assert.deepEqual((await (await Sis.one({ name: 'Nikki' }).retrieve())!.bro.retrieve()).id, [tom.id])
  })

  it('test_delete_query', () => {
    assert.equal(source.deleteQuery(null as any).action, 'DELETE')
  })

  it('test_delete', async () => {
    const unit = new Unit('people')
    unit.test.add('stuff').add('things')
    await unit.create()

    assert.equal(await Test.one({ id: 2 }).delete(), 1)
    assert.equal((await Test.many().retrieve())!.size, 1)

    // Divergence: Python instantiates a child model during _propagate, which registers
    // `case` with the source as a side effect. The port only reaches for children that
    // already exist, so an untouched Case never registers.
    assert.deepEqual(uniques(), {
      unit: {
        name: {
          1: '{"name":"people"}'
        }
      },
      test: {
        'unit_id-name': {
          1: '{"name":"stuff","unit_id":1}'
        }
      },
    })

    assert.equal(await (await Unit.one(1).retrieve())!.test.delete(), 1)
    assert.equal(await (await Unit.one(1).retrieve())!.delete(), 1)
    assert.equal((await Unit.many().retrieve())!.size, 0)
    assert.equal((await Test.many().retrieve())!.size, 0)

    const plainly = await new Plain().create()

    await rejects(() => plainly.delete(), ModelError, 'plain: nothing to delete from')

    await new Sis('Sally').create()
    const bro = await new Bro('Harry').create()

    await Sis.many({ name: 'Sally' }).set({ bro_id: [bro.id] }).update()

    await Sis.many({ name: 'Sally' }).delete()

    assert.deepEqual((await (await Bro.one({ name: 'Harry' }).retrieve())!.sis.retrieve()).id, [])
    assert.equal(await SisBro.many().count(), 0)

    const tom = await new Bro('Tom').create()
    const dick = await new Bro('Dick').create()

    const dot = await new Sis('Dot').create()
    const nikki = await new Sis('Nikki').create()

    tom.sis_id = [nikki.id, dot.id] as any
    dot.bro_id = [tom.id, dick.id] as any

    await tom.update()
    await dot.update()

    await (await Bro.one({ name: 'Dick' }).retrieve())!.delete()
    await (await Sis.one({ name: 'Nikki' }).retrieve())!.delete()

    assert.deepEqual((await (await Bro.one({ name: 'Tom' }).retrieve())!.sis.retrieve()).id, [dot.id])
    assert.deepEqual((await (await Sis.one({ name: 'Dot' }).retrieve())!.bro.retrieve()).id, [tom.id])
    assert.equal(await SisBro.many().count(), 1)
  })

  it('test_definition', async () => {
    await withTemp(async (dir) => {
      await writeFile(join(dir, 'general.json'), JSON.stringify({ simple: Simple.thy().define() }))
      await mkdir(join(dir, 'sourced'), { recursive: true })

      await source.definition(join(dir, 'general.json'), join(dir, 'sourced'))

      assert.deepEqual(JSON.parse(await readFile(join(dir, 'sourced', 'general.json'), 'utf8')), [
        { ACTION: 'add', ...SIMPLE_DEFINITION }
      ])
    })
  })

  it('test_migration', async () => {
    await withTemp(async (dir) => {
      const migration = {
        add: { simple: Simple.thy().define() },
        remove: { simple: Simple.thy().define() },
        change: {
          migs: {
            definition: MIGS_DEFINITION,
            migration: MIGS_MIGRATION
          }
        }
      }

      await writeFile(join(dir, 'general.json'), JSON.stringify(migration))
      await mkdir(join(dir, 'sourced'), { recursive: true })

      await source.migration(join(dir, 'general.json'), join(dir, 'sourced'))

      assert.deepEqual(JSON.parse(await readFile(join(dir, 'sourced', 'general.json'), 'utf8')), [
        { ACTION: 'add', ...SIMPLE_DEFINITION },
        { ACTION: 'remove', ...SIMPLE_DEFINITION },
        MIGS_CHANGED
      ])
    })
  })

  it('test_execute', async () => {
    source.ids = {}
    source.data = {}

    const definition = {
      source: 'UnittestSource',
      name: 'simple',
      title: 'Simple',
      fields: [
        { name: 'id', kind: 'int', store: 'id', none: true, auto: true },
        { name: 'name', kind: 'str', store: 'name', none: false },
        { name: 'fie', store: 'fie', kind: 'int' },
        { name: 'foe', store: 'foe', kind: 'int' }
      ],
      id: 'id',
      unique: { name: ['name'] },
      index: {}
    }

    await source.execute({ ACTION: 'add', ...definition })

    assert.deepEqual(source.ids, { simple: 0 })
    assert.deepEqual(plain(), { simple: {} })

    await source.execute({ ACTION: 'remove', ...definition })

    assert.deepEqual(source.ids, {})
    assert.deepEqual(plain(), {})

    source.ids = { simples: 2 }
    source.data = {
      simples: new Map<number, any>([
        [1, { id: 1, name: 'one', fie: 3, foe: 4 }],
        [2, { id: 2, name: 'two', fie: 5, foe: 6 }]
      ])
    }

    await source.execute({
      ACTION: 'change',
      DEFINITION: {
        source: 'UnittestSource',
        name: 'simples',
        fields: definition.fields
      },
      MIGRATION: {
        source: 'UnittestSource',
        name: 'simple',
        fields: [
          { ACTION: 'add', name: 'fee', store: 'fee', kind: 'int' },
          { ACTION: 'remove', name: 'fie', store: 'fie', kind: 'int' },
          {
            ACTION: 'change',
            DEFINITION: { name: 'foe', store: 'foe', kind: 'int' },
            MIGRATION: { name: 'fum', store: 'fum', kind: 'float' }
          }
        ]
      }
    })

    assert.deepEqual(source.ids, { simple: 2 })
    assert.deepEqual(plain(), {
      simple: {
        1: { id: 1, name: 'one', fee: null, fum: 4 },
        2: { id: 2, name: 'two', fee: null, fum: 6 }
      }
    })
  })

  it('test_load', async () => {
    await withTemp(async (dir) => {
      source.ids = {}
      source.data = {}

      const migrations = new Migrations(join(dir, 'ddl'))

      await migrations.generate([Unit as any])
      await migrations.convert(source.name)

      await source.load(join(dir, 'ddl', source.name, String(source.KIND), 'definition.json'))

      assert.equal(await Unit.many().count(), 0)
    })
  })

  it('test_list', async () => {
    await withTemp(async (dir) => {
      const path = join(dir, 'ddl', source.name, String(source.KIND))

      await mkdir(path, { recursive: true })

      for (const file of [
        'definition.json',
        'definition-2012-07-07.json',
        'migration-2012-07-07.json',
        'definition-2012-07-08.json',
        'migration-2012-07-08.json'
      ]) {
        await writeFile(join(path, file), '')
      }

      assert.deepEqual(await source.list(path), {
        '2012-07-07': {
          definition: 'definition-2012-07-07.json',
          migration: 'migration-2012-07-07.json'
        },
        '2012-07-08': {
          definition: 'definition-2012-07-08.json',
          migration: 'migration-2012-07-08.json'
        }
      })
    })
  })

  it('test_migrate', async () => {
    await withTemp(async (dir) => {
      source.ids = {}
      source.data = {}

      const migrations = new Migrations(join(dir, 'ddl'))
      const path = join(dir, 'ddl', source.name, String(source.KIND))

      await migrations.generate([Unit as any])
      await migrations.generate([Unit as any, Test as any])
      await migrations.convert(source.name)

      assert.equal(await source.migrate(path), true)

      assert.equal(await Unit.many().count(), 0)
      assert.equal(await Test.many().count(), 0)

      assert.equal(await source.migrate(path), false)

      await migrations.generate([Unit as any, Test as any, Case as any])
      await migrations.convert(source.name)

      assert.equal(await source.migrate(path), true)

      assert.equal(await Case.many().count(), 0)

      assert.equal(await source.migrate(path), false)
    })
  })
})

// =========================================================================== TestSource (base)

describe('Source', () => {
  let base: Source
  let mock: MockSource

  beforeEach(() => {
    clear()
    base = new Source('unittest')
    mock = new MockSource('UnittestSource')
  })

  it('test___new__', () => {
    const reversed = new Source('testunit', { reverse: true })

    assert.equal(registeredSource('testunit'), reversed)
    assert.equal(reversed.reverse, true)
  })

  it('test_ensure_attribute', () => {
    const item: any = {}

    item.already = false

    base.ensureAttribute(item, 'already', true)
    assert.equal(item.already, false)

    base.ensureAttribute(item, 'nothing')
    assert.equal(item.nothing, null)

    base.ensureAttribute(item, 'something', true)
    assert.equal(item.something, true)
  })

  it('test_field_init', () => {
    base.fieldInit(null as any)
  })

  it('test_record_init', () => {
    const calls: any[] = []
    base.fieldInit = (field: any) => {
      calls.push(field)
    }

    const record: any = {}
    record._order = [record]

    base.recordInit(record)

    assert.deepEqual(calls, [record])
  })

  it('test_init', () => {
    const calls: any[] = []
    base.fieldInit = (field: any) => {
      calls.push(field)
    }

    const record: any = {}
    record._order = [record]
    record._fields = record

    base.init(record)

    assert.deepEqual(calls, [record])
  })

  it('test_field_define', () => {
    base.fieldDefine(null as any)
  })

  it('test_record_define', () => {
    const calls: any[] = []
    base.fieldDefine = (field: any) => {
      calls.push(field)
    }

    base.recordDefine([{}])

    assert.deepEqual(calls, [{}])
  })

  it('test_define', () => {
    base.define(null as any)
  })

  it('test_field_add', () => {
    base.fieldAdd(null as any)
  })

  it('test_field_remove', () => {
    base.fieldRemove(null as any)
  })

  it('test_field_change', () => {
    base.fieldChange(null as any, null as any)
  })

  it('test_record_change', () => {
    const added: any[] = []
    const removed: any[] = []
    const changed: any[][] = []

    base.fieldAdd = (field: any) => {
      added.push(field)
    }
    base.fieldRemove = (field: any) => {
      removed.push(field)
    }
    base.fieldChange = (definition: any, migration: any) => {
      changed.push([definition, migration])
    }

    const record = [{ name: 'fie' }, { name: 'foe' }]

    const migration = {
      add: [{ name: 'fee' }],
      remove: ['fie'],
      change: { foe: { name: 'fum' } }
    }

    base.recordChange(record, migration)

    assert.deepEqual(added, [{ name: 'fee' }])
    assert.deepEqual(removed, [{ name: 'fie' }])
    assert.deepEqual(changed, [[{ name: 'foe' }, { name: 'fum' }]])
  })

  it('test_model_add', () => {
    base.modelAdd(null as any)
  })

  it('test_model_remove', () => {
    base.modelRemove(null as any)
  })

  it('test_model_change', () => {
    base.modelChange(null as any, null as any)
  })

  it('test_create_field', () => {
    base.createField(null as any)
  })

  it('test_create_record', () => {
    const calls: any[] = []
    base.createField = (field: any) => {
      calls.push(field)
    }

    const record: any = {}
    record._order = [record]

    base.createRecord(record)

    assert.deepEqual(calls, [record])
  })

  it('test_create_query', () => {
    base.createQuery(null as any)
  })

  it('test_has_ties', async () => {
    const sis = await new Sis('Sally').create()

    assert.equal(Source.hasTies(sis), false)
    sis.bro_id = [2, 3, 4] as any
    assert.equal(Source.hasTies(sis), true)
    assert.equal(Source.hasTies(sis, {}), false)

    const bro = await new Bro('Tom').create()

    assert.equal(Source.hasTies(bro), false)
    bro.sis_id = [5, 6, 7] as any
    assert.equal(Source.hasTies(bro), true)
    assert.equal(Source.hasTies(bro, {}), false)
  })

  it('test_create_ties', async () => {
    const sis = await new Sis('Sally').create()
    await Source.createTies(sis, { id: 0 })
    sis.bro_id = [2, 3, 4] as any
    await Source.createTies(sis)

    const bro = await new Bro('Tom').create()
    await Source.createTies(bro, { id: 0 })
    bro.sis_id = [5, 6, 7] as any
    await Source.createTies(bro)

    assert.deepEqual(plain(mock), {
      sis: {
        1: { id: 1, name: 'Sally' }
      },
      bro: {
        1: { id: 1, name: 'Tom' }
      },
      sis_bro: {
        1: { bro_id: 2, sis_id: 1 },
        2: { bro_id: 3, sis_id: 1 },
        3: { bro_id: 4, sis_id: 1 },
        4: { bro_id: 1, sis_id: 5 },
        5: { bro_id: 1, sis_id: 6 },
        6: { bro_id: 1, sis_id: 7 }
      }
    })
  })

  it('test_create', async () => {
    const sis = new Sis('Sally')
    sis.bro_id = [2, 3, 4] as any

    await base.create(sis)

    sis._bulk = true

    await rejects(() => base.create(sis), ModelError, 'cannot create ties in bulk')
  })

  it('test_retrieve_field', () => {
    base.retrieveField(null as any)
  })

  it('test_retrieve_record', () => {
    const calls: any[] = []
    base.retrieveField = (field: any) => {
      calls.push(field)
    }

    const record: any = {}
    record._order = [record]

    base.retrieveRecord(record)

    assert.deepEqual(calls, [record])
  })

  it('test_count_query', () => {
    base.countQuery(null as any)
  })

  it('test_count', async () => {
    await base.count(Sis.many())
    await base.count(Sis.many({ bro_id: [2, 3, 4] }))
  })

  it('test_retrieve_query', () => {
    base.retrieveQuery(null as any)
  })

  it('test_collate_ties', async () => {
    const tom = await new Bro('Tom').create()
    const dick = await new Bro('Dick').create()

    await new Sis('Sally', { bro_id: [tom.id, dick.id] }).create()

    // criteria cleared after collation
    const sis = Sis.many({ bro_id: [tom.id] })
    assert.ok(Object.keys(sis._record!.field('bro_id')!.criteria ?? {}).length > 0)
    await Source.collateTies(sis)
    assert.deepEqual(sis._record!.field('bro_id')!.criteria, {})

    const bro = Bro.many({ sis_id: [1] })
    assert.ok(Object.keys(bro._record!.field('sis_id')!.criteria ?? {}).length > 0)
    await Source.collateTies(bro)
    assert.deepEqual(bro._record!.field('sis_id')!.criteria, {})

    // no criteria - nothing changes
    const bare = Sis.many()
    await Source.collateTies(bare)
    assert.equal(bare._record!.field('id')!.criteria, null)

    // sibling-attribute criteria captured per relation on _ties, consumed into an id filter
    const attrs = Sis.many({ bro__name: 'Tom' })
    assert.deepEqual(attrs._ties, { bro: { name: 'Tom' } })
    await Source.collateTies(attrs)
    assert.deepEqual(attrs._ties, {})
    assert.deepEqual(attrs._record!.field('id')!.criteria!['in'], [1])
  })

  it('test_attr_ids', async () => {
    const tom = await new Bro('Tom').create()
    const dick = await new Bro('Dick').create()

    await new Sis('Mary', { bro_id: [tom.id, dick.id] }).create()
    await new Sis('Sue', { bro_id: [tom.id] }).create()

    const relation = (Sis as any).BROTHERS['bro']

    assert.deepEqual(await Source.attrIds(relation, 'brother', { name: 'Tom' }), new Set([1, 2]))
    assert.deepEqual(await Source.attrIds(relation, 'brother', { name__in: ['Dick'] }), new Set([1]))
    assert.deepEqual(
      await Source.attrIds(relation, 'brother', { name: 'Tom', id: dick.id }),
      new Set()
    )
    assert.deepEqual(await Source.attrIds(relation, 'brother', { name: 'Ghost' }), new Set())
  })

  it('test_retrieve_ties', async () => {
    const tom = await new Bro('Tom').create()
    const dick = await new Bro('Dick').create()

    await new Sis('Sally', { bro_id: [tom.id, dick.id] }).create()

    const mary = await new Sis('Mary').create()
    const sue = await new Sis('Sure').create()

    await new Bro('Harry', { sis_id: [mary.id, sue.id] }).create()

    const sally = (await Sis.one({ name: 'Sally' }).retrieve())!
    const harry = (await Bro.one({ name: 'Harry' }).retrieve())!

    assert.deepEqual(sally.bro_id, new Set([tom.id, dick.id]))
    assert.deepEqual(harry.sis_id, new Set([mary.id, sue.id]))
  })

  it('test_retrieve', async () => {
    await base.retrieve(Sis.many())
    await base.retrieve(Sis.many({ bro_id: [2, 3, 4] }))
  })

  it('test_titles_query', () => {
    base.titlesQuery(null as any)
  })

  it('test_titles', async () => {
    await base.titles(Sis.many())
    await base.titles(Sis.many({ bro_id: [2, 3, 4] }))
  })

  it('test_update_field', () => {
    base.updateField(null as any)
  })

  it('test_update_record', () => {
    const calls: any[] = []
    base.updateField = (field: any) => {
      calls.push(field)
    }

    const record: any = {}
    record._order = [record]

    base.updateRecord(record)

    assert.deepEqual(calls, [record])
  })

  it('test_field_mass', () => {
    base.fieldMass(null as any)
  })

  it('test_record_mass', () => {
    const calls: any[] = []
    base.fieldMass = (field: any) => {
      calls.push(field)
    }

    const record: any = {}
    record._order = [record]

    base.recordMass(record)

    assert.deepEqual(calls, [record])
  })

  it('test_update_query', () => {
    base.updateQuery(null as any)
  })

  it('test_update', async () => {
    const sis = await new Sis('Sally').create()
    sis.name = 'Sue'

    await base.update(sis)
  })

  it('test_delete_field', () => {
    base.deleteField(null as any)
  })

  it('test_delete_record', () => {
    const calls: any[] = []
    base.deleteField = (field: any) => {
      calls.push(field)
    }

    const record: any = {}
    record._order = [record]

    base.deleteRecord(record)

    assert.deepEqual(calls, [record])
  })

  it('test_delete_query', () => {
    base.deleteQuery(null as any)
  })

  it('test_delete_ties', async () => {
    await new Sis('Sally', { bro_id: [2, 3, 4] }).create()
    await new Bro('Tom', { sis_id: [5, 6, 7] }).create()

    await (await Sis.many().retrieve())!.delete()

    assert.deepEqual(plain(mock), {
      sis: {},
      bro: {
        1: { id: 1, name: 'Tom' }
      },
      sis_bro: {
        4: { bro_id: 1, sis_id: 5 },
        5: { bro_id: 1, sis_id: 6 },
        6: { bro_id: 1, sis_id: 7 }
      }
    })

    await (await Bro.many().retrieve())!.delete()

    assert.deepEqual(plain(mock), {
      sis: {},
      bro: {},
      sis_bro: {}
    })
  })

  it('test_definition', async () => {
    await base.definition(null as any, null as any)
  })

  it('test_migration', async () => {
    await base.migration(null as any, null as any)
  })

  it('test_execute', async () => {
    await base.execute(null)
  })

  it('test_list', async () => {
    await base.list(null as any)
  })

  it('test_load', async () => {
    await base.load(null as any)
  })

  it('test_migrate', async () => {
    await base.migrate(null as any)
  })
})
