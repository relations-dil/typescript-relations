/**
 * Port of test/test_relations/test_relation.py and test/test_relations/test_titles.py
 * to node:test.
 *
 * Translation notes:
 *
 * - `relations.Relation.relative_field(model, relative)` reads the relation class's
 *   `SAME` off `cls`. The TS port makes it an explicit third argument, so every call
 *   here passes the SAME of the class Python would have used.
 * - Relation constructors take an options object instead of positional arguments, and
 *   every property is camelCase.
 * - `Titles` is built asynchronously (`Titles.build(model)` / `await model.titles()`)
 *   because a title that points at a parent has to fetch the parent's titles. Python's
 *   `Titles(Model.many())` relied on lazy retrieve, which the port doesn't have, so the
 *   model is retrieved explicitly first where the parent lookup needs it.
 * - `titles.titles` is a Map, `len()` is `.size`, `titles[id]` is `.get(id)` / `.set(id)`,
 *   `del titles[id]` is `.delete(id)`.
 * - Python leans on `ipaddress.IPv4Address` / `IPv4Network` for a non-builtin field kind.
 *   There is no such thing in the JS standard library, so minimal equivalents with the
 *   surface the tests touch are defined below (same approach as ported-field.test.ts).
 */

import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  Field,
  ManyToMany,
  MockSource,
  Model,
  ModelError,
  OneTo,
  OneToMany,
  OneToOne,
  Relation,
  Titles,
  bool,
  clear,
  dict,
  fields,
  int,
  list,
  set,
  str
} from '../src/index.js'

// --------------------------------------------------------------------------- ip helpers

class IPv4Address {
  readonly integer: number

  constructor(value: string | number | { address: string | number } | IPv4Address) {
    let address: any = value

    if (address instanceof IPv4Address) {
      address = address.integer
    } else if (address !== null && typeof address === 'object') {
      address = address.address
    }

    if (typeof address === 'number') {
      if (!Number.isInteger(address) || address < 0 || address > 4294967295) {
        throw new Error(`${address} does not appear to be an IPv4 address`)
      }
      this.integer = address
      return
    }

    if (typeof address !== 'string') {
      throw new Error(`${String(address)} does not appear to be an IPv4 address`)
    }

    const octets = address.split('.')

    if (octets.length !== 4) {
      throw new Error(`${address} does not appear to be an IPv4 address`)
    }

    let total = 0

    for (const octet of octets) {
      if (!/^\d{1,3}$/.test(octet) || Number(octet) > 255) {
        throw new Error(`${address} does not appear to be an IPv4 address`)
      }
      total = total * 256 + Number(octet)
    }

    this.integer = total
  }

  get compressed(): string {
    return [24, 16, 8, 0].map((shift) => Math.floor(this.integer / 2 ** shift) % 256).join('.')
  }

  __int__(): number {
    return this.integer
  }

  toString(): string {
    return this.compressed
  }
}

class IPv4Network {
  readonly network: number
  readonly prefix: number

  constructor(value: string | { address: string } | IPv4Network) {
    let address: any = value

    if (address instanceof IPv4Network) {
      address = address.compressed
    } else if (address !== null && typeof address === 'object') {
      address = address.address
    }

    if (typeof address !== 'string') {
      throw new Error(`${String(address)} does not appear to be an IPv4 network`)
    }

    const [base, bits] = address.split('/')

    this.prefix = bits === undefined ? 32 : Number(bits)

    if (!Number.isInteger(this.prefix) || this.prefix < 0 || this.prefix > 32) {
      throw new Error(`${address} does not appear to be an IPv4 network`)
    }

    const size = 2 ** (32 - this.prefix)
    const integer = new IPv4Address(base).integer

    this.network = integer - (integer % size)
  }

  get size(): number {
    return 2 ** (32 - this.prefix)
  }

  get compressed(): string {
    return `${new IPv4Address(this.network).compressed}/${this.prefix}`
  }

  at(index: number): IPv4Address {
    return new IPv4Address(this.network + (index < 0 ? this.size + index : index))
  }

  toString(): string {
    return this.compressed
  }
}

// =========================================================================== test_relation

