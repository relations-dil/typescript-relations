/**
 * Ported from python-relations test/test_relations/test_model.py
 *
 * Translation notes (see the report for what these cost):
 *
 * - Python's UPPERCASE class config is lowercase statics here, and bare class attributes
 *   become a single `fields({...})` declaration.
 * - CRUD is async, and there is no lazy retrieve: every Python read that quietly hit the
 *   source needs an explicit `await model.retrieve()` first.
 * - Python's `_input`/`_build` take *args/**kwargs; here they take an array and an object.
 * - `len(model)` is `model.size`, `model._fields._names[x]` is `model._fields.field(x)`.
 */

import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  Field,
  FieldError,
  ManyToMany,
  MockSource,
  Model,
  ModelError,
  OneToMany,
  OneToOne,
  bool,
  clear,
  construct,
  dict,
  fields,
  float,
  int,
  list,
  set,
  str
} from '../src/index.js'
import { underscore } from '../src/util.js'

// --------------------------------------------------------------------------- helpers

/** Build a model the way Python's `Model(_read=..., _parent=..., ...)` does. */
function build(cls: any, internal: any): any {
  return construct(cls, internal)
}

function throwsModel(action: () => unknown, pattern?: RegExp): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ModelError, `expected ModelError, got ${String(error)}`)
    if (pattern !== undefined) {
      assert.match((error as Error).message, pattern)
    }
    return true
  })
}

async function rejectsModel(action: () => Promise<unknown>, pattern?: RegExp): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof ModelError, `expected ModelError, got ${String(error)}`)
    if (pattern !== undefined) {
      assert.match((error as Error).message, pattern)
    }
    return true
  })
}

function throwsField(action: () => unknown, pattern?: RegExp): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof FieldError, `expected FieldError, got ${String(error)}`)
    if (pattern !== undefined) {
      assert.match((error as Error).message, pattern)
    }
    return true
  })
}

/** Stand-in for Python's ipaddress.IPv4Address, as in the ported field/record suites. */
class IPv4Address {
  compressed: string

  constructor(value: any) {
    const address = typeof value === 'string' ? value : String(value?.address ?? value)
    const octets = address.split('.')

    if (octets.length !== 4 || octets.some((octet) => !/^\d+$/.test(octet) || Number(octet) > 255)) {
      throw new Error(`${address} does not appear to be an IPv4 address`)
    }

    this.compressed = octets.map((octet) => String(Number(octet))).join('.')
  }

  __int__(): number {
    return this.compressed.split('.').reduce((total, octet) => total * 256 + Number(octet), 0)
  }
}

// --------------------------------------------------------------------------- models

class Whoops extends fields({ id: int, name: str }) {}

class People extends fields({
  id: int,
  name: str,
  gender: ['free', 'male', 'female'],
  interest: new Set(['free', 'male', 'female']),
  // Python's tuple-of-strings keeps the declared order; a JS Set is always sorted.
  disinterest: { kind: set, options: ['free', 'male', 'female'] }
}) {
  static EXTRA = 'info'
}

function stuffit(): string {
  return 'things'
}

class Stuff extends fields({
  id: { kind: int },
  people_id: int,
  name: { kind: str, default: 'unittest' },
  people: stuffit
}) {
  static title = 'StuffIns'
  static store = 'stuffins'
  static id = 'name'
  static index = ['name', 'people']
  static order = 'name'
}

class Things extends fields({ name: { kind: str, storage: 'id' } }) {
  static id = null
  static unique = false as const
  static index = { no_name: ['name'] }
}

class ModelTest extends Model {
  static source = 'TestModel'
}

function unit(): string {
  return 'test'
}

class UnitTest extends fields(
  { id: int, name: new Field(str, { default: 'unittest' }), deffer: unit },
  ModelTest
) {}

class Unit extends fields({ id: int, name: str }, ModelTest) {
  declare test: any
}

class Test extends fields({ id: int, unit_id: int, name: str }, ModelTest) {
  declare unit: any
  declare case: any
  declare run: any
}

new OneToMany(Unit, Test)

class Case extends fields({ id: int, test_id: int, name: str }, ModelTest) {
  declare test: any
}

new OneToOne(Test, Case)

class Run extends fields(
  { id: int, test_id: int, name: str, status: ['pass', 'fail'] },
  ModelTest
) {
  declare test: any
}

new OneToOne(Test, Run)

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
  ModelTest
) {
  declare components: any
  declare component: any
}

class Component extends fields({ id: int, container_id: int, contained_id: int }, ModelTest) {
  declare container: any
  declare contained: any
}

new OneToMany(Meta, Component, {
  childParentRef: 'container_id',
  parentChildAttr: 'components',
  childParentAttr: 'container'
})

new OneToOne(Meta, Component, {
  childParentRef: 'contained_id',
  parentChildAttr: 'component',
  childParentAttr: 'contained'
})

class Net extends fields(
  {
    id: int,
    ip: {
      kind: IPv4Address,
      attr: { compressed: 'address', __int__: 'value' },
      init: 'address',
      titles: 'address',
      extract: ['address', 'value']
    }
  },
  ModelTest
) {
  static titles = 'ip__address'
  static index = 'ip__address'
}

class Sis extends fields({ id: int, name: str, bro_id: set }, ModelTest) {
  declare bro: any
}

class Bro extends fields({ id: int, name: str, sis_id: set }, ModelTest) {
  declare sis: any
}

class SisBro extends fields({ bro_id: int, sis_id: int }, ModelTest) {
  static id = null
  static unique = ['bro_id', 'sis_id']
}

new ManyToMany(Sis, Bro, SisBro)

// --------------------------------------------------------------------------- ModelError

describe('ModelError', () => {
  it('test___init__', () => {
    const error = new ModelError('unittest', 'oops')

    assert.equal(error.model, 'unittest')
    // Divergence: JS convention (and assert.throws) reads error.message, so the model
    // name is folded in there. The bare text stays available as error.detail.
    assert.equal(error.message, 'model: oops')
    assert.equal(error.detail, 'oops')
  })

  it('test___str__', () => {
    const error = new ModelError(new Whoops(), 'adaisy')

    assert.equal(error.message, 'whoops: adaisy')
  })
})

