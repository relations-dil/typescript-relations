/**
 * Edge cases and error paths, written to keep the whole library at 100% line, branch and
 * function coverage. Each test says something true about behaviour; none of them exist
 * only to touch a line.
 */

import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as library from '../src/index.js'
import {
  Field,
  Migrations,
  MigrationsError,
  ManyToMany,
  MockSource,
  Model,
  OneToOne,
  OneToMany,
  Source,
  bool,
  clear,
  definitionsOf,
  dict,
  fields,
  float,
  int,
  list,
  modelFrom,
  modelsFrom,
  register,
  set,
  source,
  str,
  unregister,
  type RelationDefinition
} from '../src/index.js'
import { KINDS, kindName } from '../src/kinds.js'
import { construct, toField } from '../src/model.js'
import { Titles } from '../src/titles.js'
import * as overscore from '../src/overscore.js'
import { Record as FieldRecord } from '../src/record.js'
import { lookup } from '../src/source.js'
import { pretty } from '../src/migrations.js'
import { clone, compare, equal, stable } from '../src/util.js'

describe('kinds', () => {
  it('casts to bool', () => {
    assert.equal(bool.cast('No'), false)
    assert.equal(bool.cast('0'), false)
    assert.equal(bool.cast(''), false)
    assert.equal(bool.cast('yes'), true)
    assert.equal(bool.cast(0), false)
    assert.equal(bool.cast([1]), true)
    assert.equal(bool.empty(), false)
  })

  it('casts to int', () => {
    assert.equal(int.cast(true), 1)
    assert.equal(int.cast(false), 0)
    assert.equal(int.cast('7.9'), 7)
    assert.equal(int.cast(-7.9), -7)
    assert.equal(int.empty(), 0)
    assert.throws(() => int.cast(''), /cannot cast "" to int/)
    assert.throws(() => int.cast('abc'), /cannot cast "abc" to int/)
    assert.throws(() => int.cast({}), /to int/)
    assert.throws(() => int.cast(undefined), /cannot cast undefined to int/)
  })

  it('casts to float', () => {
    assert.equal(float.cast(true), 1)
    assert.equal(float.cast('7.5'), 7.5)
    assert.equal(float.empty(), 0)
    assert.throws(() => float.cast(''), /to float/)
    assert.throws(() => float.cast('abc'), /to float/)
    assert.throws(() => float.cast([]), /to float/)
  })

  it('casts to str', () => {
    assert.equal(str.cast(5), '5')
    assert.equal(str.cast({ a: 1 }), '{"a":1}')
    assert.equal(str.cast([1, 2]), '[1,2]')
    assert.equal(str.empty(), '')
    assert.throws(() => str.cast(null), /cannot cast null to str/)
    assert.throws(() => str.cast(undefined), /cannot cast undefined to str/)
  })

  it('casts to set', () => {
    const existing = new Set([1])

    assert.equal(set.cast(existing), existing)
    assert.deepEqual(set.cast([1, 1, 2]), new Set([1, 2]))
    assert.deepEqual(set.cast('a'), new Set(['a']))
    assert.deepEqual(set.cast(new Map([[1, 2]]).keys()), new Set([1]))
    assert.deepEqual(set.empty(), new Set())
    assert.throws(() => set.cast(5), /cannot cast 5 to set/)
    assert.throws(() => set.cast(null), /cannot cast null to set/)
  })

  it('casts to list', () => {
    const existing = [1]

    assert.equal(list.cast(existing), existing)
    assert.deepEqual(list.cast(new Set([3, 1, 2])), [1, 2, 3])
    assert.deepEqual(list.cast(new Map([[1, 2]])), [[1, 2]])
    assert.deepEqual(list.empty(), [])
    assert.throws(() => list.cast(5), /cannot cast 5 to list/)
    assert.throws(() => list.cast('abc'), /to list/)
    assert.throws(() => list.cast(null), /to list/)
    assert.throws(() => list.cast({}), /to list/)
  })

  it('casts to dict', () => {
    const existing = { a: 1 }

    assert.equal(dict.cast(existing), existing)
    assert.deepEqual(dict.cast(new Map([['a', 1]])), { a: 1 })
    assert.deepEqual(dict.empty(), {})
    assert.throws(() => dict.cast([1]), /cannot cast \[1\] to dict/)
    assert.throws(() => dict.cast('a'), /to dict/)
  })

  it('names kinds, falling back to object for anonymous classes', () => {
    assert.equal(kindName(int), 'int')
    assert.equal(kindName(Date), 'Date')
    assert.equal(kindName(class {}), 'object')
    assert.equal(KINDS.set, set)
  })
})