describe('Relation (ported)', () => {
  it('finds the relative field', () => {
    class TestUnit extends fields({ id: int, name: str, ident: int }, Model) {}

    class Test extends fields({ ident: int, unit_id: int, name: str }, Model) {}

    class Unit extends fields({ id: int, test_unit_id: int, test_ident: int, name: str }, Model) {}

    class Equal extends Relation {
      static SAME = true
    }

    class Unequal extends Relation {
      static SAME = false
    }

    const testunit = TestUnit.thy()
    const test = Test.thy()
    const unit = Unit.thy()

    assert.equal(Relation.relativeField(testunit, unit, Relation.SAME), 'test_unit_id')
    assert.equal(Relation.relativeField(test, unit, Relation.SAME), 'test_ident')
    assert.equal(Relation.relativeField(test, testunit, Relation.SAME), 'ident')
    assert.equal(Equal.relativeField(unit, testunit, Equal.SAME), 'id')

    assert.throws(
      () => Unequal.relativeField(unit, testunit, Unequal.SAME),
      (error: unknown) => {
        assert.ok(error instanceof ModelError, `expected ModelError, got ${String(error)}`)
        assert.match((error as Error).message, /cannot determine field for unit in test_unit/)
        return true
      }
    )
  })
})

describe('OneTo (ported)', () => {
  it('works out both sides', () => {
    class Mom extends fields({ id: int, name: str, ident: int }, Model) {}

    class Son extends fields({ id: int, mom_id: int, name: str, mom_ident: int }, Model) {}

    let relation = new OneTo(Mom as any, Son as any)

    assert.equal(relation.Parent, Mom as any)
    assert.equal(relation.Child, Son as any)

    assert.equal(relation.parentChildAttr, 'son')
    assert.equal(relation.childParentAttr, 'mom')
    assert.equal(relation.parentId, 'id')
    assert.equal(relation.childParentRef, 'mom_id')

    relation = new OneTo(Mom as any, Son as any, {
      parentChildAttr: 'sons',
      childParentAttr: 'mommy',
      parentId: 'ident',
      childParentRef: 'mom_ident'
    })

    assert.equal(relation.parentChildAttr, 'sons')
    assert.equal(relation.childParentAttr, 'mommy')
    assert.equal(relation.parentId, 'ident')
    assert.equal(relation.childParentRef, 'mom_ident')
    assert.equal(relation.childInject, null)
  })

  it('injects the parent id into a dict field of the child', () => {
    class Mom extends fields({ id: int, ident: int, name: str }, Model) {}
    class Daughter extends fields({ id: int, name: str, what: dict }, Model) {}

    let relation = new OneTo(Mom as any, Daughter as any, { childInject: 'what' })

    assert.equal(relation.parentChildAttr, 'daughter')
    assert.equal(relation.childParentAttr, 'mom')
    assert.equal(relation.parentId, 'id')
    assert.equal(relation.childParentRef, 'mom_id')
    assert.equal(relation.childInject, 'what')

    let names: any = (Daughter as any).thy()._fields._names

    assert.equal(names.get('mom_id').kind, int)
    assert.equal(names.get('mom_id').inject, 'what__relations__mom__id')
    assert.equal(names.get('mom_id').none, true)
    assert.equal(names.get('what').extract, null)

    assert.ok('mom' in (Daughter as any).PARENTS)
    assert.ok('daughter' in (Mom as any).CHILDREN)

    assert.equal((new Daughter({ name: 'kid', mom_id: 7 } as any) as any).mom_id, 7)
    assert.equal((new Daughter({ name: 'loner' } as any) as any).mom_id, null)

    // Another parent goes into the same dict field

    class Dad extends fields({ id: int, name: str }, Model) {}

    new OneTo(Dad as any, Daughter as any, { childInject: 'what' })

    names = (Daughter as any).thy()._fields._names

    assert.equal(names.get('dad_id').inject, 'what__relations__dad__id')
    assert.equal(names.get('what').extract, null)

    // Overrides, and an existing extract is left alone

    class Twin extends fields({ id: int, name: str, data: new Field(dict, { extract: 'other' }) }, Model) {}

    relation = new OneTo(Mom as any, Twin as any, {
      parentChildAttr: 'twins',
      childParentAttr: 'mommy',
      parentId: 'ident',
      childParentRef: 'parent',
      childInject: 'data'
    })

    assert.equal(relation.parentChildAttr, 'twins')
    assert.equal(relation.childParentAttr, 'mommy')
    assert.equal(relation.parentId, 'ident')
    assert.equal(relation.childParentRef, 'parent')

    names = (Twin as any).thy()._fields._names

    assert.equal(names.get('parent').inject, 'data__relations__mom__ident')
    assert.deepEqual(names.get('data').extract, { other: str })

    // Same source is just model_id, different sources prefix the parent's source

    class Ally extends fields({ id: int, name: str }, Model) {
      static source = 'cumulus'
    }

    class Friend extends fields({ id: int, name: str }, Model) {
      static source = 'Bucket-App'
    }

    class Entity extends fields({ id: int, name: str, what: dict }, Model) {
      static source = 'cumulus'
    }

    relation = new OneTo(Ally as any, Entity as any, { childInject: 'what' })

    assert.equal(relation.childParentRef, 'ally_id')
    assert.equal((Entity as any).thy()._fields._names.get('ally_id').inject, 'what__relations__ally__id')

    relation = new OneTo(Friend as any, Entity as any, { childInject: 'what' })

    assert.equal(relation.childParentRef, 'bucket_app_friend_id')

    names = (Entity as any).thy()._fields._names

    assert.equal(names.get('bucket_app_friend_id').inject, 'what__relations__bucket_app_friend__id')
    assert.equal(names.get('what').extract, null)

    // Errors

    class Cousin extends fields({ id: int, name: str, mom_id: int, what: dict }, Model) {}
    class Orphan extends fields({ id: int, name: str }, Model) {}

    assert.throws(
      () => new OneTo(Mom as any, Cousin as any, { childInject: 'what' }),
      (error: any) => error instanceof ModelError && /field mom_id already exists in cousin/.test(error.message)
    )
    assert.throws(
      () => new OneTo(Mom as any, Orphan as any, { childInject: 'what' }),
      (error: any) => error instanceof ModelError && /cannot find field what in orphan/.test(error.message)
    )
    assert.throws(
      () => new OneTo(Mom as any, Orphan as any, { childInject: 'name' }),
      (error: any) => error instanceof ModelError && /field name not a dict in orphan/.test(error.message)
    )

    // Sources have to be dns compliant when they're used in a name

    for (const bad of [null, '', 'a_b', '-ab', 'ab-', 'a b', 'a.b', 'ab\n', 'a'.repeat(64)]) {
      class Stranger extends fields({ id: int, name: str }, Model) {
        static source = bad as any
      }

      class Local extends fields({ id: int, name: str, what: dict }, Model) {
        static source = 'cumulus'
      }

      assert.throws(
        () => new OneTo(Stranger as any, Local as any, { childInject: 'what' }),
        (error: any) =>
          error instanceof ModelError && error.message.includes(`stranger: source ${bad} is not dns compliant`)
      )
      assert.equal('stranger' in ((Local as any).PARENTS ?? {}), false)
    }

    class Fine extends fields({ id: int, name: str }, Model) {
      static source = 'a'.repeat(63)
    }

    class Home extends fields({ id: int, name: str, what: dict }, Model) {
      static source = 'cumulus'
    }

    assert.equal(new OneTo(Fine as any, Home as any, { childInject: 'what' }).childParentRef, `${'a'.repeat(63)}_fine_id`)
  })
})

