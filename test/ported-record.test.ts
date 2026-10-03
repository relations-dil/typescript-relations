/**
 * Ported from python-relations test/test_relations/test_record.py
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Field, FieldError, Record, RecordError, dict, int, str } from '../src/index.js'

/** Stand-in for Python's ipaddress.IPv4Address, used by test_export. */
class IPv4Address {
  compressed: string

  constructor(value: any) {
    const address = typeof value === 'string' ? value : String(value?.address)
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

/** The Python TestRecord.setUp(). */
function setUp(): { record: Record; id: Field; name: Field } {
  const record = new Record()

  const id = new Field(int, { name: 'id', store: '_id' })
  const name = new Field(str, { name: 'name', store: '_name' })

  record.append(id)
  record.append(name)

  return { record, id, name }
}

describe('RecordError', () => {
  it('test___init__', () => {
    const error = new RecordError('unittest', 'oops')

    assert.equal(error.record, 'unittest')
    assert.equal(error.message, 'oops')
  })
})

describe('Record', () => {
  it('test___init__', () => {
    const record = new Record()

    assert.deepEqual(record._order, [])
    assert.equal(record._names.size, 0)
  })

  it('test_insert', () => {
    const record = new Record()

    const id = new Field(int, { name: 'id', store: '_id' })
    record.insert(0, id)
    assert.equal(record._order.length, 1)
    assert.equal(record._order[0], id)
    assert.deepEqual(record.keys(), ['id'])
    assert.equal(record.field('id'), id)

    const name = new Field(str, { name: 'name', store: '_name' })
    record.insert(0, name)
    assert.equal(record._order.length, 2)
    assert.equal(record._order[0], name)
    assert.equal(record._order[1], id)
    assert.deepEqual(record.keys(), ['name', 'id'])
    assert.equal(record.field('id'), id)
    assert.equal(record.field('name'), name)
  })

  it('test_append', () => {
    const record = new Record()

    const id = new Field(int, { name: 'id', store: '_id' })
    record.append(id)
    assert.equal(record._order.length, 1)
    assert.equal(record._order[0], id)
    assert.equal(record.field('id'), id)

    const name = new Field(str, { name: 'name', store: '_name' })
    record.append(name)
    assert.equal(record._order.length, 2)
    assert.equal(record._order[0], id)
    assert.equal(record._order[1], name)
    assert.equal(record.field('id'), id)
    assert.equal(record.field('name'), name)
  })

  // Python's Record.__setattr__; the TS port has no attribute access, so set() stands in.
  it('test___setattr__', () => {
    const { record, id } = setUp()

    record.set('id', '1')
    assert.equal(id.value, 1)

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    record.append(things)
    record.set('things__a__b__0____1', 'yep')
    assert.deepEqual(things.value, { a: { b: [{ '1': 'yep' }] } })
  })

  // Python's Record.__getattr__; the TS port has no attribute access, so get() stands in.
  it('test___getattr__', () => {
    const { record, id } = setUp()

    id.value = '1'
    assert.equal(record.get('id'), 1)

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    record.append(things)
    things.value = { a: { b: [{ '1': 'yep' }] } }
    assert.equal(record.get('things__a__b__0____1'), 'yep')

    // Python raises AttributeError from __getattr__; get() is __getitem__, which raises RecordError.
    assert.throws(() => record.get('nope'), RecordError)
  })

  it('test___len__', () => {
    const { record } = setUp()

    assert.equal(record.size, 2)
  })

  it('test___iter__', () => {
    const { record } = setUp()

    assert.deepEqual([...record], ['id', 'name'])
  })

  it('test_keys', () => {
    const { record } = setUp()

    record.set('id', 1)
    record.set('name', 'ya')

    assert.deepEqual(
      Object.fromEntries(record.keys().map((key) => [key, record.get(key)])),
      { id: 1, name: 'ya' }
    )
  })

  it('test___contains__', () => {
    const { record } = setUp()

    assert.equal(record.has(1), true)
    assert.equal(record.has(2), false)

    assert.equal(record.has('id'), true)
    assert.equal(record.has('nope'), false)
  })

  it('test___setitem__', () => {
    const { record, id, name } = setUp()

    record.set(0, '1')
    record.set('name', 'unit')
    assert.equal(id.value, 1)
    assert.equal(name.value, 'unit')

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    record.append(things)
    record.set('things__a__b__0____1', 'yep')
    assert.deepEqual(things.value, { a: { b: [{ '1': 'yep' }] } })

    assert.throws(() => record.set('nope', 1), RecordError)
  })

  it('test___getitem__', () => {
    const { record, id } = setUp()

    id.value = '1'
    assert.equal(record.get(0), 1)
    assert.equal(record.get('id'), 1)

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    record.append(things)
    things.value = { a: { b: [{ '1': 'yep' }] } }
    assert.equal(record.get('things__a__b__0____1'), 'yep')

    assert.throws(() => record.get('nope'), RecordError)
  })

  it('test_define', () => {
    const { record } = setUp()

    assert.deepEqual(record.define(), [
      {
        name: 'id',
        kind: 'int',
        store: '_id',
        none: true
      },
      {
        name: 'name',
        kind: 'str',
        store: '_name',
        none: true
      }
    ])
  })

  it('test_filter', () => {
    const { record, id } = setUp()

    const meta = new Field(dict, { name: 'meta' })
    record.append(meta)

    record.filter(0, '0')
    assert.equal(id.criteria!['eq'], 0)

    record.filter('id', '1')
    assert.equal(id.criteria!['eq'], 1)

    record.filter('id__not_eq', '2')
    assert.equal(id.criteria!['not_eq'], 2)

    record.filter('meta__a__not_eq', 2)
    assert.equal(meta.criteria!['a__not_eq'], 2)

    assert.throws(() => record.filter('nope', 0), RecordError)
  })

  it('test_export', () => {
    const { record } = setUp()

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    const push = new Field(str, { name: 'push', inject: 'things__a__b__0____1' })
    const ip = new Field(IPv4Address, { name: 'ip', attr: { compressed: 'address', __int__: 'value' } })

    record.append(things)
    record.append(push)
    record.append(ip)

    record.read({ _id: 1, _name: 'unit', _things: { a: { b: [{ '1': 'yep' }] } }, ip: '1.2.3.4' })

    assert.deepEqual(record.export(), {
      id: 1,
      name: 'unit',
      things: { a: { b: [{ '1': 'yep' }] } },
      push: 'yep',
      ip: {
        address: '1.2.3.4',
        value: 16909060
      }
    })
  })

  it('test_create', () => {
    const { record } = setUp()

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    const push = new Field(str, { name: 'push', inject: 'things__a__b__0____1' })

    record.append(things)
    record.append(push)

    record.set('id', 1)
    record.set('name', 'unit')
    record.set('things', {})
    record.set('push', 'yep')

    assert.deepEqual(record.create({}), {
      _id: 1,
      _name: 'unit',
      _things: { a: { b: [{ '1': 'yep' }] } }
    })
  })

  it('test_retrieve', () => {
    const { record } = setUp()

    record.filter('id', '1')
    record.filter('name', 'unit')

    assert.equal(record.retrieve({ _id: 1, _name: 'unit' }), true)
    assert.equal(record.retrieve({ _id: 2, _name: 'unit' }), false)
    assert.equal(record.retrieve({ _id: 1, _name: 'test' }), false)
  })

  it('test_like', () => {
    const { record } = setUp()

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    record.append(things)

    assert.equal(record.like({ _id: 1, _name: 'test' }, ['id', 'name'], 'unit', { _id: [1] }), true)
    assert.equal(record.like({ _id: 2, _name: 'unit' }, ['id', 'name'], 'unit', { _id: [1] }), true)
    assert.equal(record.like({ _id: 2, _name: 'test' }, ['id', 'name'], 'unit', { _id: [1] }), false)

    assert.equal(
      record.like(
        { _id: 1, _name: 'unit', _things: { a: { b: [{ '1': 'yep' }] } } },
        ['things__a__b__0____1'],
        'y',
        { things: [1] }
      ),
      true
    )
    assert.equal(
      record.like(
        { _id: 1, _name: 'unit', _things: { a: { b: [{ '1': 'yep' }] } } },
        ['things__a__b__0____1'],
        'n',
        { things: [1] }
      ),
      false
    )
  })

  it('test_read', () => {
    const { record } = setUp()

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    const push = new Field(str, { name: 'push', inject: 'things__a__b__0____1' })

    record.append(things)
    record.append(push)

    record.read({ _id: 1, _name: 'unit', _things: { a: { b: [{ '1': 'yep' }] } } })

    assert.equal(record.get('id'), 1)
    assert.equal(record.get('name'), 'unit')
    assert.deepEqual(record.get('things'), { a: { b: [{ '1': 'yep' }] } })
    assert.equal(record.get('push'), 'yep')
  })

  it('test_update', () => {
    const { record } = setUp()

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    const push = new Field(str, { name: 'push', inject: 'things__a__b__0____1' })

    record.append(things)
    record.append(push)

    assert.deepEqual(record.update({}), {})

    record.set('id', 1)
    record.set('name', 'unit')
    record.set('things', {})
    record.set('push', 'yep')

    things.original = {}

    assert.deepEqual(record.update({}), {
      _id: 1,
      _name: 'unit',
      _things: { a: { b: [{ '1': 'yep' }] } }
    })
  })

  it('test_mass', () => {
    const { record } = setUp()

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    const push = new Field(str, { name: 'push', inject: 'things__a__b__0____1' })

    record.append(things)
    record.append(push)

    assert.deepEqual(record.mass({}), {})

    record.set('id', 1)
    record.set('name', 'unit')

    assert.deepEqual(record.mass({}), { _id: 1, _name: 'unit' })

    record.set('things', {})
    record.set('push', 'yep')

    things.changed = false

    assert.throws(() => record.mass({}), FieldError)
  })

  it('test_tie', () => {
    const { record } = setUp()

    const tie = new Field(int, { name: 'tie', tied: true, changed: true, value: 1 })
    const untie = new Field(int, { name: 'untie', tied: false, changed: true })

    record.append(tie)
    record.append(untie)

    assert.deepEqual(record.tie({}), { tie: 1 })
  })
})

/**
 * The five inject tests above name the injected field "push", which Python allows but the
 * TS port reserves (Model.push exists in JavaScript). These mirror them with a legal name
 * so the marshalling behind them is still exercised.
 */
describe('Record (inject field renamed off the TS reserved list)', () => {
  it('test_export', () => {
    const { record } = setUp()

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    const shove = new Field(str, { name: 'shove', inject: 'things__a__b__0____1' })
    const ip = new Field(IPv4Address, { name: 'ip', attr: { compressed: 'address', __int__: 'value' } })

    record.append(things)
    record.append(shove)
    record.append(ip)

    record.read({ _id: 1, _name: 'unit', _things: { a: { b: [{ '1': 'yep' }] } }, ip: '1.2.3.4' })

    assert.deepEqual(record.export(), {
      id: 1,
      name: 'unit',
      things: { a: { b: [{ '1': 'yep' }] } },
      shove: 'yep',
      ip: {
        address: '1.2.3.4',
        value: 16909060
      }
    })
  })

  it('test_create', () => {
    const { record } = setUp()

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    const shove = new Field(str, { name: 'shove', inject: 'things__a__b__0____1' })

    record.append(things)
    record.append(shove)

    record.set('id', 1)
    record.set('name', 'unit')
    record.set('things', {})
    record.set('shove', 'yep')

    assert.deepEqual(record.create({}), {
      _id: 1,
      _name: 'unit',
      _things: { a: { b: [{ '1': 'yep' }] } }
    })
  })

  it('test_read', () => {
    const { record } = setUp()

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    const shove = new Field(str, { name: 'shove', inject: 'things__a__b__0____1' })

    record.append(things)
    record.append(shove)

    record.read({ _id: 1, _name: 'unit', _things: { a: { b: [{ '1': 'yep' }] } } })

    assert.equal(record.get('id'), 1)
    assert.equal(record.get('name'), 'unit')
    assert.deepEqual(record.get('things'), { a: { b: [{ '1': 'yep' }] } })
    assert.equal(record.get('shove'), 'yep')
  })

  it('test_update', () => {
    const { record } = setUp()

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    const shove = new Field(str, { name: 'shove', inject: 'things__a__b__0____1' })

    record.append(things)
    record.append(shove)

    assert.deepEqual(record.update({}), {})

    record.set('id', 1)
    record.set('name', 'unit')
    record.set('things', {})
    record.set('shove', 'yep')

    things.original = {}

    assert.deepEqual(record.update({}), {
      _id: 1,
      _name: 'unit',
      _things: { a: { b: [{ '1': 'yep' }] } }
    })
  })

  it('test_mass', () => {
    const { record } = setUp()

    const things = new Field(dict, { name: 'things', store: '_things', default: () => ({}) })
    const shove = new Field(str, { name: 'shove', inject: 'things__a__b__0____1' })

    record.append(things)
    record.append(shove)

    assert.deepEqual(record.mass({}), {})

    record.set('id', 1)
    record.set('name', 'unit')

    assert.deepEqual(record.mass({}), { _id: 1, _name: 'unit' })

    record.set('things', {})
    record.set('shove', 'yep')

    things.changed = false

    assert.throws(() => record.mass({}), FieldError)
  })
})