describe('util', () => {
  it('clones sets, maps, dates, and leaves other objects alone', () => {
    const inner = { a: 1 }
    const original = new Set([inner])
    const copy = clone(original)

    assert.notEqual(copy, original)
    assert.notEqual([...copy][0], inner)
    assert.deepEqual([...copy][0], inner)

    const when = new Date(5)
    assert.notEqual(clone(when), when)
    assert.equal(clone(when).getTime(), 5)

    const map = new Map([['k', { a: 1 }]])
    assert.notEqual(clone(map).get('k'), map.get('k'))

    class Odd {}
    const odd = new Odd()
    assert.equal(clone(odd), odd)
  })

  it('compares null, undefined and booleans', () => {
    assert.equal(compare(null, 1), -1)
    assert.equal(compare(undefined, 'a'), -1)
    assert.equal(compare(1, null), 1)
    assert.equal(compare('a', undefined), 1)
    assert.equal(compare(true, false), 1)
    assert.equal(compare(false, true), -1)
    assert.equal(compare('a', 'b'), -1)
    assert.equal(compare('b', 'a'), 1)
    assert.equal(compare(1, '1'), 0)
  })

  it('has a stable form that sorts sets', () => {
    assert.equal(stable({ b: new Set([3, 1, 2]), a: 1 }), '{"a":1,"b":[1,2,3]}')
  })

  it('treats null and undefined as equal, and sets by membership', () => {
    assert.ok(equal(null, undefined))
    assert.ok(!equal(null, 0))
    assert.ok(equal(new Set([1, 2]), new Set([2, 1])))
    assert.ok(!equal(new Set([1]), new Set([2])))
    assert.ok(!equal(new Set([1]), new Set([1, 2])))
    assert.ok(!equal(new Set([1]), [1]))
    assert.ok(!equal([1], new Set([1])))
    assert.ok(!equal([1], [1, 2]))
    assert.ok(!equal({ a: 1 }, { b: 1 }))
    assert.ok(!equal({ a: 1 }, { a: 1, b: 2 }))
  })
})

describe('overscore', () => {
  it('reads undefined values as null and recognises null-prototype objects', () => {
    assert.equal(overscore.get({ a: undefined }, 'a'), null)
    assert.ok(overscore.isDict(Object.create(null)))
    assert.ok(!overscore.isDict(new Map()))
  })

  it('refuses to set inside a scalar', () => {
    assert.throws(() => overscore.set({ a: 1 }, 'a__b', 2), /cannot set b on 1/)
  })
})

describe('registry', () => {
  beforeEach(clear)

  it('unregisters sources', () => {
    new MockSource('gone')

    assert.ok(source('gone'))
    assert.equal(unregister('gone'), true)
    assert.equal(source('gone'), undefined)
    assert.equal(unregister('gone'), false)
    assert.equal(source(null), undefined)
    assert.equal(source(undefined), undefined)

    register({ name: 'back' })
    assert.ok(source('back'))
  })
})

describe('models()', () => {
  it('finds the model classes a module exports', () => {
    class Plain {}
    class Base extends Model {}
    class Unit extends Base {}
    class Other extends Model {}

    const found = library.models({ Model, Plain, Base, Unit, Other, answer: 42, nothing: null })

    assert.deepEqual(found, [Base, Unit, Other])
  })

  it('takes another base class', () => {
    class Base extends Model {}
    class Unit extends Base {}

    assert.deepEqual(library.models({ Base, Unit }, Base), [Unit])
  })
})

describe('records', () => {
  const record = () => {
    const made = new FieldRecord()
    made.append(new Field(int, { name: 'id' } as any))
    made.append(new Field(str, { name: 'name' } as any))
    return made
  }

  it('finds fields from the end with negative positions', () => {
    const made = record()

    assert.equal(made.field(-1)?.name, 'name')
    assert.equal(made.field(0)?.name, 'id')
  })

  it('rejects positions past the end', () => {
    const made = record()

    assert.throws(() => made.set(5, 'x'), /unknown field '5'/)
    assert.throws(() => made.get(5), /unknown field '5'/)
  })
})

describe('sources', () => {
  it('does nothing by default', async () => {
    clear()
    const base = new Source('base')
    const model = {} as any

    assert.equal(await base.delete(model), 0)
    assert.equal(await base.migrate('x'), false)
    assert.deepEqual(await base.list('x'), {})
    assert.equal(await base.definition('a', 'b'), undefined)
    assert.equal(await base.migration('a', 'b'), undefined)
    assert.equal(await base.execute('x'), undefined)
    assert.equal(await base.load('x'), undefined)
  })

  it('applies record changes that carry only some of add, remove and change', () => {
    clear()
    const calls: string[] = []

    class Tracking extends Source {
      fieldAdd(migration: any) {
        calls.push(`add ${migration.name}`)
      }
      fieldRemove(definition: any) {
        calls.push(`remove ${definition.name}`)
      }
      fieldChange(definition: any) {
        calls.push(`change ${definition.name}`)
      }
    }

    const tracking = new Tracking('tracking')
    const definition = [{ name: 'a' }, { name: 'b' }]

    tracking.recordChange(definition, {})
    assert.deepEqual(calls, [])

    tracking.recordChange(definition, { add: [{ name: 'c' }], remove: ['a'], change: { b: {} } })
    assert.deepEqual(calls, ['add c', 'remove a', 'change b'])
  })

  it('looks fields up by name', () => {
    assert.deepEqual(lookup('b', [{ name: 'a' }, { name: 'b' }]), { name: 'b' })
    assert.equal(lookup('c', [{ name: 'a' }]), null)
  })
})