// --------------------------------------------------------------------------- ModelIdentity

describe('ModelIdentity', () => {
  beforeEach(() => {
    clear()
    new MockSource('TestModel')
  })

  it('test_underscore', () => {
    assert.equal(underscore('SomePeople'), 'some_people')
    assert.equal(underscore('SomePEOPLE'), 'some_people')
    assert.equal(underscore('SOMEPEOPLE'), 'somepeople')
  })

  it('test_thy', () => {
    const people = People.thy()

    assert.equal(people.TITLE, 'People')
    assert.equal(people.NAME, 'people')
    assert.deepEqual(people.PARENTS, {})
    assert.deepEqual(people.CHILDREN, {})
    assert.deepEqual(people.SISTERS, {})
    assert.deepEqual(people.BROTHERS, {})
    assert.equal(people._fields._order[0].name, 'id')
    assert.equal(people._fields._order[0].kind, int)
    assert.equal(people._fields._order[1].name, 'name')
    assert.equal(people._fields._order[1].kind, str)
    assert.equal(people._fields._order[2].name, 'gender')
    assert.equal(people._fields._order[2].kind, str)
    assert.deepEqual(people._fields._order[2].options, ['free', 'male', 'female'])
    assert.equal(people._fields._order[2].default, 'free')
    assert.equal(people._fields._order[3].name, 'interest')
    assert.equal(people._fields._order[3].kind, set)
    assert.deepEqual(people._fields._order[3].options, ['female', 'free', 'male'])
    assert.equal(people._fields._order[4].name, 'disinterest')
    assert.equal(people._fields._order[4].kind, set)
    assert.deepEqual(people._fields._order[4].options, ['free', 'male', 'female'])
    assert.equal(people._id, 'id')
    assert.deepEqual(people._titles, ['name'])
    assert.deepEqual(people._list, ['id', 'name'])
    assert.deepEqual(people._unique, { name: ['name'] })
    assert.deepEqual(people._order, ['+name'])

    const stuff = Stuff.thy()

    assert.equal(stuff.TITLE, 'StuffIns')
    assert.equal(stuff.NAME, 'stuffins')
    assert.equal(stuff._fields.field('id')!.name, 'id')
    assert.equal(stuff._fields.field('id')!.kind, int)
    assert.equal(stuff._fields.field('name')!.name, 'name')
    assert.equal(stuff._fields.field('name')!.kind, str)
    assert.equal(stuff._fields.field('name')!.none, false)
    assert.equal(stuff._fields.field('people')!.name, 'people')
    assert.equal(stuff._fields.field('people')!.kind, str)
    assert.equal(stuff._fields.field('people')!.default, stuffit)
    assert.equal(stuff._id, 'name')
    assert.deepEqual(stuff._unique, { 'id-people_id-people': ['id', 'people_id', 'people'] })
    assert.deepEqual(stuff._order, ['+name'])

    const things = Things.thy()

    assert.equal(things.NAME, 'things')
    assert.deepEqual(things._unique, {})
    assert.deepEqual(things._index, { no_name: ['name'] })
    assert.equal(things._fields.field('name')!.name, 'name')
    assert.equal(things._fields.field('name')!.kind, str)
    assert.equal(things._fields.field('name')!.storage, 'id')
    assert.equal(things._id, null)

    Unit.thy()

    assert.equal(Unit.source, 'TestModel')

    Net.thy()

    assert.deepEqual(Test.many()._titles, ['unit_id', 'name'])

    class SomePeople extends fields({ id: int }) {}

    assert.equal(SomePeople.thy().NAME, 'some_people')

    class LabelTitles extends fields({ id: int, name: str }) {
      static titles = 'nope'
    }

    throwsModel(() => LabelTitles.thy(), /cannot find field nope from titles/)

    class LabelList extends fields({ id: int, name: str }) {
      static list = 'nope'
    }

    throwsModel(() => LabelList.thy(), /cannot find field nope from list/)

    class Unique extends fields({ id: int, name: str }) {
      static unique = 'nope'
    }

    throwsModel(() => Unique.thy(), /cannot find field nope from unique nope/)

    class Index extends fields({ id: int, name: str }) {
      static index = 'nope'
    }

    throwsModel(() => Index.thy(), /cannot find field nope from index nope/)

    class Inject extends fields({
      id: int,
      name: str,
      push: { kind: str, inject: 'nope__value' }
    }) {}

    throwsField(() => Inject.thy(), /cannot find field nope from inject nope__value/)

    Inject.fields.push = { kind: str, inject: 'name__value' }

    throwsField(() => Inject.thy(), /field name not list or dict from inject name__value/)

    assert.equal(Sis.thy()._fields.field('bro_id')!.store, false)
    assert.equal(Sis.thy()._fields.field('bro_id')!.tied, true)
    assert.equal(Bro.thy()._fields.field('sis_id')!.store, false)
    assert.equal(Bro.thy()._fields.field('sis_id')!.tied, true)
  })

  it('test__field_name', () => {
    const stuff = Stuff.thy()

    assert.equal(stuff._fieldName('id'), 'id')
    assert.equal(stuff._fieldName(2), 'name')

    throwsModel(() => stuff._fieldName('nope'), /cannot find field nope in stuffins/)
  })

  it('test_ordering', () => {
    const stuff = Stuff.thy()

    assert.deepEqual(stuff._ordering('id'), ['+id'])
    assert.deepEqual(stuff._ordering('-name'), ['-name'])

    throwsModel(() => stuff._ordering('nope'), /unknown sort field nope/)
  })

  it('test__ancestor', () => {
    const test = Test.thy()

    assert.equal(test._ancestor('unit_id')!.Parent, Unit)
    assert.equal(test._ancestor('nope'), null)
  })

  it('test_define', () => {
    const people = People.thy()

    assert.deepEqual(people.define(), {
      name: 'people',
      title: 'People',
      extra: 'info',
      fields: [
        {
          name: 'id',
          kind: 'int',
          store: 'id',
          none: true
        },
        {
          name: 'name',
          kind: 'str',
          store: 'name',
          none: false
        },
        {
          name: 'gender',
          kind: 'str',
          store: 'gender',
          options: ['free', 'male', 'female'],
          default: 'free',
          none: false
        },
        {
          name: 'interest',
          kind: 'set',
          store: 'interest',
          options: ['female', 'free', 'male'],
          none: false
        },
        {
          name: 'disinterest',
          kind: 'set',
          store: 'disinterest',
          options: ['free', 'male', 'female'],
          none: false
        }
      ],
      id: 'id',
      unique: {
        name: ['name']
      },
      index: {}
    })
  })

  it('test_migrate', () => {
    const people = People.thy()

    assert.deepEqual(
      people.migrate({
        name: 'people',
        title: 'People',
        fields: [
          {
            name: 'id',
            kind: 'int',
            store: 'id',
            none: true
          },
          {
            name: 'name',
            kind: 'str',
            store: 'name',
            none: false
          },
          {
            name: 'gender',
            kind: 'str',
            store: 'genders',
            options: ['free', 'male', 'female'],
            default: 'free',
            none: false
          },
          {
            name: 'interest',
            kind: 'set',
            store: 'interest',
            options: ['female', 'free', 'male'],
            none: false
          },
          {
            name: 'disinterest',
            kind: 'set',
            store: 'disinterest',
            options: ['free', 'male', 'female'],
            none: false
          }
        ],
        id: 'id',
        unique: {
          name: ['name']
        },
        index: {}
      }),
      {
        extra: 'info',
        fields: {
          change: {
            gender: {
              store: 'gender'
            }
          }
        }
      }
    )
  })
})

