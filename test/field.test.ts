import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Field, FieldError, bool, dict, float, int, list, set, str } from '../src/index.js'

describe('Field', () => {
  it('infers none from what else was given', () => {
    assert.equal(new Field(str).none, true)
    assert.equal(new Field(str, { default: 'a' }).none, false)
    assert.equal(new Field(str, { options: ['a'] }).none, false)
    assert.equal(new Field(str, false).none, false)
    assert.equal(new Field(list).none, false)
  })

  it('gives containers an empty default', () => {
    const field = new Field(list)
    field.name = 'tags'
    field.value = field.default()
    assert.deepEqual(field.value, [])
  })

  it('rejects a default of the wrong kind', () => {
    assert.throws(() => new Field(int, { default: 'nope' }), FieldError)
  })

  it('requires attr for a class kind', () => {
    class Point {}
    assert.throws(() => new Field(Point as any), FieldError)
  })

  it('validates names', () => {
    const field = new Field(str)

    assert.throws(() => (field.name = 'set'), FieldError)
    assert.throws(() => (field.name = 'a__b'), FieldError)
    assert.throws(() => (field.name = '_a'), FieldError)

    field.name = 'stuff'
    assert.equal(field.store, 'stuff')
  })

  it('casts on assignment', () => {
    const number = new Field(int)
    number.name = 'total'
    number.value = '5'
    assert.equal(number.value, 5)

    const flag = new Field(bool)
    flag.name = 'flag'
    flag.value = 'false'
    assert.equal(flag.value, false)

    const decimal = new Field(float)
    decimal.name = 'ratio'
    decimal.value = '1.5'
    assert.equal(decimal.value, 1.5)
  })

  it('enforces options and validation', () => {
    const status = new Field(str, { options: ['open', 'closed'] })
    status.name = 'status'

    status.value = 'open'
    assert.throws(() => (status.value = 'ajar'), FieldError)

    const code = new Field(str, { validation: /^[a-z]+$/ })
    code.name = 'code'

    code.value = 'abc'
    assert.throws(() => (code.value = 'A1'), FieldError)

    const even = new Field(int, { validation: (value: number) => value % 2 === 0 })
    even.name = 'even'

    even.value = 4
    assert.throws(() => (even.value = 3), FieldError)
  })

  it('exports sets in options order, otherwise sorted', () => {
    const tags = new Field(set, { options: ['b', 'a', 'c'] })
    tags.name = 'tags'
    tags.value = new Set(['c', 'a'])
    assert.deepEqual(tags.export(), ['a', 'c'])

    const free = new Field(set)
    free.name = 'free'
    free.value = new Set(['z', 'a'])
    assert.deepEqual(free.export(), ['a', 'z'])
  })

  it('flattens class kinds through attr', () => {
    class Point {
      x: number
      y: number
      constructor(values: { x: number; y: number }) {
        this.x = values.x
        this.y = values.y
      }
    }

    const point = new Field(Point, { attr: ['x', 'y'] })
    point.name = 'point'
    point.value = { x: 1, y: 2 }

    assert.ok(point.value instanceof Point)
    assert.deepEqual(point.export(), { x: 1, y: 2 })
    assert.deepEqual(point.titles, ['x', 'y'])
  })

  it('reads and writes through a path', () => {
    const meta = new Field(dict)
    meta.name = 'meta'
    meta.value = { a: { b: [1, 2] } }

    assert.equal(meta.access('a__b__1'), 2)

    meta.apply('a__b__0', 9)
    assert.deepEqual(meta.value, { a: { b: [9, 2] } })

    const flat = new Field(str)
    flat.name = 'flat'
    assert.throws(() => flat.access('a'), FieldError)
  })

  describe('criteria', () => {
    function matcher(kind: any, name: string, criterion: string, value: any) {
      const field = new Field(kind)
      field.name = name
      field.filter(value, criterion)
      return (stored: any) => field.retrieve({ [name]: stored })
    }

    it('compares scalars', () => {
      assert.equal(matcher(int, 'n', 'gt', 3)(4), true)
      assert.equal(matcher(int, 'n', 'gt', 3)(3), false)
      assert.equal(matcher(int, 'n', 'gte', 3)(3), true)
      assert.equal(matcher(int, 'n', 'lt', 3)(2), true)
      assert.equal(matcher(int, 'n', 'lte', 3)(3), true)
      assert.equal(matcher(int, 'n', 'eq', 3)(3), true)
      assert.equal(matcher(int, 'n', 'in', [1, 3])(3), true)
      assert.equal(matcher(int, 'n', 'not_in', [1, 3])(3), false)
    })

    it('matches text', () => {
      assert.equal(matcher(str, 's', 'like', 'ell')('Hello'), true)
      assert.equal(matcher(str, 's', 'start', 'he')('Hello'), true)
      assert.equal(matcher(str, 's', 'end', 'LO')('Hello'), true)
      assert.equal(matcher(str, 's', 'not_like', 'zz')('Hello'), true)
    })

    it('handles null', () => {
      const field = new Field(str)
      field.name = 's'
      field.filter(null)
      assert.equal(field.retrieve({ s: null }), true)
      assert.equal(field.retrieve({ s: 'a' }), false)
    })

    it('matches sets', () => {
      assert.equal(matcher(list, 'l', 'has', ['a', 'b'])(['a', 'b', 'c']), true)
      assert.equal(matcher(list, 'l', 'has', ['a', 'z'])(['a', 'b']), false)
      assert.equal(matcher(list, 'l', 'any', ['z', 'b'])(['a', 'b']), true)
      assert.equal(matcher(list, 'l', 'all', ['a', 'b'])(['a', 'b']), true)
      assert.equal(matcher(list, 'l', 'all', ['a'])(['a', 'b']), false)
    })

    it('reaches into containers', () => {
      assert.equal(matcher(dict, 'd', 'a__b__gt', 3)({ a: { b: 4 } }), true)
      assert.equal(matcher(dict, 'd', 'a__b', 4)({ a: { b: 4 } }), true)
    })

    it('refuses a path on a scalar', () => {
      const field = new Field(str)
      field.name = 's'
      assert.throws(() => field.filter(1, 'a__b'), FieldError)
    })
  })

  it('tracks changes for updates', () => {
    const field = new Field(str)
    field.name = 'name'

    field.read({ name: 'a' })
    assert.equal(field.delta(), false)

    field.value = 'b'
    assert.equal(field.delta(), true)

    const values: Record<string, any> = {}
    field.update(values)
    assert.deepEqual(values, { name: 'b' })
    assert.equal(field.delta(), false)
  })

  it('describes itself', () => {
    const field = new Field(str, { length: 20, options: ['a', 'b'] })
    field.name = 'letter'

    assert.deepEqual(field.define(), {
      kind: 'str',
      name: 'letter',
      store: 'letter',
      none: false,
      options: ['a', 'b'],
      length: 20
    })
  })
})