describe('definitions from data', () => {
  beforeEach(() => {
    clear()
    new MockSource('example')
  })

  const unit = {
    source: 'example',
    name: 'unit',
    fields: [
      { kind: 'int', name: 'id', store: 'id', auto: true },
      { kind: 'str', name: 'name', store: 'name', none: false }
    ]
  }

  const test = {
    source: 'example',
    name: 'test',
    fields: [
      { kind: 'int', name: 'id', store: 'id', auto: true },
      { kind: 'int', name: 'unit_id', store: 'unit_id' },
      { kind: 'str', name: 'name', store: 'name', none: false }
    ]
  }

  it('maps extract kinds by name, defaulting to str', () => {
    const Built = modelFrom({
      source: 'example',
      name: 'thing',
      fields: [
        { kind: 'int', name: 'id', store: 'id', auto: true },
        { kind: 'dict', name: 'data', store: 'data', extract: { 'a': 'int', 'b': 'nonsense' } }
      ]
    })

    const extract = Built.thy()._fields.field('data')?.extract as Record<string, unknown>

    assert.equal(extract.a, int)
    assert.equal(extract.b, str)
  })

  it('carries every model setting through', () => {
    const Built = modelFrom({
      source: 'example',
      name: 'thing',
      title: 'Thingy',
      tie: true,
      id: 'id',
      titles: ['name'],
      list: ['id', 'name'],
      unique: { name: ['name'] },
      index: { name: ['name'] },
      order: ['name'],
      chunk: 7,
      fields: [
        { kind: 'int', name: 'id', store: 'id', auto: true },
        { kind: 'str', name: 'name', store: 'name', none: false }
      ]
    })

    const identity = Built.thy()

    assert.equal(Built.name, 'Thingy')
    assert.deepEqual(identity._titles, ['name'])
    assert.deepEqual(identity._list, ['id', 'name'])
    assert.deepEqual(identity._unique, { name: ['name'] })
    assert.deepEqual(identity._index, { name: ['name'] })
    assert.deepEqual(identity._order, ['+name'])
    assert.equal(identity.CHUNK, 7)
    assert.equal(Built.TIE, true)
  })

  it('names models by key and falls back to the base source', () => {
    class Base extends Model {
      static source = 'example'
    }

    const built = modelsFrom({ thing: { fields: [{ kind: 'int', name: 'id', auto: true }] } as any }, { base: Base as any })

    assert.equal(built.thing.store, 'thing')
    assert.equal(built.thing.source, 'example')
  })

  it('accepts definitions as a list, and wires every kind of relation', () => {
    const sis = {
      source: 'example',
      name: 'sis',
      id: 'id',
      fields: [
        { kind: 'int', name: 'id', store: 'id', auto: true },
        { kind: 'str', name: 'name', store: 'name', none: false },
        { kind: 'list', name: 'bro_id' }
      ]
    }
    const bro = {
      source: 'example',
      name: 'bro',
      id: 'id',
      fields: [
        { kind: 'int', name: 'id', store: 'id', auto: true },
        { kind: 'str', name: 'name', store: 'name', none: false },
        { kind: 'list', name: 'sis_id' }
      ]
    }
    const tie = {
      source: 'example',
      name: 'tie',
      id: null,
      fields: [
        { kind: 'int', name: 'sis_id', store: 'sis_id' },
        { kind: 'int', name: 'bro_id', store: 'bro_id' }
      ]
    }
    const other = {
      source: 'example',
      name: 'other',
      fields: [
        { kind: 'int', name: 'id', store: 'id', auto: true },
        { kind: 'int', name: 'test_id', store: 'test_id' },
        { kind: 'str', name: 'name', store: 'name', none: false }
      ]
    }
    const relations: RelationDefinition[] = [
      { kind: 'OneToMany', parent: 'unit', child: 'test' },
      { kind: 'OneToOne', parent: 'test', child: 'other' },
      { kind: 'ManyToMany', sister: 'sis', brother: 'bro', tie: 'tie' }
    ]
    for (const each of [unit, test, other]) {
      ;(each as any).id = 'id'
    }

    const built = modelsFrom([unit, test, other, sis, bro, tie] as any, { relations })

    assert.deepEqual(Object.keys(built.unit.thy().CHILDREN), ['test'])
    assert.deepEqual(Object.keys(built.test.thy().CHILDREN), ['other'])
    assert.deepEqual(Object.keys(built.sis.thy().BROTHERS), ['bro'])
  })

  it('rejects unknown relation kinds and unknown models', () => {
    assert.throws(
      () => modelsFrom({ unit, test } as any, { relations: [{ kind: 'ManyToNone' } as any] }),
      /unknown relation kind 'ManyToNone'/
    )
    assert.throws(
      () => modelsFrom({ unit } as any, { relations: [{ kind: 'OneToMany', parent: 'unit', child: 'nope' }] }),
      /unknown model 'nope'/
    )
    assert.throws(() => modelsFrom({ unit } as any, { relations: [{ kind: 'OneToMany', child: 'unit' }] }), /unknown model/)
    assert.throws(() => modelFrom({ name: 'x', fields: [{ kind: 'nope', name: 'a' }] }), /unknown kind 'nope'/)
  })

  it('round trips definitions', () => {
    const built = modelsFrom({ unit, test } as any)

    assert.deepEqual(Object.keys(definitionsOf(Object.values(built))), ['unit', 'test'])
  })

  it('tolerates a definition with no fields', () => {
    const Empty = modelFrom({ name: 'empty' } as any)

    assert.deepEqual(Empty.thy()._fields.keys(), [])
  })
})