// --------------------------------------------------------------------------- Model

describe('Model', () => {
  let source: MockSource

  beforeEach(() => {
    clear()
    source = new MockSource('TestModel')
  })

  // Python's Model._extract pops relations' own kwargs out of a **kwargs dict. There is
  // no such thing here - internal options are a separate object - so test__extract is
  // not portable.

  it('test___init__', () => {
    let model: any = new UnitTest()

    // initializations

    assert.deepEqual(model._parents, {})
    assert.deepEqual(model._children, {})
    assert.deepEqual(model._sisters, {})
    assert.deepEqual(model._brothers, {})
    assert.deepEqual(model._related, {})

    // fields

    assert.equal(model._fields.field('id').name, 'id')
    assert.equal(model._fields.field('id').kind, int)
    assert.equal(model._fields.field('id').auto, true)
    assert.equal(model._fields.field('name').name, 'name')
    assert.equal(model._fields.field('name').kind, str)
    assert.equal(model._fields.has('nope'), false)

    // chunk and options

    model = build(Run, { chunk: 5 })
    assert.equal(model._chunk, 5)
    assert.deepEqual(model._record.field('status').options, ['pass', 'fail'])

    // read

    model = build(UnitTest, { read: { id: 1, name: 'unit', deffer: 'test' } })

    assert.equal(model._record.get('id'), 1)
    assert.equal(model._record.get('name'), 'unit')
    assert.equal(model._record._action, 'update')

    assert.equal(model._role, 'model')
    assert.equal(model._mode, 'one')
    assert.equal(model._action, 'update')

    // parent

    model = build(Unit, { child: { id: 1 } })

    assert.equal(model._record.field('id').criteria.eq, 1)
    assert.equal(model._record._action, 'retrieve')

    assert.equal(model._role, 'parent')
    assert.equal(model._mode, 'one')
    assert.equal(model._action, 'retrieve')
    assert.deepEqual(model._related, { id: 1 })

    // child one create

    model = build(Test, { parent: { unit_id: null }, mode: 'one' })

    assert.equal(model._role, 'child')
    assert.equal(model._mode, 'one')
    assert.equal(model._action, 'create')
    assert.deepEqual(model._related, { unit_id: null })

    // child many retrieve

    let models: any = build(Test, { parent: { unit_id: 1 }, mode: 'many' })

    assert.equal(models._record.field('unit_id').criteria.eq, 1)
    assert.equal(models._record._action, 'retrieve')

    assert.equal(models._role, 'child')
    assert.equal(models._mode, 'many')
    assert.equal(models._action, 'retrieve')
    assert.deepEqual(models._related, { unit_id: 1 })

    // sibling

    models = build(Test, { sibling: { id__in: [1] } })

    assert.deepEqual(models._record.field('id').criteria.in, [1])
    assert.equal(models._record._action, 'retrieve')

    assert.equal(models._mode, 'many')
    assert.equal(models._action, 'retrieve')

    // retrieve

    model = build(Test, { action: 'retrieve', mode: 'one', args: [1] })

    assert.equal(model._record.field('id').criteria.eq, 1)
    assert.equal(model._record._action, 'retrieve')

    assert.equal(model._role, 'model')
    assert.equal(model._mode, 'one')
    assert.equal(model._action, 'retrieve')
    assert.deepEqual(model._related, {})

    // create

    model = new UnitTest('unit')

    assert.equal(model._id, 'id')
    assert.equal(model._record.get('name'), 'unit')

    assert.equal(model._role, 'model')
    assert.equal(model._mode, 'one')
    assert.equal(model._action, 'create')
    assert.deepEqual(model._related, {})

    // With names

    model = new UnitTest({ id: '1', name: 'unit' })
    assert.equal(model._record.get('id'), 1)
    assert.equal(model._record.get('name'), 'unit')

    // Create multiple

    models = new UnitTest([{ id: '1', name: 'unit' }])
    assert.equal(models._models[0]._record.get('id'), 1)
    assert.equal(models._models[0]._record.get('name'), 'unit')

    assert.equal(models._role, 'model')
    assert.equal(models._mode, 'many')
    assert.equal(models._action, 'create')
    assert.deepEqual(models._related, {})

    // Create bulk

    models = build(UnitTest, { bulk: true, size: 4 })
    assert.deepEqual(models._models, [])

    assert.equal(models._role, 'model')
    assert.equal(models._mode, 'many')
    assert.equal(models._action, 'create')
    assert.deepEqual(models._related, {})
    assert.equal(models._bulk, true)
    assert.equal(models._size, 4)
  })

  it('test___setattr__', async () => {
    // model

    // single

    const model: any = new UnitTest('unit')
    model.id = 2
    assert.equal(model._record.get('id'), 2)

    const net: any = new Net('1.2.3.4')
    net.ip__address = '1.2.3.4'
    assert.equal(net._record.get('ip').compressed, '1.2.3.4')

    // multiple, with records

    const models: any = new UnitTest([{ name: 'unit' }, { name: 'test' }])
    models.id = 3
    assert.equal(models._models[0]._record.get('id'), 3)
    assert.equal(models._models[1]._record.get('id'), 3)

    // multiple, no records

    const empty: any = new UnitTest([])

    throwsModel(() => {
      empty.id = 4
    }, /unit_test: no records/)

    // child

    // one to one, no records

    const test: any = new Test()

    throwsModel(() => {
      test.case.name = 'nope'
    }, /case: no record/)

    // one to one, with record

    test.case.add()

    test.case.name = 'yep'

    assert.equal(test.case._models[0]._record.field('name').value, 'yep')

    // make sure ensure is called (an explicit retrieve, here)

    await new Unit('sure').create()

    const one: any = await Unit.one(1).retrieve()

    one.id = 2
    assert.equal(one._record.get('id'), 2)

    // json complex set

    const meta: any = new Meta({ things: { a: { b: 1 } } })

    meta.things__a__b = 2
    assert.deepEqual(meta.things, { a: { b: 2 } })
  })

  it('test___getattr__', async () => {
    const unit: any = new Unit('ya')
    void unit.test.add('sure')[0]
    await unit.create()

    // All id's will be 1

    const test: any = await Test.one(1).retrieve()

    const parent: any = await test.unit.retrieve()
    assert.equal(parent.name, 'ya')
    assert.equal(test.unit__name, 'ya')

    await parent.test.retrieve()
    assert.deepEqual(test.unit__test__name, ['sure'])

    test.case.add('whatever')
    await test.update()

    assert.equal(test.case.name, 'whatever')

    const net: any = new Net('1.2.3.4')

    assert.equal(net.ip__address, '1.2.3.4')

    const units: any = await Unit.many().retrieve()

    throwsModel(() => units.test, /cannot access 'test' in many mode/)

    // Python raises AttributeError for an unknown attribute; a JS property read can't.
    assert.equal(test.fail, undefined)
  })

  it('test___getattribute__', async () => {
    // model

    // single

    const model: any = new UnitTest('unit')
    assert.equal(model.name, 'unit')

    // multiple, with records

    const models: any = new UnitTest([{ name: 'unit' }, { name: 'test' }])
    assert.deepEqual(models.name, ['unit', 'test'])

    // multiple, no records

    const empty: any = new UnitTest([])

    empty._models = null

    throwsModel(() => empty.name, /unit_test: no records/)

    // child

    // one to one, no records

    const test: any = new Test()

    throwsModel(() => test.case.name, /case: no record/)

    // one to one, with record

    test.case.add()

    test.case.name = 'yep'

    assert.equal(test.case.name, 'yep')

    // make sure ensure is called (an explicit retrieve, here)

    await new Unit('sure').create()

    const one: any = await Unit.one(1).retrieve()

    assert.equal(one.name, 'sure')
  })

  it('test___len__', async () => {
    // model

    // single

    const model: any = new UnitTest('unit')
    assert.equal(model.size, 3)

    // multiple, with records

    const models: any = new UnitTest([{ name: 'unit' }])
    assert.equal(models.size, 1)

    // multiple, no records

    const empty: any = new UnitTest([])

    assert.equal(empty.size, 0)

    // child

    // one to one, no records

    const test: any = new Test()

    assert.equal(test.case.size, 0)

    // one to one, with record

    test.case.add()

    test.case.name = 'yep'

    assert.equal(test.case.size, 3)

    // make sure ensure is called (an explicit retrieve, here)

    await new Unit('sure').create()

    const one: any = await Unit.one(1).retrieve()

    assert.equal(one.size, 2)

    const many: any = await Unit.many().retrieve()

    assert.equal(many.size, 1)
  })

  it('test___iter__', async () => {
    // model

    // single

    const model: any = new UnitTest('unit')
    assert.deepEqual([...model], ['id', 'name', 'deffer'])

    // multiple, with records

    const models: any = new UnitTest([{ name: 'unit' }, { name: 'test' }])
    assert.deepEqual([...models].map((each: any) => each.name), ['unit', 'test'])

    // multiple, no records

    const empty: any = new UnitTest([])

    assert.deepEqual([...empty], [])

    // child

    // one to one, no records

    const test: any = new Test()

    assert.deepEqual([...test.case], [])

    // one to one, with record

    test.case.add()

    test.case.name = 'yep'

    assert.deepEqual([...test.case], ['id', 'test_id', 'name'])

    // make sure ensure is called (an explicit retrieve, here)

    await new Unit('sure').create()

    const one: any = await Unit.one(1).retrieve()

    assert.deepEqual([...one], ['id', 'name'])
  })

  it('test_keys', () => {
    // many, VERBOTTEN

    throwsModel(() => new UnitTest([]).keys(), /no keys with many/)

    // single

    const model: any = new UnitTest('unit')
    assert.deepEqual(model.keys(), ['id', 'name', 'deffer'])
    assert.deepEqual(model.export(), { id: null, name: 'unit', deffer: 'test' })

    // child, one

    assert.deepEqual((new Test() as any).case.keys(), [])
    assert.deepEqual((new Test() as any).case.add().keys(), ['id', 'test_id', 'name'])
  })

  it('test___contains__', async () => {
    // model

    // single

    const model: any = new UnitTest('unit')
    assert.equal(Reflect.has(model, 'id'), true)

    // multiple, with records

    const models: any = new UnitTest([{ name: 'unit' }, { name: 'test' }])
    assert.equal(Reflect.has(models, 'id'), true)

    // multiple, no records

    const empty: any = new UnitTest([])

    assert.equal(Reflect.has(empty, 'id'), false)

    // child

    // one to one, no records

    const test: any = new Test()

    assert.equal(Reflect.has(test.case, 'id'), false)

    // one to one, with record

    test.case.add()

    test.case.name = 'yep'

    assert.equal(Reflect.has(test.case, 'id'), true)

    // make sure ensure is called (an explicit retrieve, here)

    await new Unit('sure').create()

    const one: any = await Unit.one(1).retrieve()

    assert.equal(Reflect.has(one, 'id'), true)
  })

  it('test___setitem__', async () => {
    // model

    // single

    const model: any = new UnitTest('unit')
    model['id'] = 2
    assert.equal(model._record.get('id'), 2)

    // multiple, with records

    const models: any = new UnitTest([{ name: 'unit' }, { name: 'test' }])
    models['id'] = 3
    assert.equal(models._models[0]._record.get('id'), 3)
    assert.equal(models._models[1]._record.get('id'), 3)

    // multiple, no overriding models

    throwsModel(() => {
      models[0] = 1
    }, /unit_test: no override/)

    // multiple, no records

    const empty: any = new UnitTest([])

    throwsModel(() => {
      empty['id'] = 4
    }, /unit_test: no records/)

    // child

    // one to one, no records

    const test: any = new Test()

    throwsModel(() => {
      test.case['name'] = 'nope'
    }, /case: no record/)

    // one to one, with record

    test.case.add()

    test.case['name'] = 'yep'

    assert.equal(test.case._models[0]._record.field('name').value, 'yep')

    // make sure ensure is called (an explicit retrieve, here)

    await new Unit('sure').create()

    const one: any = await Unit.one(1).retrieve()

    one['id'] = 2
    assert.equal(one._record.get('id'), 2)
  })

  it('test___getitem__', async () => {
    // model

    // single

    const model: any = new UnitTest('unit')
    assert.equal(model['name'], 'unit')

    // multiple, with records

    const models: any = new UnitTest([{ name: 'unit' }, { name: 'test' }])
    assert.deepEqual(models['name'], ['unit', 'test'])
    assert.equal(models[0]['name'], 'unit')

    // multiple, no records

    const empty: any = new UnitTest([])
    empty._models = null

    throwsModel(() => empty['name'], /unit_test: no records/)

    // child

    // one to one, no records

    const test: any = new Test()

    throwsModel(() => test.case['name'], /case: no record/)

    // one to one, with record

    test.case.add()

    test.case.name = 'yep'

    assert.equal(test.case['name'], 'yep')

    // make sure ensure is called (an explicit retrieve, here)

    await new Unit('sure').create()

    const one: any = await Unit.one(1).retrieve()

    assert.equal(one['name'], 'sure')

    const unit: any = new Unit('ya')
    void unit.test.add('sure')[0]
    await unit.create()

    // All id's will be 1

    const found: any = await Test.one(1).retrieve()

    const parent: any = await found.unit.retrieve()
    assert.equal(found['unit__name'], 'ya')

    await parent.test.retrieve()
    assert.deepEqual(found['unit__test__name'], ['sure'])
  })

  it('test__parent', () => {
    class TestUnit extends Model {}

    const relation: any = { childParentAttr: 'unittest' }

    ;(TestUnit as any)._parent(relation)

    assert.deepEqual((TestUnit as any).PARENTS, { unittest: relation })
  })

  it('test__child', () => {
    class TestUnit extends Model {}

    const relation: any = { parentChildAttr: 'unittest' }

    ;(TestUnit as any)._child(relation)

    assert.deepEqual((TestUnit as any).CHILDREN, { unittest: relation })
  })

  it('test__sister', () => {
    class TestUnit extends Model {}

    const relation: any = { brotherSisterAttr: 'unittest' }

    ;(TestUnit as any)._sister(relation)

    assert.deepEqual((TestUnit as any).SISTERS, { unittest: relation })
  })

  it('test__brother', () => {
    class TestUnit extends Model {}

    const relation: any = { sisterBrotherAttr: 'unittest' }

    ;(TestUnit as any)._brother(relation)

    assert.deepEqual((TestUnit as any).BROTHERS, { unittest: relation })
  })

  it('test__relate', async () => {
    await new Unit('ya').create()

    const test: any = new Test()

    // bulk

    test._bulk = true

    throwsModel(() => test._relate(null), /test: cannot access relatives in bulk mode/)

    test._bulk = false

    // parents

    assert.deepEqual(test.unit._related, { id: null })
    assert.equal(test.unit._role, 'parent')
    assert.equal(test.unit._mode, 'one')
    assert.equal(test.unit._action, 'retrieve')
    assert.equal(test.unit._record._action, 'retrieve')
    assert.equal(test.unit._record.field('id').criteria.null, true)

    test.unit_id = 1
    assert.deepEqual(test.unit._related, { id: 1 })

    const ya: any = await test.unit.retrieve()
    assert.equal(ya.name, 'ya')
    assert.equal(test.unit._action, 'update')
    assert.equal(test.unit._record._action, 'update')
    assert.equal(test.unit._record.field('id').criteria, null)

    // children

    // one to many

    const fresh: any = new Unit()

    assert.deepEqual(fresh.test._related, { unit_id: null })
    assert.equal(fresh.test._role, 'child')
    assert.equal(fresh.test._mode, 'many')
    assert.equal(fresh.test._action, 'create')

    fresh.test.add('sure')
    assert.equal(fresh.test[0]._record._action, 'create')
    assert.equal(fresh.test[0].name, 'sure')
    assert.equal(fresh.test[0].unit_id, null)

    fresh.id = 2

    assert.deepEqual(fresh.test._related, { unit_id: 2 })
    assert.equal(fresh.test[0].unit_id, 2)

    let unit: any = await Unit.one(1).retrieve()
    unit.test.add('sure')
    await unit.update()

    unit = await Unit.one(1).retrieve()
    assert.deepEqual(unit.test._related, { unit_id: 1 })
    assert.equal(unit.test._role, 'child')
    assert.equal(unit.test._mode, 'many')
    assert.equal(unit.test._action, 'retrieve')
    assert.equal(unit.test._record._action, 'retrieve')
    assert.equal(unit.test._record.field('unit_id').criteria.eq, 1)

    await unit.test.retrieve()

    assert.equal(unit.test[0].id, 1)
    assert.equal(unit.test._role, 'child')
    assert.equal(unit.test._mode, 'many')
    assert.equal(unit.test._action, 'update')
    assert.equal(unit.test[0]._record._action, 'update')
    assert.equal(unit.test[0]._record.field('unit_id').criteria, null)

    // one to one

    unit.test.add('yessah')

    assert.deepEqual(unit.test[1].case._related, { test_id: null })
    assert.equal(unit.test[1].case._role, 'child')
    assert.equal(unit.test[1].case._mode, 'one')
    assert.equal(unit.test[1].case._action, 'create')

    unit.test[1].case.add('whatever')
    assert.equal(unit.test[1].case._models[0]._action, 'create')
    assert.equal(unit.test[1].case.name, 'whatever')
    assert.equal(unit.test[1].case.test_id, null)

    unit.test[1].id = 3

    assert.deepEqual(unit.test[1].case._related, { test_id: 3 })
    assert.equal(unit.test[1].case.test_id, 3)

    let one: any = await Test.one(1).retrieve()
    one.case.add('whatever')
    await one.update()

    one = await Test.one(1).retrieve()
    assert.deepEqual(one.case._related, { test_id: 1 })
    assert.equal(one.case._role, 'child')
    assert.equal(one.case._mode, 'one')
    assert.equal(one.case._action, 'retrieve')
    assert.equal(one.case._record._action, 'retrieve')
    assert.equal(one.case._record.field('test_id').criteria.eq, 1)

    await one.case.retrieve()

    assert.equal(one.case.id, 1)
    assert.equal(one.case._role, 'child')
    assert.equal(one.case._mode, 'one')
    assert.equal(one.case._action, 'update')
    assert.equal(one.case._models[0]._action, 'update')
    assert.equal(one.case._models[0]._record.field('test_id').criteria, null)

    // components

    const outside: any = await new Meta('outside').create()
    const inside: any = await new Meta('inside').create()

    const component: any = await new Component({
      container_id: outside.id,
      contained_id: inside.id
    }).create()

    assert.equal(component.container_id, outside.id)
    assert.equal(component.contained_id, inside.id)

    const components: any = await outside.components.retrieve()

    assert.equal(components[0].id, component.id)
    assert.equal(components[0].contained_id, inside.id)

    const contained: any = await components[0].contained.retrieve()
    assert.equal(contained.id, inside.id)
    assert.equal(contained.name, 'inside')

    let insideOne: any = await Meta.one(inside.id).retrieve()

    let insideComponent: any = await insideOne.component.retrieve()
    assert.equal(insideComponent.id, component.id)
    assert.equal(insideComponent.container_id, outside.id)

    let container: any = await insideComponent.container.retrieve()
    assert.equal(container.id, outside.id)
    assert.equal(container.name, 'outside')

    insideOne = await Meta.one({ component__contained__name: 'inside' }).retrieve()

    insideComponent = await insideOne.component.retrieve()
    assert.equal(insideComponent.id, component.id)
    assert.equal(insideComponent.container_id, outside.id)

    container = await insideComponent.container.retrieve()
    assert.equal(container.id, outside.id)
    assert.equal(container.name, 'outside')

    // many to many

    const tom: any = await new Bro('Tom').create()
    const dick: any = await new Bro('Dick').create()

    const dot: any = await new Sis('Dot').create()
    const nikki: any = await new Sis('Nikki').create()

    const mary: any = await new Sis('Mary', { bro_id: [tom.id, dick.id] }).create()
    const harry: any = await new Bro('Harry', { sis_id: [dot.id, nikki.id] }).create()

    await mary.bro.retrieve()
    await harry.sis.retrieve()

    assert.deepEqual(mary.bro.id, [dick.id, tom.id])
    assert.deepEqual(harry.sis.id, [dot.id, nikki.id])
  })

  it('test__collate', async () => {
    const unit: any = new Unit('ya')
    unit.test.add('sure').add('yessah')[1].case.add('whatever')
    await unit.create()

    let test: any = Test.one({ unit__name: 'ya', case__name: 'whatever' })
    assert.ok('unit' in test._parents)
    assert.ok('case' in test._children)

    await test._collate()

    assert.deepEqual(test._record.field('unit_id').criteria.in, [1])
    assert.deepEqual(test._record.field('id').criteria.in, [2])
    assert.equal('unit' in test._parents, false)
    assert.equal('case' in test._children, false)

    test = Test.one()

    assert.equal(test.overflow, false)

    test = build(Test, { action: 'retrieve', mode: 'one', chunk: 1, args: [{ unit__name: 'ya' }] })
    await test._collate()

    assert.equal(test.overflow, true)

    test = build(Test, {
      action: 'retrieve',
      mode: 'one',
      chunk: 1,
      args: [{ case__name: 'whatever' }]
    })
    await test._collate()

    assert.equal(test.overflow, true)
  })

  it('test__propagate', async () => {
    const unit: any = new Unit({ name: 'ya' })
    const test: any = new Test({ name: 'sure' })
    const acase: any = new Case({ name: 'whatever' })

    assert.equal('test' in unit._children, false)
    assert.equal('unit' in test._parents, false)
    assert.equal('case' in test._children, false)
    assert.equal('test' in acase._parents, false)

    test.unit_id = 1

    assert.equal(test.unit._role, 'parent')
    assert.equal(test.unit._mode, 'one')
    assert.equal(test.unit._action, 'retrieve')
    assert.equal(test.unit._record._action, 'retrieve')
    assert.deepEqual(test.unit._record.field('id').criteria, { eq: 1 })

    await unit.create()

    const ya: any = await test.unit.retrieve()

    assert.equal(ya.id, 1)
    assert.equal(ya.name, 'ya')

    test.unit_id = 2

    assert.equal(test._parents['unit'], null)

    assert.equal(test.unit._role, 'parent')
    assert.equal(test.unit._mode, 'one')
    assert.equal(test.unit._action, 'retrieve')
    assert.equal(test.unit._record._action, 'retrieve')

    await test.set({ unit_id: 1 }).create()

    const yep: any = new Unit('yep')
    yep.test.add('sup')

    assert.equal(yep.test[0].unit_id, null)
    assert.deepEqual(yep.test._related, { unit_id: null })
    assert.deepEqual(yep.test[0]._related, { unit_id: null })

    await yep.create()

    assert.equal(yep.test[0].unit_id, 2)
    assert.deepEqual(yep.test._related, { unit_id: 2 })
    assert.deepEqual(yep.test[0]._related, { unit_id: 2 })
  })

  it('test__input', () => {
    const model: any = new UnitTest()

    model._input(model._record, ['unit'], {})
    assert.equal(model.name, 'unit')

    model._input(model._record, [], { id: 2, name: 'test' })
    assert.equal(model.id, 2)
    assert.equal(model.name, 'test')

    model._record._order[0].readonly = true
    model._input(model._record, ['write'], {})
    assert.equal(model.id, 2)
    assert.equal(model.name, 'write')

    model._record._order[0].readonly = false
    model._related = { id: null }
    model._input(model._record, ['relate'], {})
    assert.equal(model.id, 2)
    assert.equal(model.name, 'relate')
  })

  it('test__build', () => {
    const model: any = new UnitTest()

    let record: any = model._build('create', { positional: ['unittest'] })
    assert.equal(record.get('name'), 'unittest')
    assert.equal(record.get('deffer'), 'test')

    record = model._build('create', {
      defaults: false,
      read: { id: 2, name: 'test', deffer: 'unit' }
    })
    assert.equal(record.get('id'), 2)

    model._related = { id: 3 }
    record = model._build('create', { defaults: false })
    assert.equal(record.get('id'), 3)
    assert.equal(record.get('name'), null)
  })

  it('test__ensure', async () => {
    await new Unit([['ya'], ['sure'], ['whatever']]).create()

    const units: any = Unit.many()
    await units._ensure()
    assert.deepEqual(units.name, ['sure', 'whatever', 'ya'])

    const updating: any = Unit.many({ name: 'sure' }).set({ name: 'shore' })
    await rejectsModel(() => updating._ensure(), /unit: need to update/)
  })

  it('test__each', async () => {
    const unit: any = new Unit('ya')
    assert.equal(unit._each().length, 1)
    assert.equal(unit._each('create').length, 1)
    assert.equal(unit._each('update').length, 0)
    assert.equal(unit._each()[0].name, 'ya')

    await unit.create()
    assert.equal(unit._each().length, 1)
    assert.equal(unit._each('create').length, 0)
    assert.equal(unit._each('update').length, 1)

    unit.test.add('sure')
    assert.equal(unit.test._each().length, 1)
    assert.equal(unit.test._each('create').length, 1)
    assert.equal(unit.test._each('update').length, 0)
    assert.equal(unit.test._each()[0].name, 'sure')

    await unit.update()
    unit.test.add('whatever')
    assert.equal(unit.test._each().length, 2)
    assert.equal(unit.test._each('create').length, 1)
    assert.equal(unit.test._each('update').length, 1)
    assert.equal(unit.test._each('update')[0].name, 'sure')
    assert.equal(unit.test._each('create')[0].name, 'whatever')
  })

  it('test_filter', () => {
    const models: any = build(UnitTest, { action: 'retrieve', mode: 'many' })
      .filter(1)
      .filter({ name__not_in: 'unittest' })

    assert.equal(models._record._action, 'retrieve')
    assert.equal(models._record.field('id').criteria.eq, 1)
    assert.deepEqual(models._record.field('name').criteria.not_in, ['unittest'])

    const unit: any = Unit.many().filter({ test__id__in: [1], like: 'fuzzy' })

    assert.deepEqual(unit._children['test']._record.field('id').criteria.in, [1])

    const test: any = Test.many().filter({ like: 'fuzzy' })

    assert.equal(test._like, 'fuzzy')
  })

  it('test__tie', () => {
    // sibling-attribute criteria are grouped per relation accessor
    const sis: any = Sis.many({ bro__name: 'Tom', bro__id__gt: 5 })

    assert.deepEqual(sis._ties, { bro: { name: 'Tom', id__gt: 5 } })
  })

  it('test_bulk', () => {
    const models: any = UnitTest.bulk(4)

    assert.deepEqual(models._models, [])
    assert.equal(models._role, 'model')
    assert.equal(models._mode, 'many')
    assert.equal(models._action, 'create')
    assert.deepEqual(models._related, {})
    assert.equal(models._bulk, true)
    assert.equal(models._size, 4)
  })

  it('test_one', () => {
    const models: any = UnitTest.one(1)

    assert.equal(models._mode, 'one')
    assert.equal(models._action, 'retrieve')
    assert.equal(models._record._action, 'retrieve')
    assert.equal(models._record.field('id').criteria.eq, 1)
  })

  it('test_many', () => {
    const models: any = UnitTest.many(1, { name__not_in: 'unittest' })

    assert.equal(models._mode, 'many')
    assert.equal(models._action, 'retrieve')
    assert.equal(models._record._action, 'retrieve')
    assert.equal(models._record.field('id').criteria.eq, 1)
    assert.deepEqual(models._record.field('name').criteria.not_in, ['unittest'])
  })

  it('test_sort', async () => {
    const models: any = Unit.many().sort().sort('id').sort('-name')

    assert.deepEqual(models._sort, ['+id', '-name'])

    const units: any = (await new Unit([['ya'], ['sure'], ['whatever']]).create()).sort('name')
    assert.deepEqual(units.name, ['sure', 'whatever', 'ya'])

    throwsModel(() => Unit.many().sort('nope'), /unit: unknown sort field nope/)

    const one: any = await Unit.one({ name: 'ya' }).retrieve()
    throwsModel(() => one.sort(), /unit: cannot sort one/)
  })

  it('test_limt', async () => {
    let models: any = Unit.many().limit()
    assert.equal(models._limit, 100)
    assert.equal(models._offset, 0)

    models = Unit.many().limit({ limit: 5, start: 2 })

    assert.equal(models._limit, 5)
    assert.equal(models._offset, 2)

    models = Unit.many().limit({ page: 4, perPage: 5 })

    assert.equal(models._limit, 5)
    assert.equal(models._offset, 15)

    await new Unit([['ya'], ['sure'], ['whatever']]).create()
    const units: any = await Unit.many().sort('name').limit(2).retrieve()
    assert.deepEqual(units.name, ['sure', 'whatever'])

    const one: any = await Unit.one({ name: 'ya' }).retrieve()
    throwsModel(() => one.limit(), /unit: can only limit retrieve/)
  })

  it('test_set', async () => {
    const model: any = new UnitTest().set('unit')
    assert.equal(model.name, 'unit')
    await model.create()

    const one: any = (await UnitTest.one({ name: 'unit' }).retrieve())!.set({ name: 'test' })
    assert.equal(one.id, 1)
    assert.equal(one._action, 'update')

    const models: any = UnitTest.many({ name: 'unit' }).set({ name: 'test' })
    assert.equal(models._record.get('name'), 'test')
    assert.equal(models._action, 'retrieve')
    assert.equal(models._record._action, 'update')
    assert.equal(models._record.field('name').criteria.eq, 'unit')
  })

  it('test_add', async () => {
    const model: any = new UnitTest({ name: 'unit' })
    assert.equal(model.name, 'unit')

    throwsModel(() => model.add(), /only one allowed/)

    let models: any = new UnitTest([{ name: 'unit' }])
    models = models.add({ _count: 2, name: 'more' })
    assert.deepEqual(models.name, ['unit', 'more', 'more'])

    const test: any = new Test()

    throwsModel(() => test.case.add({ _count: 2 }), /only one allowed/)

    test.case.add('sure')
    assert.equal(test.case.name, 'sure')

    // Python's add() flushes a full bulk model itself; that write is async here, so the
    // equivalent is queue().
    const bulk: any = UnitTest.bulk(2)

    await bulk.queue('unit')

    assert.equal(await UnitTest.one().retrieve(false), null)

    await bulk.queue('test')

    assert.deepEqual(bulk._models, [])

    assert.equal((await UnitTest.many().retrieve())!.size, 2)
  })

  it('test_export', async () => {
    let models: any = await Net.many().retrieve()
    assert.deepEqual(models.export(), [])

    const model: any = await new Net('1.2.3.4').create()
    assert.deepEqual(model.export(), {
      id: 1,
      ip: {
        address: '1.2.3.4',
        value: 16909060
      }
    })

    models = await Net.many().retrieve()
    assert.deepEqual(models.export(), [
      {
        id: 1,
        ip: {
          address: '1.2.3.4',
          value: 16909060
        }
      }
    ])
  })

  it('test_define', () => {
    Unit.define()

    assert.deepEqual(Unit.define(), [
      {
        ACTION: 'add',
        source: 'TestModel',
        name: 'unit',
        title: 'Unit',
        fields: [
          {
            name: 'id',
            kind: 'int',
            store: 'id',
            none: true,
            auto: true
          },
          {
            name: 'name',
            kind: 'str',
            store: 'name',
            none: false
          }
        ],
        id: 'id',
        unique: {
          name: ['name']
        },
        index: {}
      }
    ])
  })

  it('test_create', async () => {
    await new Unit('yep').create()
    assert.equal((await Unit.one({ name: 'yep' }).retrieve())!.id, 1)

    const unit: any = Unit.one(0)
    await rejectsModel(() => unit.create(), /unit: cannot create during retrieve/)
  })

  it('test_count', async () => {
    assert.equal(await Unit.many({ name: 'yep' }).count(), 0)

    await new Unit('yep').create()
    assert.equal(await Unit.many({ name: 'yep' }).count(), 1)

    const unit: any = new Unit('sure')
    await rejectsModel(() => unit.count(), /unit: cannot count during create/)
  })

  it('test_retrieve', async () => {
    assert.equal(await Unit.one({ name: 'yep' }).retrieve(false), null)

    await new Unit('yep').create()
    assert.equal((await Unit.one({ name: 'yep' }).retrieve())!.id, 1)

    const unit: any = new Unit('sure')
    await rejectsModel(() => unit.retrieve(), /unit: cannot retrieve during create/)
  })

  it('test_titles', async () => {
    await new Unit('yep').create()
    assert.deepEqual((await Unit.one({ name: 'yep' }).titles()).ids, [1])

    const unit: any = new Unit('sure')
    await rejectsModel(() => unit.titles(), /unit: cannot titles during create/)
  })

  it('test_update', async () => {
    const unit: any = await new Unit('yep').create()
    unit.name = 'sure'

    assert.equal(await unit.update(), 1)
    assert.equal((await Unit.one({ name: 'sure' }).retrieve())!.id, 1)

    const sure: any = await Unit.one({ name: 'sure' }).retrieve()
    assert.equal(await sure.set({ name: 'whatever' }).update(), 1)

    const creating: any = new Unit('sure')
    await rejectsModel(() => creating.update(), /unit: cannot update during create/)
  })

  it('test_delete', async () => {
    const unit: any = await new Unit('yep').create()

    assert.equal(await unit.delete(), 1)
    assert.equal(await Unit.one({ name: 'yep' }).retrieve(false), null)

    await new Unit('sure').create()
    assert.equal(await Unit.one({ name: 'sure' }).delete(), 1)

    const creating: any = new Unit('sure')
    await rejectsModel(() => creating.delete(), /unit: cannot delete during create/)
  })

  it('test_query', async () => {
    const unit: any = new Unit('yep')

    let query: any = unit.query()
    assert.equal(query.action, 'CREATE')
    assert.equal(query.model, unit)

    await unit.create()

    query = unit.query('update')
    assert.equal(query.action, 'UPDATE')
    assert.equal(query.model, unit)

    query = unit.query('delete')
    assert.equal(query.action, 'DELETE')
    assert.equal(query.model, unit)

    query = unit.query()
    assert.equal(query.action, 'UPDATE')
    assert.equal(query.model, unit)

    const one: any = Unit.one()

    query = one.query('count')
    assert.equal(query.action, 'COUNT')
    assert.equal(query.model, one)

    query = one.query('titles')
    assert.equal(query.action, 'TITLES')
    assert.equal(query.model, one)

    query = one.query('update')
    assert.equal(query.action, 'UPDATE')
    assert.equal(query.model, one)

    query = one.query('delete')
    assert.equal(query.action, 'DELETE')
    assert.equal(query.model, one)

    query = one.query()
    assert.equal(query.action, 'RETRIEVE')
    assert.equal(query.model, one)

    assert.ok(source instanceof MockSource)
  })
})
