import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MockSource,
  Model,
  clear,
  definitionsOf,
  fields,
  int,
  modelsFrom,
  str,
  type ModelClass
} from '../src/index.js'

// The same two models, written twice: once as code, once as data.

class Base extends Model {
  static source = 'example'
}

class Unit extends fields({ id: int, name: str }, Base) {}
class Test extends fields({ id: int, unit_id: int, name: str }, Base) {}

const app = {
  models: {
    unit: {
      source: 'example',
      name: 'unit',
      title: 'Unit',
      id: 'id',
      unique: { name: ['name'] },
      index: {},
      fields: [
        { kind: 'int', name: 'id', store: 'id', none: true, auto: true },
        { kind: 'str', name: 'name', store: 'name', none: false }
      ]
    },
    test: {
      source: 'example',
      name: 'test',
      title: 'Test',
      id: 'id',
      unique: { name: ['name'] },
      index: {},
      fields: [
        { kind: 'int', name: 'id', store: 'id', none: true, auto: true },
        { kind: 'int', name: 'unit_id', store: 'unit_id', none: true },
        { kind: 'str', name: 'name', store: 'name', none: false }
      ]
    }
  },
  relations: [{ kind: 'OneToMany' as const, parent: 'unit', child: 'test' }]
}

describe('models from data', () => {
  beforeEach(() => {
    clear()
    new MockSource('example')
  })

  it('builds working models from definitions', async () => {
    const { unit: DynamicUnit } = modelsFrom(app.models, { relations: app.relations })

    await new (DynamicUnit as any)('yep').create()

    const found = await (DynamicUnit as any).one({ name: 'yep' }).retrieve()

    assert.equal(found.id, 1)
    assert.equal(found.name, 'yep')
  })

  it('wires relations declared as data', async () => {
    const built = modelsFrom(app.models, { relations: app.relations })

    const unit = new (built.unit as any)('a')
    unit.test.add('x')
    await unit.create()

    const tests = await (built.test as any).many({ unit__name: 'a' }).retrieve()

    assert.deepEqual(tests.name, ['x'])
  })

  it('round trips: code to data and back again', () => {
    const written = definitionsOf([Unit as unknown as ModelClass, Test as unknown as ModelClass])
    const rebuilt = modelsFrom(written)

    assert.deepEqual(definitionsOf(Object.values(rebuilt)), written)
  })

  it('refuses an unknown kind', () => {
    assert.throws(
      () => modelsFrom({ bad: { name: 'bad', fields: [{ kind: 'wat', name: 'x' }] } }),
      /unknown kind 'wat'/
    )
  })

  it('refuses a relation pointing at nothing', () => {
    assert.throws(
      () => modelsFrom(app.models, { relations: [{ kind: 'OneToMany', parent: 'unit', child: 'nope' }] }),
      /unknown model 'nope'/
    )
  })
})