describe('field edge cases', () => {
  it('reports regular expression validation by source in a definition', () => {
    const field = new Field(str, { name: 'code', validation: /^a+$/ } as any)

    assert.equal(field.define().validation, '^a+$')
  })

  it('keeps string validation as it is in a definition', () => {
    const field = new Field(str, { name: 'code', validation: '^a+$' } as any)

    assert.equal(field.define().validation, '^a+$')
  })

  it('wraps cast failures in a field error', () => {
    const field = new Field(int, { name: 'amount' } as any)

    assert.throws(() => field.valid('abc'), /"abc" invalid for amount: cannot cast "abc" to int/)
  })

  it('matches membership in strings, objects and sets', () => {
    const text = new Field(str, { name: 'text' } as any)
    text.filter(['a'], 'has')
    assert.ok(text.retrieve({ text: 'cat' }))
    assert.ok(!text.retrieve({ text: 'dog' }))

    const data = new Field(dict, { name: 'data' } as any)
    data.filter(['a'], 'x__has')
    assert.ok(data.retrieve({ data: { x: { a: 1 } } }))
    assert.ok(!data.retrieve({ data: { x: { b: 1 } } }))

    const number = new Field(int, { name: 'number' } as any)
    number.filter([1], 'has')
    assert.ok(!number.retrieve({ number: 1 }))
  })

  it('counts entries for all', () => {
    const data = new Field(dict, { name: 'data' } as any)
    data.filter(['a'], 'x__all')
    assert.ok(data.retrieve({ data: { x: { a: 1 } } }))
    assert.ok(!data.retrieve({ data: { x: { a: 1, b: 2 } } }))

    const text = new Field(str, { name: 'text' } as any)
    text.filter(['a'], 'all')
    assert.ok(text.retrieve({ text: 'a' }))

    const things = new Field(set, { name: 'things' } as any)
    things.filter(['a'], 'all')
    assert.ok(things.retrieve({ things: ['a'] }))
    assert.ok(!things.retrieve({ things: ['a', 'b'] }))
  })
})

describe('migrations without sources', () => {
  it('refuses to work with a source that is not registered', async () => {
    clear()
    const migrations = new Migrations(await mkdtemp(join(tmpdir(), 'relations-')))

    assert.throws(() => migrations.sourcePath('nope'), MigrationsError)
    await assert.rejects(migrations.convert('nope'), MigrationsError)
    await assert.rejects(migrations.list('nope'), MigrationsError)
    await assert.rejects(migrations.load('nope', 'file.json'), MigrationsError)
    await assert.rejects(migrations.apply('nope'), MigrationsError)
  })

  it('passes on file errors other than a missing definition', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'relations-'))
    await writeFile(join(directory, 'definition.json'), '{nope')

    await assert.rejects(new Migrations(directory).current(), SyntaxError)
  })

  it('refuses renames that are not in the changes', () => {
    assert.throws(
      () => Migrations.rename(() => ({ gone: 'new' }), 'unit', ['added'], ['removed']),
      /unit rename gone to new is not in the changes/
    )
    assert.throws(
      () => Migrations.rename(() => ({ removed: 'new' }), 'unit', ['added'], ['removed']),
      /unit rename removed to new is not in the changes/
    )
  })
})

describe('relations', () => {
  it('has the one-to-many registered', () => {
    class Base extends Model {
      static source = 'example'
    }
    class Parent extends fields({ id: int, name: str }, Base) {}
    class Child extends fields({ id: int, parent_id: int, name: str }, Base) {}

    new OneToMany(Parent, Child)

    assert.equal(Object.keys(Parent.thy().CHILDREN).length, 1)
  })
})