describe('OneToMany (ported)', () => {
  it('works out both sides', () => {
    class Mom extends fields({ id: int, name: str }, Model) {}

    class Son extends fields({ id: int, mom_id: int, name: str }, Model) {}

    const relation = new OneToMany(Mom as any, Son as any)

    assert.equal(relation.Parent, Mom as any)
    assert.equal(relation.Child, Son as any)

    assert.equal(relation.parentChildAttr, 'son')
    assert.equal(relation.childParentAttr, 'mom')
    assert.equal(relation.parentId, 'id')
    assert.equal(relation.childParentRef, 'mom_id')
  })
})

describe('OneToOne (ported)', () => {
  it('works out both sides', () => {
    class Mom extends fields({ id: int, name: str }, Model) {}

    class Son extends fields({ id: int, name: str }, Model) {}

    const relation = new OneToOne(Mom as any, Son as any)

    assert.equal(relation.Parent, Mom as any)
    assert.equal(relation.Child, Son as any)

    assert.equal(relation.parentChildAttr, 'son')
    assert.equal(relation.childParentAttr, 'mom')
    assert.equal(relation.parentId, 'id')
    assert.equal(relation.childParentRef, 'id')
  })
})

describe('ManyToMany (ported)', () => {
  it('works out all three sides', () => {
    class Sis extends fields({ id: int, name: str, bro_id: set }, Model) {}

    class Bro extends fields({ id: int, name: str, sis_id: set }, Model) {}

    class SisBro extends fields({ bro_id: int, sis_id: int }, Model) {}

    const relation = new ManyToMany(Sis as any, Bro as any, SisBro as any)

    assert.equal(relation.Sister, Sis as any)
    assert.equal(relation.Brother, Bro as any)
    assert.equal(relation.Tie, SisBro as any)
    assert.equal(relation.Tie.TIE, true)

    assert.equal(relation.sisterBrotherRef, 'bro_id')
    assert.equal(relation.brotherSisterRef, 'sis_id')
    assert.equal(relation.sisterBrotherAttr, 'bro')
    assert.equal(relation.brotherSisterAttr, 'sis')
    assert.equal(relation.sisterId, 'id')
    assert.equal(relation.brotherId, 'id')
    assert.equal(relation.tieSisterRef, 'sis_id')
    assert.equal(relation.tieBrotherRef, 'bro_id')
  })

  it('takes everything spelled out', () => {
    class SisTie extends fields({ sis_id: int, name: str, bro_ident: set }, Model) {}

    class BroTie extends fields({ bro_id: int, name: str, sis_ident: set }, Model) {}

    class SisBroTie extends fields({ sist: int, brot: int }, Model) {
      static TIE = false
    }

    const relation = new ManyToMany(SisTie as any, BroTie as any, SisBroTie as any, {
      sisterBrotherAttr: 'bros',
      brotherSisterAttr: 'siss',
      sisterBrotherRef: 'bro_ident',
      brotherSisterRef: 'sis_ident',
      sisterId: 'sis_id',
      brotherId: 'bro_id',
      tieSisterRef: 'sist',
      tieBrotherRef: 'brot'
    })

    assert.equal(relation.Sister, SisTie as any)
    assert.equal(relation.Brother, BroTie as any)
    assert.equal(relation.Tie, SisBroTie as any)
    assert.equal(relation.Tie.TIE, false)

    assert.equal(relation.sisterBrotherRef, 'bro_ident')
    assert.equal(relation.brotherSisterRef, 'sis_ident')
    assert.equal(relation.sisterBrotherAttr, 'bros')
    assert.equal(relation.brotherSisterAttr, 'siss')
    assert.equal(relation.sisterId, 'sis_id')
    assert.equal(relation.brotherId, 'bro_id')
    assert.equal(relation.tieSisterRef, 'sist')
    assert.equal(relation.tieBrotherRef, 'brot')
  })
})

