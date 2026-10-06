/**
 * Port of test/test_relations/test_field.py to node:test.
 *
 * The Python suite leans on `ipaddress.IPv4Address` / `IPv4Network` as its stand-in for a
 * non-builtin ("class") field kind. There's no such thing in the standard library here, so
 * this file defines minimal equivalents with the same surface the tests touch:
 * `compressed`, `exploded`, `packed`, `__int__()` and `str()`.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Field, FieldError, bool, dict, float, int, list, set, str } from '../src/index.js'
import type { Place } from '../src/overscore.js'

/** Assert a FieldError is thrown, optionally matching the message. */
function throwsField(action: () => unknown, pattern?: RegExp): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof FieldError, `expected FieldError, got ${String(error)}`)
    if (pattern !== undefined) {
      assert.match((error as Error).message, pattern)
    }
    return true
  })
}

/** Python's overscore paths are strings; `title()` and `like()` are typed `Place[]` here. */
function path(text: string): Place[] {
  return text as unknown as Place[]
}

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

  get exploded(): string {
    return this.compressed
  }

  get packed(): string {
    return this.compressed
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

describe('FieldError', () => {
  it('captures the field and the message', () => {
    const error = new FieldError('unittest', 'oops')

    assert.equal(error.field, 'unittest')
    assert.equal(error.message, 'oops')
  })
})

describe('Field (ported)', () => {
  describe('constructor', () => {
    it('takes free form options', () => {
      let field = new Field(int, { unit: 'test' })
      assert.equal(field.kind, int)
      assert.equal(field.unit, 'test')
      assert.equal(field.none, true)
      assert.equal(field._none, null)
      assert.equal(field.attr, null)
      assert.equal(field.init, null)
      assert.equal(field.titles, null)
      assert.equal(field.format, null)

      // Python's positional-dict-as-kwargs form is just the options object here.
      field = new Field(int, { unit: 'test' })
      assert.equal(field.kind, int)
      assert.equal(field.unit, 'test')
      assert.equal(field.none, true)
    })

    it('takes a lone boolean as none', () => {
      const field = new Field(int, false)
      assert.equal(field.kind, int)
      assert.equal(field.none, false)
    })

    it('takes a positional default', () => {
      // Python: Field(int, 0) -> the first positional is `default`.
      const field = new Field(int, { default: 0 })
      assert.equal(field.kind, int)
      assert.equal(field.default, 0)
      assert.equal(field.none, false)
    })

    it('defaults containers to empty', () => {
      // Python asserts `field.default == list`, ie. the callable that makes an empty one.
      const lister = new Field(list)
      assert.equal(lister.kind, list)
      assert.equal(typeof lister.default, 'function')
      assert.deepEqual(lister.default(), [])
      assert.equal(lister.none, false)

      const dicter = new Field(dict)
      assert.equal(dicter.kind, dict)
      assert.equal(typeof dicter.default, 'function')
      assert.deepEqual(dicter.default(), {})
      assert.equal(dicter.none, false)
    })

    it('infers none from options and validation', () => {
      let field = new Field(int, { options: [] })
      assert.equal(field.kind, int)
      assert.equal(field.none, false)

      field = new Field(int, { validation: 'yep' })
      assert.equal(field.kind, int)
      assert.equal(field.none, false)
    })

    it('fills titles and init from attr', () => {
      let field = new Field(IPv4Address, { attr: 'compressed' })
      assert.equal(field.kind, IPv4Address)
      assert.equal(field.none, true)
      assert.deepEqual(field.attr, { compressed: 'compressed' })
      assert.deepEqual(field.init, { compressed: 'compressed' })
      assert.deepEqual(field.titles, ['compressed'])
      assert.deepEqual(field.format, [null])

      field = new Field(IPv4Address, { attr: 'compressed', init: 'exploded', titles: 'packed' })
      assert.equal(field.kind, IPv4Address)
      assert.equal(field.none, true)
      assert.deepEqual(field.attr, { compressed: 'compressed' })
      assert.deepEqual(field.init, { exploded: 'exploded' })
      assert.deepEqual(field.titles, ['packed'])
    })

    it('turns a lone extract into a path mapped to str', () => {
      const field = new Field(str, { extract: 'field__from' })
      assert.equal(field.kind, str)
      assert.equal(field.default, null)
      assert.deepEqual(Object.keys(field.extract ?? {}), ['field__from'])
      assert.equal(field.extract!['field__from'], str)
    })

    it('refuses nonsense', () => {
      throwsField(() => new Field(str, { name: 'opt', default: 1 }), /1 default not str for opt/)
      throwsField(() => new Field(str, { name: 'opt', options: [1] }), /1 option not str for opt/)
      throwsField(() => new Field(str, { name: 'val', validation: 1 as any }), /validation not regex or/)
      throwsField(() => new Field(IPv4Address), /IPv4Address requires at least attr/)
    })
  })

  describe('accessors', () => {
    it('fills store from name', () => {
      const field = new Field(int)
      field.name = 'id'
      assert.equal(field.kind, int)
      assert.equal(field.name, 'id')
      assert.equal(field.store, 'id')
    })

    it('leaves an explicit store alone', () => {
      const field = new Field(int, { store: '_id' })
      field.name = 'id'
      assert.equal(field.name, 'id')
      assert.equal(field.store, '_id')
    })

    it('refuses bad names', () => {
      const field = new Field(int, { store: '_id' })
      field.name = 'id'

      throwsField(() => (field.name = 'define'), /field name 'define' is reserved/)
      throwsField(() => (field.name = 'def__ine'), /field name 'def__ine' cannot contain '__'/)
      throwsField(() => (field.name = '_define'), /field name '_define' cannot start with '_'/)
    })

    it('casts and marks changed on set', () => {
      const field = new Field(int, { store: '_id' })
      field.name = 'id'

      field.value = '1'
      assert.equal(field.value, 1)
      assert.equal(field.changed, true)

      field.value = null
      assert.equal(field.value, null)
    })
  })

  describe('define', () => {
    it('describes a field with a default', () => {
      // NOTE: Python leans on bool being a subclass of int here, so `default=False`
      // is a valid int default there.
      const field = new Field(int, { name: 'test', default: 0 })
      assert.deepEqual(field.define(), {
        kind: 'int',
        name: 'test',
        store: 'test',
        none: false,
        default: 0
      })
    })

    it('skips a callable default', () => {
      // Python: Field(int, name="test", default=int) - the kind itself as a factory.
      const field = new Field(int, { name: 'test', default: () => int.empty() })
      assert.deepEqual(field.define(), {
        kind: 'int',
        name: 'test',
        store: 'test',
        none: false
      })
    })

    it('describes extracts by kind name', () => {
      const field = new Field(dict, {
        name: 'grab',
        extract: {
          a__b__0___1: bool,
          c__b__0___1: int,
          c__d__0___1: float,
          c__d__1___1: str,
          c__d__1___2: list
        }
      })
      assert.deepEqual(field.define(), {
        kind: 'dict',
        name: 'grab',
        store: 'grab',
        none: false,
        extract: {
          a__b__0___1: 'bool',
          c__b__0___1: 'int',
          c__d__0___1: 'float',
          c__d__1___1: 'str',
          c__d__1___2: 'list'
        }
      })
    })
  })

  describe('valid', () => {
    it('casts and enforces none', () => {
      const field = new Field(int, { name: 'id', none: false })
      assert.equal(field.valid('1'), 1)
      throwsField(() => field.valid(null), /not allowed for id/)
    })

    it('builds a class kind from a dict through init', () => {
      const field = new Field(IPv4Address, { store: 'ip', attr: { compressed: 'address' }, init: 'address' })
      assert.equal(field.valid({ address: '1.2.3.4' }).compressed, '1.2.3.4')
    })

    it('builds a class kind from a scalar', () => {
      const field = new Field(IPv4Address, { store: 'ip', attr: { compressed: 'address' }, init: 'address' })
      assert.equal(field.valid('1.2.3.4').compressed, '1.2.3.4')
    })

    it('builds a class kind through an init path', () => {
      const field = new Field(IPv4Address, {
        attr: { compressed: 'ip__address', __int__: 'ip__value' },
        init: { address: 'ip__address' }
      })
      assert.equal(field.valid({ ip: { address: '1.2.3.4' } }).compressed, '1.2.3.4')
    })

    it('lets a class kind be none', () => {
      const field = new Field(IPv4Address, { store: 'ip', attr: { compressed: 'address' }, init: 'address' })
      assert.equal(field.valid(null), null)
    })

    it('builds a class kind through a callable init', () => {
      const slurp = (value: any) => new IPv4Network(value.addy)

      const field = new Field(IPv4Network, { store: 'subnet', attr: { compressed: 'address' }, init: slurp })
      field.read({ subnet: { addy: '1.2.3.0/24' } })
      assert.equal(String(field.value), '1.2.3.0/24')
      assert.deepEqual(field.original, { address: '1.2.3.0/24' })
    })

    it('enforces options', () => {
      const field = new Field(int, { name: 'id', options: [1] })
      assert.equal(field.valid('1'), 1)
      throwsField(() => field.valid(2), /2 not in \[1\] for id/)
    })

    it('enforces options across a set', () => {
      const field = new Field(set, { name: 'id', options: [1] })
      assert.deepEqual(field.valid(new Set([1])), new Set([1]))
      throwsField(() => field.valid(new Set([2])), /2 not in \[1\] for id/)
    })

    it('enforces a regex validation', () => {
      const field = new Field(str, { name: 'name', validation: 'yep' })
      assert.equal(field.valid('yepyep'), 'yepyep')
      throwsField(() => field.valid('nope'), /doesn't match yep for name/)
    })

    it('enforces a callable validation', () => {
      const yeppers = (value: any) => String(value).includes('yep')

      const field = new Field(str, { name: 'name', validation: yeppers })
      assert.equal(field.valid('yepyep'), 'yepyep')
      throwsField(() => field.valid('nope'), /invalid for name/)
    })
  })

  describe('filter', () => {
    it('sets scalar criteria', () => {
      const field = new Field(int)

      field.filter('1')
      assert.equal(field.criteria!['eq'], 1)

      field.filter('1', 'eq')
      assert.equal(field.criteria!['eq'], 1)

      field.filter('1', 'not_eq')
      assert.equal(field.criteria!['not_eq'], 1)

      field.filter(null)
      assert.equal(field.criteria!['null'], true)

      field.filter('true', 'null')
      assert.equal(field.criteria!['null'], true)

      field.filter('true', 'not_null')
      assert.equal(field.criteria!['not_null'], true)

      field.filter('false', 'null')
      assert.equal(field.criteria!['null'], false)

      field.filter('no', 'null')
      assert.equal(field.criteria!['null'], false)

      field.filter('0', 'null')
      assert.equal(field.criteria!['null'], false)

      field.filter(0, 'null')
      assert.equal(field.criteria!['null'], false)

      field.filter(false, 'null')
      assert.equal(field.criteria!['null'], false)

      field.filter('1', 'gt')
      assert.equal(field.criteria!['gt'], 1)

      field.filter('1', 'not_gt')
      assert.equal(field.criteria!['not_gt'], 1)

      field.filter('1', 'gte')
      assert.equal(field.criteria!['gte'], 1)

      field.filter('1', 'lt')
      assert.equal(field.criteria!['lt'], 1)

      field.filter('1', 'lte')
      assert.equal(field.criteria!['lte'], 1)

      field.filter('1', 'like')
      assert.equal(field.criteria!['like'], 1)

      field.filter('1', 'start')
      assert.equal(field.criteria!['start'], 1)

      field.filter('1', 'end')
      assert.equal(field.criteria!['end'], 1)

      field.filter('1', 'in')
      assert.deepEqual(field.criteria!['in'], [1])
      field.filter(2.0, 'in')
      assert.deepEqual(field.criteria!['in'], [1, 2])
    })

    it('accumulates multi value criteria on a list', () => {
      const field = new Field(list)

      field.filter('1', 'has')
      assert.deepEqual(field.criteria!['has'], ['1'])
      field.filter('2', 'has')
      assert.deepEqual(field.criteria!['has'], ['1', '2'])

      field.filter('1', 'any')
      assert.deepEqual(field.criteria!['any'], ['1'])
      field.filter('2', 'any')
      assert.deepEqual(field.criteria!['any'], ['1', '2'])

      field.filter('1', 'all')
      assert.deepEqual(field.criteria!['all'], ['1'])
      field.filter('2', 'all')
      assert.deepEqual(field.criteria!['all'], ['1', '2'])
    })

    it('assumes eq for a bare path', () => {
      const field = new Field(dict)
      field.filter('1', 'a')
      assert.equal(field.criteria!['a__eq'], '1')
    })

    it('keeps an operator on a path', () => {
      const field = new Field(dict)
      field.filter('1', 'a__in')
      assert.deepEqual(field.criteria!['a__in'], ['1'])
    })

    it('refuses a path on a scalar kind', () => {
      const field = new Field(int)
      throwsField(() => field.filter(0, 'nope'), /no path .*nope.* with kind int/)
    })
  })

  describe('export', () => {
    it('exports a scalar as is', () => {
      const field = new Field(int)
      field.value = 1
      assert.equal(field.export(), 1)
    })

    it('exports a set sorted, or in options order', () => {
      const field = new Field(set)
      field.value = new Set(['people', 'stuff', 'things'])
      assert.deepEqual(field.export(), ['people', 'stuff', 'things'])

      field.options = ['stuff', 'people', 'things']
      field.value = new Set(['people', 'stuff'])
      assert.deepEqual(field.export(), ['stuff', 'people'])
    })

    it('exports a dict as a copy', () => {
      const field = new Field(dict)
      field.value = { a: 1 }
      const value = field.export()
      assert.deepEqual(value, { a: 1 })
      value['a'] = 2
      assert.deepEqual(field.export(), { a: 1 })
    })

    it('flattens a class kind through attr paths', () => {
      const field = new Field(IPv4Address, { attr: { compressed: 'ip__address', __int__: 'ip__value' } })
      field.value = '1.2.3.4'
      assert.deepEqual(field.export(), {
        ip: {
          address: '1.2.3.4',
          value: 16909060
        }
      })
    })

    it('flattens a class kind through a callable attr', () => {
      const hurl = (values: Record<string, any>, value: any) => {
        values['address'] = String(value)
        const minIp = value.at(0)
        const maxIp = value.at(-1)
        values['min_address'] = String(minIp)
        values['min_value'] = minIp.__int__()
        values['max_address'] = String(maxIp)
        values['max_value'] = maxIp.__int__()
      }

      const field = new Field(IPv4Network, { attr: hurl, init: 'address', titles: 'address' })
      field.value = '1.2.3.0/24'
      assert.deepEqual(field.export(), {
        address: '1.2.3.0/24',
        min_address: '1.2.3.0',
        min_value: 16909056,
        max_address: '1.2.3.255',
        max_value: 16909311
      })
    })
  })

  describe('apply', () => {
    it('refuses a scalar kind', () => {
      const field = new Field(int)
      field.value = 1
      throwsField(() => field.apply(0 as any, 0), /no apply for int/)
    })

    it('stores at a path on a class kind', () => {
      const field = new Field(IPv4Address, {
        attr: { compressed: 'ip__address', __int__: 'ip__value' },
        init: { address: 'ip__address' }
      })
      field.apply('ip__address', '1.2.3.4')
      assert.equal(field.access('ip__address'), '1.2.3.4')
    })
  })

  describe('access', () => {
    it('refuses a scalar kind', () => {
      const field = new Field(int)
      field.value = 1
      throwsField(() => field.access(0 as any), /no access for int/)
    })

    it('reads at a path on a class kind', () => {
      const field = new Field(IPv4Address, { attr: { compressed: 'ip__address', __int__: 'ip__value' } })
      field.value = '1.2.3.4'
      assert.equal(field.access('ip__address'), '1.2.3.4')
    })
  })

  describe('delta', () => {
    it('compares the export against the original', () => {
      const field = new Field(int)
      field.original = 0
      field.value = 1
      assert.equal(field.delta(), true)

      field.value = '0'
      assert.equal(field.delta(), false)
    })

    it('compares a class kind through its export', () => {
      const field = new Field(IPv4Address, { attr: { compressed: 'ip__address', __int__: 'ip__value' } })
      field.value = '1.2.3.4'
      assert.equal(field.delta(), true)

      field.original = field.export()
      field.value = new IPv4Address('1.2.3.4')
      assert.equal(field.delta(), false)
    })
  })

  describe('write', () => {
    it('writes to store', () => {
      const field = new Field(int, { store: '_id', default: -1, refresh: true })

      field.value = 1
      const values: Record<string, any> = {}
      field.write(values)
      assert.deepEqual(values, { _id: 1 })
    })

    it('writes a class kind as its export', () => {
      const field = new Field(IPv4Address, { store: 'ip', attr: { compressed: 'address', __int__: 'value' } })
      field.value = new IPv4Address('1.2.3.4')
      const values: Record<string, any> = {}
      field.write(values)
      assert.deepEqual(values, { ip: { address: '1.2.3.4', value: 16909060 } })
    })

    it('writes an injected field at its path', () => {
      const field = new Field(str, { inject: 'things__a__b__0____1' })
      field.value = 'yep'
      const values: Record<string, any> = {}
      field.write(values)
      assert.deepEqual(values, { a: { b: [{ '1': 'yep' }] } })
    })

    it('does not store an injected null, a missing key reads back as null', () => {
      const field = new Field(int, { inject: 'things__relations__owner__id' })
      field.value = null

      let values: Record<string, any> = {}
      field.write(values)
      assert.deepEqual(values, {})

      values = { relations: { owner: { id: 5, other: 1 } } }
      field.write(values)
      assert.deepEqual(values, { relations: { owner: { other: 1 } } })

      values = { relations: { owner: { id: 5 } } }
      field.write(values)
      assert.deepEqual(values, { relations: { owner: {} } })
    })

    it('still sets an injected null through a list', () => {
      const field = new Field(str, { inject: 'things__a__b__0____1' })
      field.value = null

      const values: Record<string, any> = { a: { b: [{ '1': 'yep' }] } }
      field.write(values)
      assert.deepEqual(values, { a: { b: [{ '1': null }] } })
    })

    it('writes nothing without a store', () => {
      const field = new Field(str, { store: false })
      field.value = 'yep'
      const values: Record<string, any> = {}
      field.write(values)
      assert.deepEqual(values, {})
    })
  })

  describe('create', () => {
    it('writes and keeps the original', () => {
      const field = new Field(int, { store: '_id' })

      field.value = 1
      const values: Record<string, any> = {}
      field.create(values)
      assert.deepEqual(values, { _id: 1 })
      assert.equal(field.original, 1)
    })

    it('skips an auto field', () => {
      const field = new Field(int, { store: '_id' })
      field.auto = true
      const values: Record<string, any> = {}
      field.create(values)
      assert.deepEqual(values, {})
      assert.equal(field.original, null)
    })
  })

  describe('retrieve', () => {
    it('matches null', () => {
      const field = new Field(str, { store: 'name' })
      field.filter('yes', 'null')
      assert.equal(field.retrieve({ name: null }), true)
      assert.equal(field.retrieve({ name: '' }), false)
    })

    it('matches not null through a false null', () => {
      const field = new Field(str, { store: 'name' })
      field.filter('no', 'null')
      assert.equal(field.retrieve({ name: '' }), true)
      assert.equal(field.retrieve({ name: null }), false)
    })

    it('matches an inverted null', () => {
      const field = new Field(str, { store: 'name' })
      field.filter('no', 'not_null')
      assert.equal(field.retrieve({ name: null }), true)
      assert.equal(field.retrieve({ name: '' }), false)
    })

    it('matches eq', () => {
      const field = new Field(int, { store: '_id' })
      field.filter('1')
      assert.equal(field.retrieve({ _id: '1' }), true)
      assert.equal(field.retrieve({ _id: '2' }), false)
    })

    it('matches gt', () => {
      const field = new Field(int, { store: '_id' })
      field.filter('1', 'gt')
      assert.equal(field.retrieve({ _id: '2' }), true)
      assert.equal(field.retrieve({ _id: '1' }), false)
    })

    it('matches gte', () => {
      const field = new Field(int, { store: '_id' })
      field.filter('1', 'gte')
      assert.equal(field.retrieve({ _id: '1' }), true)
      assert.equal(field.retrieve({ _id: '0' }), false)
    })

    it('matches lt', () => {
      const field = new Field(int, { store: '_id' })
      field.filter('1', 'lt')
      assert.equal(field.retrieve({ _id: '0' }), true)
      assert.equal(field.retrieve({ _id: '1' }), false)
    })

    it('matches lte', () => {
      const field = new Field(int, { store: '_id' })
      field.filter('1', 'lte')
      assert.equal(field.retrieve({ _id: '1' }), true)
      assert.equal(field.retrieve({ _id: '2' }), false)
    })

    it('matches like', () => {
      const field = new Field(str, { store: 'name' })
      field.filter('Yes', 'like')
      assert.equal(field.retrieve({ name: ' yES adsfadsf' }), true)
      assert.equal(field.retrieve({ name: 'no' }), false)
    })

    it('matches start', () => {
      const field = new Field(str, { store: 'name' })
      field.filter('Yes', 'start')
      assert.equal(field.retrieve({ name: 'yES adsfadsf' }), true)
      assert.equal(field.retrieve({ name: 'no yes' }), false)
    })

    it('matches end', () => {
      const field = new Field(str, { store: 'name' })
      field.filter('Yes', 'end')
      assert.equal(field.retrieve({ name: 'sure yes' }), true)
      assert.equal(field.retrieve({ name: 'yes no' }), false)
    })

    it('matches a dict path', () => {
      const field = new Field(dict, { store: 'meta' })
      field.filter(1, 'a')
      assert.equal(field.retrieve({ meta: { a: 1 } }), true)
      assert.equal(field.retrieve({ meta: { a: '1' } }), false)
    })

    it('matches a dict path with in', () => {
      const field = new Field(dict, { store: 'meta' })
      field.filter(1, 'a__in')
      assert.equal(field.retrieve({ meta: { a: 1 } }), true)
      assert.equal(field.retrieve({ meta: { a: '1' } }), false)
    })

    it('matches a dict path with not_eq', () => {
      const field = new Field(dict, { store: 'meta' })
      field.filter(1, 'a__not_eq')
      assert.equal(field.retrieve({ meta: { a: '1' } }), true)
      assert.equal(field.retrieve({ meta: { a: 1 } }), false)
    })

    it('matches a deep index path', () => {
      const field = new Field(dict, { store: 'meta' })
      field.filter(1, 'a__b__1__in')
      assert.equal(field.retrieve({ meta: { a: { b: [0, 1] } } }), true)
      assert.equal(field.retrieve({ meta: { a: { b: ['0', '1'] } } }), false)
      assert.equal(field.retrieve({ meta: {} }), false)
    })

    it('matches a deep numeric key path', () => {
      const field = new Field(dict, { store: 'meta' })
      field.filter(1, 'a__b____1__in')
      assert.equal(field.retrieve({ meta: { a: { b: { '1': 1 } } } }), true)
      assert.equal(field.retrieve({ meta: { a: { b: { '1': '1' } } } }), false)
      assert.equal(field.retrieve({ meta: {} }), false)
    })

    it('matches a leading numeric key path', () => {
      const field = new Field(dict, { store: 'meta' })
      field.filter(1, '__1__in')
      assert.equal(field.retrieve({ meta: { '1': 1 } }), true)
      assert.equal(field.retrieve({ meta: { '1': '1' } }), false)
      assert.equal(field.retrieve({ meta: {} }), false)
    })

    it('matches null at a path', () => {
      const field = new Field(dict, { store: 'meta' })
      field.filter(1, 'a__b__1__null')
      assert.equal(field.retrieve({ meta: { a: { b: [0, null] } } }), true)
      assert.equal(field.retrieve({ meta: {} }), true)
      assert.equal(field.retrieve({ meta: { a: { b: [0, '1'] } } }), false)
    })

    it('matches in on a scalar', () => {
      const field = new Field(int, { store: '_id' })
      field.filter('1', 'in')
      assert.equal(field.retrieve({ _id: '1' }), true)
      assert.equal(field.retrieve({ _id: '2' }), false)
    })

    it('matches in at a list index', () => {
      const field = new Field(list, { store: 'meta' })
      field.filter(1, '1__in')
      assert.equal(field.retrieve({ meta: [0, 1] }), true)
      assert.equal(field.retrieve({ meta: ['0', '1'] }), false)
      assert.equal(field.retrieve({ meta: [] }), false)
    })

    it('matches null at a list index', () => {
      const field = new Field(list, { store: 'meta' })
      field.filter(1, '1__null')
      assert.equal(field.retrieve({ meta: [0, null] }), true)
      assert.equal(field.retrieve({ meta: [] }), true)
      assert.equal(field.retrieve({ meta: ['0', '1'] }), false)
    })

    it('matches has', () => {
      const field = new Field(list, { store: 'meta' })
      field.filter('1', 'has')
      assert.equal(field.retrieve({ meta: ['1', '2'] }), true)
      assert.equal(field.retrieve({ meta: ['2'] }), false)
    })

    it('matches any', () => {
      const field = new Field(list, { store: 'meta' })
      field.filter(['1', '2'], 'any')
      assert.equal(field.retrieve({ meta: ['1'] }), true)
      assert.equal(field.retrieve({ meta: ['3'] }), false)
    })

    it('matches all', () => {
      const field = new Field(list, { store: 'meta' })
      field.filter(['1', '2'], 'all')
      assert.equal(field.retrieve({ meta: ['1', '2'] }), true)
      assert.equal(field.retrieve({ meta: ['3', '2', '1'] }), false)
    })
  })

  describe('like', () => {
    it('matches a scalar and parents', () => {
      const field = new Field(int, { store: '_id' })
      assert.equal(field.like({ _id: '1' }, 1, {}), true)
      assert.equal(field.like({ _id: '2' }, 1, {}), false)
      assert.equal(field.like({ _id: '1' }, null, { _id: [1] }), true)
      assert.equal(field.like({ _id: '2' }, null, { _id: [1] }), false)
    })

    it('matches text case insensitively', () => {
      const field = new Field(str, { store: 'name' })
      assert.equal(field.like({ name: ' yES adsfadsf' }, 'Yes', {}), true)
      assert.equal(field.like({ name: 'no' }, 'Yes', {}), false)
    })

    it('matches a class kind through its titles', () => {
      const field = new Field(IPv4Address, { store: 'ip', attr: { compressed: 'address' }, titles: 'address' })
      assert.equal(field.like({ ip: { address: '1.2.3.4' } }, '1.2.3.', {}), true)
      assert.equal(field.like({ ip: { address: '1.2.3.4' } }, '1.2.3.', {}, path('address')), true)
      assert.equal(field.like({ ip: { address: '1.2.3.4' } }, '1.3.2.', {}), false)
      assert.equal(field.like({}, '1.3.2.4', {}), false)
    })
  })

  describe('read', () => {
    it('loads from store without a delta', () => {
      const field = new Field(int, { store: '_id' })
      field.read({ _id: '1' })
      assert.equal(field.value, 1)
      assert.equal(field.delta(), false)
    })

    it('loads an injected field from its path', () => {
      const field = new Field(str, { inject: 'things__a__b__0____1' })
      field.read({ a: { b: [{ '1': 'yep' }] } })
      assert.equal(field.value, 'yep')
      assert.equal(field.delta(), false)
    })
  })

  describe('title', () => {
    it('titles a bool', () => {
      const field = new Field(bool)
      field.value = false
      assert.deepEqual(field.title(), [false])
    })

    it('titles an int', () => {
      const field = new Field(int)
      field.value = 1
      assert.deepEqual(field.title(), [1])
    })

    it('titles a float', () => {
      const field = new Field(float)
      field.value = 1.0
      assert.deepEqual(field.title(), [1.0])
    })

    it('titles a str', () => {
      const field = new Field(str)
      field.value = 'yep'
      assert.deepEqual(field.title(), ['yep'])
    })

    it('titles a list, whole or at a path', () => {
      const field = new Field(list)
      field.value = [1, 2, [3, 4]]
      assert.deepEqual(field.title(), [[1, 2, [3, 4]]])
      assert.deepEqual(field.title(path('2__1')), [4])
    })

    it('titles a dict, whole or at a path', () => {
      const field = new Field(dict)
      field.value = { a: { b: [{ '1': 'yep' }] } }
      assert.deepEqual(field.title(), [{ a: { b: [{ '1': 'yep' }] } }])
      assert.deepEqual(field.title(path('a__b__0____1')), ['yep'])
    })

    it('titles a class kind from its titles', () => {
      const field = new Field(IPv4Address, {
        attr: { compressed: 'ip__address', __int__: 'ip__value' },
        titles: ['ip__address', 'ip__value']
      })
      field.value = '1.2.3.4'
      assert.deepEqual(field.title(path('ip__value')), [16909060])
      assert.deepEqual(field.title(), ['1.2.3.4', 16909060])
    })
  })

  describe('update', () => {
    it('writes only when changed, and refreshes', () => {
      const field = new Field(int, { store: '_id' })

      field.value = 1
      field.original = 2
      let values: Record<string, any> = {}
      field.update(values)
      assert.deepEqual(values, { _id: 1 })
      assert.equal(field.original, 1)

      values = {}
      field.update(values)
      assert.deepEqual(values, {})
      assert.equal(field.original, 1)

      field.refresh = true
      field.default = 2
      values = {}
      field.update(values)
      assert.deepEqual(values, { _id: 2 })
      assert.equal(field.value, 2)
      assert.equal(field.original, 2)

      field.value = 1
      values = {}
      field.update(values)
      assert.deepEqual(values, { _id: 1 })
      assert.equal(field.original, 1)
    })

    it('updates a class kind through its export', () => {
      const field = new Field(IPv4Address, { store: 'ip', attr: { compressed: 'address', __int__: 'value' } })
      field.value = new IPv4Address('1.2.3.4')
      const values: Record<string, any> = {}
      field.update(values)
      assert.deepEqual(values, { ip: { address: '1.2.3.4', value: 16909060 } })
      assert.deepEqual(field.original, { address: '1.2.3.4', value: 16909060 })
    })
  })

  describe('mass', () => {
    it('writes only what was set, and refreshes', () => {
      const field = new Field(int, { store: '_id' })

      field.value = 1
      field.changed = true
      let values: Record<string, any> = {}
      field.mass(values)
      assert.deepEqual(values, { _id: 1 })

      field.changed = false
      values = {}
      field.mass(values)
      assert.deepEqual(values, {})

      field.refresh = true
      field.default = 2
      values = {}
      field.mass(values)
      assert.deepEqual(values, { _id: 2 })
      assert.equal(field.value, 2)

      field.value = 1
      values = {}
      field.mass(values)
      assert.deepEqual(values, { _id: 1 })
    })

    it('refuses a mass update on an injected field', () => {
      const field = new Field(IPv4Address, { store: 'ip', attr: { compressed: 'address', __int__: 'value' } })
      field.value = new IPv4Address('1.2.3.4')
      const values: Record<string, any> = {}
      field.mass(values)
      assert.deepEqual(values, { ip: { address: '1.2.3.4', value: 16909060 } })

      ;(field as any).inject = true
      throwsField(() => field.mass({}), /no mass update with inject/)
    })
  })

  describe('tie', () => {
    it('writes only a changed, tied field', () => {
      const field = new Field(int, { name: 'tie', tied: true })
      let values: Record<string, any> = {}
      field.tie(values)
      assert.deepEqual(values, {})

      field.value = 1
      field.changed = true
      values = {}
      field.tie(values)
      assert.deepEqual(values, { tie: 1 })

      values = {}
      field.changed = false
      field.tie(values)
      assert.deepEqual(values, {})

      field.changed = true
      field.tied = false
      values = {}
      field.tie(values)
      assert.deepEqual(values, {})
    })
  })
})