describe('model construction', () => {
  class Base extends Model {
    static source = 'covered'
  }
  class Unit extends fields({ id: int, name: str, data: dict }, Base) {
    declare test: Test
  }
  class Test extends fields({ id: int, unit_id: int, name: str }, Base) {
    static unique = {}
    declare unit: Unit
    declare case: Case
  }
  class Case extends fields({ id: int, test_id: int, name: str }, Base) {
    static unique = {}
    declare test: Test
  }

  new OneToMany(Unit, Test)
  new OneToOne(Test, Case)

  beforeEach(() => {
    clear()
    new MockSource('covered')
  })

  it('takes relations options alongside field values', () => {
    const unit = new Unit('yep', { _chunk: 5 })

    assert.equal(unit._chunk, 5)
    assert.equal(unit.name, 'yep')
    assert.deepEqual(unit.export(), { id: null, name: 'yep', data: {} })
  })

  it('types fields declared as functions by what they return', () => {
    assert.equal(toField(() => true).kind, bool)
    assert.equal(toField(() => 1).kind, int)
    assert.equal(toField(() => 1.5).kind, float)
    assert.equal(toField(() => 'a').kind, str)
    assert.equal(toField(() => new Set()).kind, set)
    assert.equal(toField(() => []).kind, list)
    assert.equal(toField(() => ({})).kind, dict)
  })

  it('refuses fields it cannot make', () => {
    assert.throws(() => toField([]), /needs at least one option/)
    assert.throws(() => toField(class Odd {} as any), /class kinds need attr/)
    assert.throws(() => toField(5 as any), /cannot make a field from 5/)
  })

  it('fills in nothing for a model with no fields', () => {
    class Bare extends Model {
      static id = null
    }

    assert.deepEqual(Bare.thy()._fields.keys(), [])
    assert.deepEqual(Bare.thy().PARENTS, {})
  })

  it('takes an empty list of indexes', () => {
    class Plain extends fields({ id: int, name: str }, Base) {
      static index = []
    }

    assert.deepEqual(Plain.thy()._index, {})
  })

  it('takes a list of fields to list', () => {
    class Listed extends fields({ id: int, name: str, note: str }, Base) {
      static list = ['name', 'note']
    }

    assert.deepEqual(Listed.thy()._list, ['name', 'note'])
  })

  it('has no source to talk to until one is registered', async () => {
    clear()

    await assert.rejects(new Unit({ name: 'yep' }).create(), /no source registered as 'covered'/)
    assert.throws(() => Unit.define(), /no source registered as 'covered'/)
  })

  it('builds from the inside with no mode', async () => {
    const detached = construct(Test, { parent: { unit_id: null } })

    assert.equal(detached._mode, null)
    assert.equal(detached._action, 'create')
    assert.equal(detached.size, 0)
    assert.deepEqual(detached.models, [])
    assert.deepEqual(detached.export(), [])
    assert.deepEqual([...detached], [])
    assert.throws(() => detached._item('name'), /no records/)
    assert.throws(() => detached._setItem('name', 'x'), /no records/)
    assert.equal(detached._contains('name'), false)

    const retrieving = construct(Unit, { action: 'retrieve' })

    assert.equal(retrieving._mode, null)
    assert.equal(retrieving._action, 'retrieve')
  })

  it('reaches through a relation by path with the model itself', async () => {
    const unit = await new Unit('yep').create()
    unit.test.add('one')
    await unit.update()

    const test = (await Test.one({ name: 'one' }).retrieve())!
    await test.unit.retrieve()

    assert.equal(test._item('unit__name'), 'yep')
    assert.equal(test.unit__data__a, null)
    assert.equal(test.unit__name, 'yep')
    assert.equal(test._relate('nothing'), null)
  })

  it('refuses to set or add before a retrieve', async () => {
    assert.throws(() => Unit.one(1).set({ name: 'x' }), /not retrieved yet/)
    assert.throws(() => Unit.many().add('x'), /not retrieved yet/)
  })

  it('walks on through plain values at the end of a relation path', async () => {
    const unit = await new Unit({ name: 'yep', data: { a: { b: 1 } } }).create()
    unit.test.add('one')
    await unit.update()

    const test = (await Test.one({ name: 'one' }).retrieve())!
    await test.unit.retrieve()

    assert.deepEqual(test.unit__data__a, { b: 1 })
    assert.equal(test.unit__data__a__b, 1)
  })

  it('reads many models by negative position', async () => {
    await new Unit([['a'], ['b'], ['c']]).create()

    const units = (await Unit.many().retrieve())!

    assert.equal(units[-1].name, 'c')
    assert.equal(units[0].name, 'a')
  })

  it('sorts a model that has nothing in it', () => {
    const detached = construct(Test, { parent: { unit_id: null } })

    assert.equal(detached.sort('name'), detached)
    assert.deepEqual(detached.models, [])
  })

  it('pushes a parent id into children that have not loaded', async () => {
    const unit = await new Unit('yep').create()
    unit.test.add('one')
    await unit.update()

    const test = (await Test.one({ name: 'one' }).retrieve())!
    const waiting = test.case

    test.id = 5

    assert.equal(waiting._related.test_id, 5)
  })

  it('keeps children in step when a parent id changes', async () => {
    const unit = await new Unit('yep').create()
    unit.test.add('one')
    unit.test.add('two')
    await unit.update()

    const loaded = (await Unit.one({ name: 'yep' }).retrieve())!
    await loaded.test.retrieve()
    loaded.id = 9

    assert.deepEqual(loaded.test.unit_id, [9, 9])

    const test = (await Test.one({ name: 'one' }).retrieve())!
    test.case.add('case')
    test.id = 7

    assert.equal(test.case.test_id, 7)
  })

  it('reports size, iteration and membership of children', async () => {
    const unit = await new Unit('yep').create()
    unit.test.add('one')
    await unit.update()

    const test = (await Test.one({ name: 'one' }).retrieve())!
    await test.case.retrieve()

    assert.equal(test.case.size, 0)
    assert.deepEqual([...test.case], [])
    assert.deepEqual(test.case.keys(), [])
    assert.equal('name' in test.case, false)

    test.case.add('case')

    assert.equal(test.case.size, 3)
    assert.ok('name' in test.case)
    assert.ok([...test.case].includes('name'))
    assert.deepEqual(test.case.keys(), ['id', 'test_id', 'name'])
    assert.equal('nope' in test, false)
    assert.equal(Symbol.iterator in test, true)
  })

  it('writes symbols straight through', () => {
    const unit = new Unit('yep') as any
    const key = Symbol('mine')

    unit[key] = 5

    assert.equal(unit[key], 5)
  })

  it('sorts models with equal values stably', async () => {
    await new Unit([['b'], ['a'], ['c']]).create()
    await new Test([
      [1, 'same'],
      [1, 'same'],
      [1, 'other']
    ]).create()

    const tests = (await Test.many().retrieve())!

    tests.sort('+name', '-id')

    assert.deepEqual(tests.name, ['other', 'same', 'same'])
    assert.deepEqual(tests.id, [3, 2, 1])

    tests.sort('+name')
    assert.deepEqual(tests.id, [3, 2, 1])
  })

  it('retrieves nothing from an empty many', async () => {
    const units = (await Unit.many().retrieve())!

    assert.equal(units.size, 0)
    assert.deepEqual(units.models, [])
  })

  it('does not look inside a relation of a many', async () => {
    await new Unit('yep').create()
    const units = (await Unit.many().retrieve())!

    assert.throws(() => units.test, /cannot access 'test' in many mode/)
  })
})