// ============================================================================ test_titles

class TitlesModel extends Model {
  static source = 'TestTitles'
}

class Unit extends fields({ id: int, name: { kind: str, format: 'fancy' } }, TitlesModel) {
  declare test: Test
}

class Test extends fields(
  { id: int, unit_id: int, name: { kind: str, format: 'shmancy' } },
  TitlesModel
) {
  declare unit: Unit
}

new OneToMany(Unit as any, Test as any)

class Meta extends fields({ id: int, name: str, flag: bool, stuff: list, things: dict }, TitlesModel) {
  static titles = 'things__a__b__0____1'
  static unique = false as const
}

function subnetAttr(values: globalThis.Record<string, any>, value: IPv4Network): void {
  values.address = String(value)

  const minIp = value.at(0)
  const maxIp = value.at(-1)

  values.min_address = String(minIp)
  values.min_value = minIp.integer
  values.max_address = String(maxIp)
  values.max_value = maxIp.integer
}

class Net extends fields(
  {
    id: int,
    name: str,
    ip: {
      kind: IPv4Address,
      attr: { compressed: 'address', __int__: 'value' },
      init: 'address',
      titles: 'address'
    },
    subnet: { kind: IPv4Network, attr: subnetAttr, init: 'address', titles: 'address' }
  },
  TitlesModel
) {
  static titles = ['ip', 'subnet__address']
  static unique = false as const
}