describe('many to many models', () => {
  class Base extends Model {
    static source = 'ties'
  }
  class Sis extends fields({ id: int, name: str, bro_id: list }, Base) {}
  class Bro extends fields({ id: int, name: str, sis_id: list }, Base) {}
  class SisBro extends fields({ sis_id: int, bro_id: int }, Base) {
    static id = null
    static unique = { sis_bro: ['sis_id', 'bro_id'] }
  }

  new ManyToMany(Sis, Bro, SisBro)

  beforeEach(() => {
    clear()
    new MockSource('ties')
  })

  it('writes ties that came in as single values and none that came in empty', async () => {
    await new Sis({ name: 'jane' }).create()
    await new Bro({ name: 'tom', sis_id: [1] }).create()
    await new Bro({ name: 'dick', sis_id: [] }).create()
    await new Bro({ name: 'harry' }).create()

    assert.equal(await SisBro.many().count(), 1)
  })

  it('reaches ties with a single value', async () => {
    await new Sis({ name: 'jane' }).create()
    await new Sis({ name: 'mary' }).create()
    await new Bro({ name: 'tom', sis_id: [1, 2] }).create()

    const ids = await Source.tieIds(SisBro, 'sis_id', 'bro_id', 'any', 1)
    assert.deepEqual([...ids], [1])

    const all = await Source.tieIds(SisBro, 'sis_id', 'bro_id', 'all', new Set([1, 2]))
    assert.deepEqual([...all], [1])

    const none = await Source.attrIds(Sis.thy().BROTHERS.bro, 'brother', { name: 'nobody' })
    assert.equal(none.size, 0)
  })

  it('combines several tie criteria on one side', async () => {
    await new Sis({ name: 'jane' }).create()
    await new Sis({ name: 'mary' }).create()
    await new Bro({ name: 'tom', sis_id: [1, 2] }).create()
    await new Bro({ name: 'dick', sis_id: [1] }).create()

    const both = (await Bro.many({ sis_id__any: [1, 2], sis_id__has: [1] }).retrieve())!
    assert.deepEqual(both.name, ['tom', 'dick'].sort())

    const narrowed = (await Bro.many({ sis_id__any: [1, 2], sis_id__all: [1, 2] }).retrieve())!
    assert.deepEqual(narrowed.name, ['tom'])
  })

  it('tells whether ties need writing for empty and filled values', () => {
    const model = new Sis({ name: 'jane', bro_id: [] })

    assert.equal(Source.hasTies(model), false)
    assert.equal(Source.hasTies(model, { bro_id: new Set([1]) }), true)
    assert.equal(Source.hasTies(model, { bro_id: new Map([[1, 1]]) }), true)
    assert.equal(Source.hasTies(model, { bro_id: new Map() }), false)
    assert.equal(Source.hasTies(model, { bro_id: { a: 1 } }), true)
    assert.equal(Source.hasTies(model, { bro_id: {} }), false)
    assert.equal(Source.hasTies(model, { bro_id: 1 }), true)
    assert.equal(Source.hasTies(model, { bro_id: 0 }), false)
  })
})

describe('titles', () => {
  class Base extends Model {
    static source = 'titled'
  }
  class Unit extends fields({ id: int, name: str }, Base) {}

  beforeEach(() => {
    clear()
    new MockSource('titled')
  })

  it('serialises to plain JSON', async () => {
    await new Unit('yep').create()

    const titles = await Unit.many().titles()

    assert.deepEqual(JSON.parse(JSON.stringify(titles)), {
      id: 'id',
      fields: ['name'],
      ids: [1],
      titles: { 1: ['yep'] },
      format: [null]
    })
  })

  it('adds nothing for a model with no record', async () => {
    const titles = await Titles.build(Unit.many())
    const bare = construct(Unit, { parent: { id: null } })

    assert.throws(() => titles.add(bare), /no records/)
  })
})

describe('several many to many relations on one model', () => {
  class Base extends Model {
    static source = 'several'
  }
  class Pal extends fields({ id: int, name: str, thing_id: list, gadget_id: list }, Base) {}
  class Thing extends fields({ id: int, name: str, pal_id: list }, Base) {}
  class Gadget extends fields({ id: int, name: str, pal_id: list }, Base) {}
  class PalThing extends fields({ pal_id: int, thing_id: int }, Base) {
    static id = null
    static unique = { pal_thing: ['pal_id', 'thing_id'] }
  }
  class PalGadget extends fields({ pal_id: int, gadget_id: int }, Base) {
    static id = null
    static unique = { pal_gadget: ['pal_id', 'gadget_id'] }
  }

  new ManyToMany(Pal, Thing, PalThing)
  new ManyToMany(Pal, Gadget, PalGadget)

  beforeEach(() => {
    clear()
    new MockSource('several')
  })

  it('intersects the pals matching each sibling', async () => {
    await new Thing({ name: 'hat' }).create()
    await new Gadget({ name: 'phone' }).create()
    await new Gadget({ name: 'watch' }).create()
    await new Pal({ name: 'ann', thing_id: [1], gadget_id: [1] }).create()
    await new Pal({ name: 'bob', thing_id: [1], gadget_id: [2] }).create()

    const both = (await Pal.many({ thing__name: 'hat', gadget__name: 'phone' }).retrieve())!
    assert.deepEqual(both.name, ['ann'])

    const hats = (await Pal.many({ thing__name: 'hat' }).retrieve())!
    assert.deepEqual(hats.name, ['ann', 'bob'])
  })

  it('writes no ties for a null list', async () => {
    await new Thing({ name: 'hat' }).create()
    const ann = await new Pal({ name: 'ann' }).create()

    await Source.createTies(ann, { thing_id: null }, ann.id)

    assert.equal(await PalThing.many().count(), 0)
  })
})