describe('Titles (ported)', () => {
  let titles: Titles

  beforeEach(async () => {
    clear()
    new MockSource('TestTitles')

    titles = await Titles.build(Unit.many() as any)
    titles.ids = [1, 2, 3]
    titles.titles = new Map<any, any>([
      [1, 'people'],
      [2, 'stuff'],
      [3, 'things']
    ])
  })

  it('builds id, fields, parents and format', async () => {
    const unit = await new Unit('people').create()
    unit.test.add('stuff').add('things')
    await unit.test.create()

    let built = await Unit.many().titles()

    assert.equal(built.id, 'id')
    assert.deepEqual(built.fields, ['name'])

    assert.deepEqual(built.parents, {})
    assert.deepEqual(built.format, ['fancy'])

    built = await Test.many().titles()

    assert.equal(built.id, 'id')
    assert.deepEqual(built.fields, ['unit_id', 'name'])

    assert.equal(built.parents['unit_id'].id, 'id')
    assert.deepEqual(built.parents['unit_id'].fields, ['name'])
    assert.deepEqual(built.parents['unit_id'].parents, {})
    assert.deepEqual(built.parents['unit_id'].format, ['fancy'])

    assert.deepEqual(built.format, ['fancy', 'shmancy'])

    built = await Meta.many().titles()
    assert.deepEqual(built.format, [null])

    built = await Net.many().titles()
    assert.deepEqual(built.format, [null, null])
  })

  it('counts', () => {
    assert.equal(titles.size, 3)
  })

  it('knows what it has', () => {
    assert.equal(titles.has(1), true)
  })

  it('iterates ids in order', () => {
    assert.deepEqual([...titles], [1, 2, 3])
  })

  it('sets by id', () => {
    titles.set(1, 'persons' as any)

    assert.deepEqual(titles.ids, [1, 2, 3])
    assert.equal(titles.get(1) as any, 'persons')

    titles.set(4, 'meta' as any)

    assert.deepEqual(titles.ids, [1, 2, 3, 4])
    assert.equal(titles.get(4) as any, 'meta')
  })

  it('gets by id', () => {
    assert.equal(titles.get(1) as any, 'people')
  })

  it('deletes by id', () => {
    titles.delete(2)

    assert.deepEqual(titles.ids, [1, 3])
    assert.deepEqual(
      [...titles.titles],
      [
        [1, 'people'],
        [3, 'things']
      ]
    )
  })

  it('adds a title from a model', async () => {
    let built = await Titles.build(Unit.many() as any)

    built.add((await new Unit('people').create()) as any)

    assert.deepEqual(built.ids, [1])
    assert.deepEqual([...built.titles], [[1, ['people']]])

    const people = (await Unit.one({ name: 'people' }).retrieve())!
    people.test.add('stuff')
    await people.test.create()

    // Python's `Titles(Test.many())` lazily retrieved; the port needs it explicit.
    const many = (await Test.many().retrieve())!

    built = await Titles.build(many as any)

    built.add((await new Test({ unit_id: 1, name: 'stuffs' }).create()) as any)
    built.add((await new Test({ unit_id: 2, name: 'things' }).create()) as any)

    assert.deepEqual(built.ids, [2, 3])
    assert.deepEqual(
      [...built.titles],
      [
        [2, ['people', 'stuffs']],
        [3, [null, 'things']]
      ]
    )

    built = await Titles.build(Meta.many() as any)
    built.add((await new Meta('special', { things: { a: { b: [{ '1': 'sure' }] } } }).create()) as any)
    built.add((await new Meta({ things: { a: { b: [{ '1': 'yep' }] } } }).create()) as any)
    built.add((await new Meta({ things: {} }).create()) as any)

    assert.deepEqual(built.ids, [1, 2, 3])
    assert.deepEqual(
      [...built.titles],
      [
        [1, ['sure']],
        [2, ['yep']],
        [3, [null]]
      ]
    )

    built = await Titles.build(Net.many() as any)
    built.add((await new Net('special', { ip: '1.2.3.4' }).create()) as any)
    built.add((await new Net('special', { subnet: '1.2.3.0/24' }).create()) as any)

    assert.deepEqual(built.ids, [1, 2])
    assert.deepEqual(
      [...built.titles],
      [
        [1, ['1.2.3.4', null]],
        [2, [null, '1.2.3.0/24']]
      ]
    )
  })
})