describe('field internals', () => {
  it('defaults extract kinds to str when none is given', () => {
    const field = new Field(dict, { name: 'data', extract: { a: null } } as any)

    assert.equal((field.extract as any).a, str)
  })

  it('describes values it cannot stringify when they fail', () => {
    const field = new Field(int, { name: 'amount' } as any)

    assert.throws(() => field.valid(() => 1), /invalid for amount/)
  })

  it('exports an unset set as an empty list', () => {
    assert.deepEqual(new Field(set, { name: 'tags' } as any).export(), [])
  })

  it('applies into unset lists and dicts', () => {
    const items = new Field(list, { name: 'items' } as any)
    items.apply([1], 'b')
    assert.deepEqual(items.export(), [null, 'b'])

    const data = new Field(dict, { name: 'data' } as any)
    data.apply(['a'], 'b')
    assert.deepEqual(data.export(), { a: 'b' })
  })

  it('refreshes from a default function on update and mass update', () => {
    const field = new Field(int, { name: 'stamp', refresh: true, default: () => 5 } as any)

    const values: Record<string, unknown> = {}
    field.update(values)
    assert.deepEqual(values, { stamp: 5 })

    const mass: Record<string, unknown> = {}
    const again = new Field(int, { name: 'stamp', refresh: true, default: () => 6 } as any)
    again.mass(mass)
    assert.deepEqual(mass, { stamp: 6 })
  })

  it('treats a field with no storage as null when filtering and matching', () => {
    const field = new Field(int, { name: 'tied', store: false, none: true } as any)

    field.filter(1)

    assert.equal(field.retrieve({ tied: 1 }), false)
    assert.equal(field.like({ tied: 1 }, '1', {}), false)
  })

  it('reaches into a set by position in a criterion', () => {
    const field = new Field(set, { name: 'tags' } as any)

    field.filter('a', '0__eq')

    assert.ok(field.retrieve({ tags: ['b', 'a'] }))
    assert.ok(!field.retrieve({ tags: ['b', 'c'] }))
  })

  it('likes a title found by literal key as well as by path', () => {
    const field = new Field(dict, { name: 'thing', titles: ['a__b'] } as any)

    assert.ok(field.like({ thing: { a__b: 'xyz' } }, 'XY', {}))
    assert.ok(field.like({ thing: { a: { b: 'xyz' } } }, 'xy', {}))
    assert.ok(!field.like({ thing: { a: { b: 'xyz' } } }, 'nope', {}))
  })

  it('has no titles to report for a class kind that opted out of them', () => {
    class Thing {
      constructor(public a: number) {}
    }
    const field = new Field(Thing, { name: 'thing', attr: ['a'], titles: null } as any)
    field.value = new Thing(1)

    assert.deepEqual(field.title(), [])
  })

  it('reads an injected field from a record with nothing stored', () => {
    const record = new FieldRecord()
    record.append(new Field(dict, { name: 'data', store: false } as any))
    record.append(new Field(int, { name: 'a', inject: 'data__a' } as any))

    record.read({})

    assert.equal(record.get('a'), null)
  })
})

describe('migration details', () => {
  it('records removed attributes as null', () => {
    assert.deepEqual(Migrations.field({ a: 1, b: 2 }, { a: 1 }), { b: null })

    const migration = Migrations.model(
      { name: 'unit', title: 'Unit', fields: [], unique: { name: ['name'] } },
      { name: 'unit', fields: [] }
    )

    assert.equal(migration.title, null)
    assert.ok('unique' in migration)
  })

  it('writes classes that are not plain objects as they are', () => {
    class Odd {
      b = 2
      a = 1
    }

    assert.equal(pretty({ z: new Odd() }), '{\n    "z": {\n        "b": 2,\n        "a": 1\n    }\n}\n')
    const bare = Object.assign(Object.create(null), { b: 2, a: 1 })

    assert.equal(pretty({ z: bare }), '{\n    "z": {\n        "a": 1,\n        "b": 2\n    }\n}\n')
  })
})

describe('migrations defaults', () => {
  it('treats nothing as a rename unless told otherwise', () => {
    assert.deepEqual(new Migrations('ddl').renamer('unit', ['a'], ['b']), {})
  })

  it('records an index added to or removed from a model', () => {
    const migration = Migrations.model(
      { name: 'unit', fields: [], index: { name: ['name'] } },
      { name: 'unit', fields: [], unique: { name: ['name'] } }
    )

    assert.ok('index' in migration)
    assert.ok('unique' in migration)
  })
})

describe('mock source details', () => {
  it('limits a model that has no models yet', () => {
    clear()
    class Base extends Model {
      static source = 'limited'
    }
    class Unit extends fields({ id: int, name: str }, Base) {}
    new MockSource('limited')

    const units = Unit.many().limit(2)

    MockSource.modelLimit(units)

    assert.deepEqual(units.models, [])
    assert.equal(units.overflow, false)
  })

  it('changes models without a rename, fields or store change', async () => {
    clear()
    const mock = new MockSource('details')

    assert.deepEqual(mock.modelChange({ name: 'unit', fields: [] }, {}), [
      { ACTION: 'change', DEFINITION: { name: 'unit', fields: [] }, MIGRATION: { fields: [] } }
    ])

    await mock.execute({ ACTION: 'add', name: 'unit' })
    mock.data.unit.set(1, { name: 'a' })

    await mock.execute({ ACTION: 'change', DEFINITION: { name: 'unit' }, MIGRATION: {} })
    await mock.execute({
      ACTION: 'change',
      DEFINITION: { name: 'unit' },
      MIGRATION: { fields: [{ ACTION: 'change', DEFINITION: { store: 'name' }, MIGRATION: {} }] }
    })

    assert.deepEqual([...mock.data.unit.values()], [{ name: 'a' }])
  })
})
