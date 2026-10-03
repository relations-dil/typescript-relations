/**
 * RestSource, ported from python-relations-rest's test_relations_rest.py.
 *
 * Nothing here touches a network. `restxFake` (test/restx-fake.ts) answers the way a
 * relations-restx API does, on top of MockSource-backed server models, and records what it
 * was sent. Every model the client uses has a twin on the "server" side under another source.
 */

import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  Field,
  ManyToMany,
  MockSource,
  Model,
  ModelError,
  OneToMany,
  OneToOne,
  RestSource,
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
import { restxFake } from './restx-fake.js'
import type { Call } from './restx-fake.js'

// --------------------------------------------------------------------------- models

/** The same schema twice: once for the client (source 'rest'), once for the server ('restx'). */
function schema(name: string): Record<string, any> {
  class SourceModel extends Model {
    static source = name
  }

  class Simple extends fields({ id: int, name: str }, SourceModel) {}

  class Plain extends fields({ simple_id: int, name: str }, SourceModel) {
    static id = null
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

  class Unit extends fields({ id: int, name: { kind: str, format: 'fancy' } }, SourceModel) {}

  class Test extends fields({ id: int, unit_id: int, name: { kind: str, format: 'shmancy' } }, SourceModel) {}

  class Case extends fields({ id: int, test_id: int, name: str }, SourceModel) {}

  new OneToMany(Unit, Test)
  new OneToOne(Test, Case)

  class Sis extends fields({ id: int, name: str, bro_id: set }, SourceModel) {}

  class Bro extends fields({ id: int, name: str, sis_id: set }, SourceModel) {}

  class SisBro extends fields({ bro_id: int, sis_id: int }, SourceModel) {
    static id = null
  }

  new ManyToMany(Sis, Bro, SisBro)

  class Manual extends fields({ id: { kind: int, auto: false }, name: str }, SourceModel) {}

  class Slug extends fields({ id: { kind: str, auto: false }, name: str }, SourceModel) {}

  return { Simple, Plain, Meta, Unit, Test, Case, Sis, Bro, SisBro, Manual, Slug }
}

const server = schema('restx')

const { Simple, Plain, Meta, Unit, Test, Sis, Bro, Manual, Slug } = schema('rest')

// --------------------------------------------------------------------------- helpers

const URL = 'http://api.test'

let mock: MockSource
let fake: ReturnType<typeof restxFake>
let rest: RestSource

/** What the fake server has stored, flattened out of its Maps. */
function stored(): Record<string, any> {
  return Object.fromEntries(
    Object.entries(mock.data).map(([name, records]) => [name, Object.fromEntries(records)])
  )
}

/** The calls made since the last time this was asked. */
function sent(): Call[] {
  return fake.calls.splice(0)
}

/** Just the parts of a call worth asserting on. */
function shape(call: Call): [string, string, any] {
  return [call.method, call.url.replace(URL, ''), call.body]
}

/** A fetch that always answers with the same thing. */
function answering(status: number, body: any, seen: Call[] = []): any {
  return async (url: string, init: any) => {
    seen.push({ method: init.method, url, headers: init.headers, credentials: init.credentials, init, body: init.body })

    return {
      status,
      json: async () => {
        if (body instanceof Error) {
          throw body
        }

        return body
      }
    }
  }
}

function setUp(): void {
  clear()

  mock = new MockSource('restx')

  fake = restxFake(Object.values(server).filter((model) => model.name !== 'SisBro'))

  rest = new RestSource('rest', { url: URL, fetch: fake.fetch })
}

// --------------------------------------------------------------------------- the source

describe('RestSource', () => {
  beforeEach(setUp)

  describe('constructor', () => {
    it('is a source of its own kind, registered under its name', () => {
      assert.equal(RestSource.KIND, 'rest')
      assert.equal(rest.KIND, 'rest')
      assert.equal(rest.name, 'rest')
      assert.equal(rest.url, URL)
      assert.equal(registeredSource('rest'), rest)
    })

    it('drops trailing slashes from the url', () => {
      assert.equal(new RestSource('slashed', { url: `${URL}//`, fetch: fake.fetch }).url, URL)
    })

    it('needs a url, but an empty one (same origin) will do', async () => {
      assert.throws(() => new RestSource('nowhere', { fetch: fake.fetch }), /nowhere: no url/)
      assert.throws(() => new RestSource('nowhere', { url: 4, fetch: fake.fetch } as any), /nowhere: no url/)
      assert.equal(registeredSource('nowhere'), undefined)

      const seen: Call[] = []
      new RestSource('rest', { url: '', fetch: answering(200, { units: [] }, seen) })

      await Unit.many().retrieve()

      assert.equal(seen[0].url, '/unit')
    })

    it('needs a fetch, from the options or the global', async () => {
      const original = (globalThis as any).fetch

      try {
        delete (globalThis as any).fetch

        assert.throws(() => new RestSource('nothing', { url: URL }), /nothing: no fetch here/)

        const seen: Call[] = []
        ;(globalThis as any).fetch = answering(200, { units: [] }, seen)

        new RestSource('rest', { url: URL })

        await Unit.many().retrieve()

        assert.equal(seen[0].url, `${URL}/unit`)
      } finally {
        ;(globalThis as any).fetch = original
      }
    })

    it('calls fetch bare, so a browser fetch has nothing to complain about', async () => {
      new RestSource('rest', {
        url: URL,
        fetch: function (this: any, url: string, init: any) {
          assert.equal(this, undefined)
          return answering(200, { units: [] })(url, init)
        }
      })

      await Unit.many().retrieve()
    })

    it('sends its headers, credentials and request options on every request', async () => {
      const seen: Call[] = []

      new RestSource('rest', {
        url: URL,
        fetch: answering(200, { units: [], updated: 0, deleted: 0 }, seen),
        headers: { Authorization: 'Bearer abc' },
        credentials: 'include',
        request: { mode: 'cors', cache: 'no-store' }
      })

      await Unit.many().retrieve()
      await Unit.many({ id: 1 }).set({ name: 'x' }).update()
      await Unit.many({ id: 1 }).delete()

      assert.equal(seen.length, 3)

      for (const call of seen) {
        assert.equal(call.credentials, 'include')
        assert.equal(call.init.mode, 'cors')
        assert.equal(call.init.cache, 'no-store')
        assert.equal(call.headers.Authorization, 'Bearer abc')
        assert.equal(call.headers['Content-Type'], 'application/json')
      }
    })

    it('sends no credentials or request options unless asked, and lets headers override the content type', async () => {
      const seen: Call[] = []

      new RestSource('rest', { url: URL, fetch: answering(200, { units: [] }, seen), headers: { 'Content-Type': 'text/json' } })

      await Unit.many().retrieve()

      assert.deepEqual(Object.keys(seen[0].init).sort(), ['body', 'headers', 'method'])
      assert.equal(seen[0].headers['Content-Type'], 'text/json')
    })

    it('does not mutate the headers it was given', async () => {
      const headers = { A: 'b' }

      const source = new RestSource('rest', { url: URL, fetch: fake.fetch, headers })
      await Unit.many().retrieve()

      assert.deepEqual(headers, { A: 'b' })
      assert.notEqual(source.headers, headers)
    })
  })

  describe('result', () => {
    const model: any = { NAME: 'moded', overflow: false }

    it('hands back the key, and carries overflow over', async () => {
      const response = { status: 200, json: async () => ({ name: 'value', overflow: true }) }

      assert.equal(await rest.result(model, 'name', response), 'value')
      assert.equal(model.overflow, true)

      model.overflow = false

      assert.equal(await rest.result(model, 'name', { status: 200, json: async () => ({ name: 'again' }) }), 'again')
      assert.equal(model.overflow, false)

      model.overflow = true

      await rest.result(model, 'name', { status: 200, json: async () => ({ name: 'again', overflow: false }) })
      assert.equal(model.overflow, true)
    })

    it('raises the API message on a failure', async () => {
      await assert.rejects(
        () => rest.result(model, 'whatevs', { status: 500, json: async () => ({ message: 'whoops' }) }),
        (error: any) => {
          assert.ok(error instanceof ModelError)
          assert.equal(error.message, 'moded: whoops')
          assert.equal(error.detail, 'whoops')
          assert.equal(error.model, model)
          return true
        }
      )
    })

    it('says API Error when a failure has no message, or no JSON at all', async () => {
      await assert.rejects(() => rest.result(model, 'k', { status: 400, json: async () => ({}) }), /moded: API Error/)
      await assert.rejects(() => rest.result(model, 'k', { status: 502, json: async () => null }), /moded: API Error/)
      await assert.rejects(
        () => rest.result(model, 'k', { status: 502, json: async () => Promise.reject(new SyntaxError('<html>')) }),
        /moded: API Error/
      )
    })

    it('says API Error when a success is not a JSON object', async () => {
      await assert.rejects(
        () => rest.result(model, 'k', { status: 200, json: async () => Promise.reject(new SyntaxError('<html>')) }),
        /moded: API Error/
      )
      await assert.rejects(() => rest.result(model, 'k', { status: 200, json: async () => null }), /moded: API Error/)
      await assert.rejects(() => rest.result(model, 'k', { status: 200, json: async () => 5 }), /moded: API Error/)
    })

    it('lets a network failure through as it is', async () => {
      new RestSource('rest', {
        url: URL,
        fetch: async () => {
          throw new TypeError('Failed to fetch')
        }
      })

      await assert.rejects(() => Unit.many().retrieve(), TypeError)
    })

    it('turns errors from the API into ModelErrors on the model', async () => {
      new RestSource('rest', { url: URL, fetch: answering(500, { message: 'down' }) })

      await assert.rejects(() => new Unit('x').create(), /unit: down/)
      await assert.rejects(() => Unit.many().retrieve(), /unit: down/)
      await assert.rejects(() => Unit.many().count(), /unit: down/)
      await assert.rejects(() => Unit.many({ id: 1 }).set({ name: 'y' }).update(), /unit: down/)
      await assert.rejects(() => Unit.many({ id: 1 }).delete(), /unit: down/)
    })
  })

  describe('init', () => {
    it('names the model in the API, and makes the id auto', () => {
      class Check extends fields({ id: int, name: str }, Model) {
        static source = 'rest'
      }

      let model: any = new Check()

      assert.equal(model.SINGULAR, 'check')
      assert.equal(model.PLURAL, 'checks')
      assert.equal(model.ENDPOINT, 'check')
      assert.equal(model._fields.field('id').auto, true)

      class Renamed extends fields({ id: int, name: str }, Model) {
        static source = 'rest'
        static SINGULAR = 'people'
        static PLURAL = 'stuff'
        static ENDPOINT = 'things'
      }

      model = new Renamed()

      assert.equal(model.SINGULAR, 'people')
      assert.equal(model.PLURAL, 'stuff')
      assert.equal(model.ENDPOINT, 'things')

      class Partly extends fields({ id: int }, Model) {
        static source = 'rest'
        static SINGULAR = 'person'
      }

      model = new Partly()

      assert.equal(model.SINGULAR, 'person')
      assert.equal(model.PLURAL, 'persons')
      assert.equal(model.ENDPOINT, 'person')
    })

    it('leaves a model with no id alone, and an id that is not auto', () => {
      assert.equal(new Plain()._id, null)
      assert.equal(new Manual({ id: 4, name: 'm' })._fields.field('id').auto, false)
    })
  })

  describe('create', () => {
    it('writes the records, ids come back, children follow', async () => {
      const simple = new Simple('sure')
      simple.plain.add('fine')

      await simple.create()

      assert.equal(simple.id, 1)
      assert.equal(simple._action, 'update')
      assert.equal(simple._record._action, 'update')
      assert.equal(simple.plain[0].simple_id, 1)
      assert.equal(simple.plain._action, 'update')
      assert.equal(simple.plain[0]._record._action, 'update')

      assert.deepEqual(sent().map(shape), [
        ['POST', '/simple', { simples: [{ name: 'sure' }] }],
        ['POST', '/plain', { plains: [{ simple_id: 1, name: 'fine' }] }]
      ])

      const simples = await Simple.bulk().add('ya').create()

      assert.deepEqual(simples._models, [])
      assert.deepEqual(sent().map(shape), [['POST', '/simple', { simples: [{ name: 'ya' }] }]])

      const yep = await new Meta(
        'yep',
        true,
        3.5,
        new Set(['tom', 'mary']),
        [1, null],
        { a: 1, for: [{ '1': 'yep' }] },
        'sure'
      ).create()

      assert.deepEqual(sent().map(shape), [
        [
          'POST',
          '/meta',
          {
            metas: [
              {
                name: 'yep',
                flag: true,
                spend: 3.5,
                people: ['mary', 'tom'],
                stuff: [1, null],
                things: { a: 1, for: [{ '1': 'yep' }] },
                push: 'sure'
              }
            ]
          }
        ]
      ])

      assert.equal((await Meta.one(yep.id).retrieve()).flag, true)

      const nope = await new Meta('nope', false).create()

      assert.equal((await Meta.one(nope.id).retrieve()).flag, false)

      assert.deepEqual(
        Object.fromEntries(Object.entries(mock.ids).filter(([, last]) => last)),
        { simple: 2, plain: 1, meta: 2 }
      )

      assert.deepEqual(stored(), {
        ...stored(),
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
            people: ['mary', 'tom'],
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
    })

    it('gives every record in a batch its own id', async () => {
      const units = await new Unit([['people'], ['stuff'], ['things']]).create()

      assert.deepEqual(units.id, [1, 2, 3])
      assert.deepEqual(units._each().map((unit: any) => unit._action), ['update', 'update', 'update'])
      assert.equal(units._action, 'update')

      assert.deepEqual(sent().map(shape), [
        ['POST', '/unit', { units: [{ name: 'people' }, { name: 'stuff' }, { name: 'things' }] }]
      ])
    })

    it('sends an id that is not generated, and does not look for one coming back', async () => {
      const manual = await new Manual({ id: 7, name: 'seven' }).create()

      assert.equal(manual.id, 7)
      assert.deepEqual(sent().map(shape), [['POST', '/manual', { manuals: [{ id: 7, name: 'seven' }] }]])
    })

    it('leaves the model creatable when the API refuses', async () => {
      await new Unit('people').create()

      const unit = new Unit('people')

      await assert.rejects(() => unit.create(), /unit: unit: value {"name":"people"} violates unique name/)

      assert.equal(unit._action, 'create')
    })

    it('only sends what changed after a create, when updating', async () => {
      const unit = await new Unit('people').create()

      sent()

      unit.name = 'folks'

      assert.equal(await unit.update(), 1)
      assert.deepEqual(sent().map(shape), [['PATCH', '/unit/1', { unit: { name: 'folks' } }]])
    })
  })

  describe('ties', () => {
    it('creates them with the record', async () => {
      const tom = await new Bro('Tom').create()
      const dick = await new Bro('Dick').create()

      sent()

      const mary = await new Sis('Mary', { bro_id: [dick.id, tom.id] }).create()

      assert.deepEqual(sent().map(shape), [['POST', '/sis', { siss: [{ name: 'Mary', bro_id: [tom.id, dick.id] }] }]])

      assert.deepEqual((await mary.bro.retrieve()).id, [dick.id, tom.id])
      assert.deepEqual((await Sis.many({ bro_id: [tom.id] }).retrieve()).name, ['Mary'])
    })

    it('reads them off the response', async () => {
      const tom = await new Bro('Tom').create()
      const dick = await new Bro('Dick').create()

      await new Sis('Mary', { bro_id: [tom.id, dick.id] }).create()
      await new Sis('Sue', { bro_id: [tom.id] }).create()

      const mary = await Sis.one({ name: 'Mary' }).retrieve()

      assert.deepEqual(mary.bro_id, new Set([tom.id, dick.id]))
      assert.deepEqual((await mary.bro.retrieve()).id, [dick.id, tom.id])

      const sisters = await Sis.many().retrieve()

      assert.deepEqual(sisters.bro_id, [new Set([tom.id, dick.id]), new Set([tom.id])])

      assert.deepEqual((await Sis.many({ bro_id: [dick.id] }).retrieve()).name, ['Mary'])

      const harry = await new Bro('Harry', { sis_id: [mary.id] }).create()

      assert.deepEqual((await Bro.one({ id: harry.id }).retrieve()).sis_id, new Set([mary.id]))
    })

    it('updates them', async () => {
      const tom = await new Bro('Tom').create()
      const dick = await new Bro('Dick').create()
      const harry = await new Bro('Harry').create()
      const mary = await new Sis('Mary', { bro_id: [tom.id, dick.id] }).create()

      sent()

      const sis = await Sis.one(mary.id).retrieve()
      sis.bro_id = [dick.id, harry.id]

      await sis.update()

      assert.deepEqual(sent().filter((call) => call.method === 'PATCH').map(shape), [
        ['PATCH', `/sis/${mary.id}`, { sis: { bro_id: [dick.id, harry.id] } }]
      ])

      assert.deepEqual((await (await Sis.one(mary.id).retrieve()).bro.retrieve()).id, [dick.id, harry.id])
    })

    it('deletes them', async () => {
      const tom = await new Bro('Tom').create()
      const mary = await new Sis('Mary', { bro_id: [tom.id] }).create()

      await (await Sis.one(mary.id).retrieve()).delete()

      assert.equal((await Sis.many().retrieve()).size, 0)
      assert.equal((await Sis.many({ bro_id: [tom.id] }).retrieve()).size, 0)
    })

    it('selects by them, with the API doing the work', async () => {
      const tom = await new Bro('Tom').create()
      const dick = await new Bro('Dick').create()
      const harry = await new Bro('Harry').create()

      await new Sis('Mary', { bro_id: [tom.id, dick.id] }).create()
      await new Sis('Sue', { bro_id: [tom.id] }).create()
      await new Sis('Ann', { bro_id: [dick.id, harry.id] }).create()

      const names = async (criteria: any) => [...(await Sis.many(criteria).retrieve()).name].sort()

      sent()

      assert.deepEqual(await names({ bro_id__has: tom.id }), ['Mary', 'Sue'])
      assert.deepEqual(sent().map(shape), [['POST', '/sis', { filter: { bro_id__has: [tom.id] } }]])

      assert.deepEqual(await names({ bro_id__any: [tom.id, harry.id] }), ['Ann', 'Mary', 'Sue'])
      assert.deepEqual(await names({ bro_id__all: [tom.id, dick.id] }), ['Mary'])
      assert.deepEqual(await names({ bro_id__not_has: tom.id }), ['Ann'])
      assert.deepEqual(await names({ bro_id__not_any: [harry.id] }), ['Mary', 'Sue'])
    })

    it('selects by a tied sibling', async () => {
      const tom = await new Bro('Tom').create()
      const dick = await new Bro('Dick').create()
      const harry = await new Bro('Harry').create()

      await new Sis('Mary', { bro_id: [tom.id, dick.id] }).create()
      await new Sis('Sue', { bro_id: [tom.id] }).create()
      await new Sis('Ann', { bro_id: [dick.id, harry.id] }).create()

      const names = async (criteria: any) => [...(await Sis.many(criteria).retrieve()).name].sort()

      sent()

      // the filter rides in the request and the API resolves it
      assert.deepEqual(await names({ bro__name: 'Tom' }), ['Mary', 'Sue'])
      assert.deepEqual(sent().map(shape), [['POST', '/sis', { filter: { bro__name: 'Tom' } }]])

      assert.deepEqual(await names({ bro__name__in: ['Tom', 'Dick'] }), ['Ann', 'Mary', 'Sue'])
      assert.deepEqual(await names({ bro__name__like: 'arr' }), ['Ann'])
      assert.deepEqual(await names({ bro__name__not_in: ['Tom'] }), ['Ann', 'Mary'])

      // criteria on the same relation filter the same tied brother
      assert.deepEqual(await names({ bro__name: 'Dick', bro__id: dick.id }), ['Ann', 'Mary'])

      sent()

      // sets go over as sorted lists
      await names({ bro__name__in: new Set(['Tom', 'Dick']) })
      assert.deepEqual(sent().map(shape), [['POST', '/sis', { filter: { bro__name__in: ['Dick', 'Tom'] } }]])

      // count rides the same path
      assert.equal(await Sis.many({ bro__name__in: ['Tom', 'Dick'] }).count(), 3)
      assert.deepEqual(sent().map(shape), [
        ['POST', '/sis', { filter: { bro__name__in: ['Tom', 'Dick'] }, count: true }]
      ])

      // symmetric: brothers by a tied sister's name
      const jane = await new Sis('Jane').create()
      const joan = await new Sis('Joan').create()

      await new Bro('Bab', { sis_id: [jane.id, joan.id] }).create()
      await new Bro('Bil', { sis_id: [jane.id] }).create()

      assert.deepEqual([...(await Bro.many({ sis__name: 'Jane' }).retrieve()).name].sort(), ['Bab', 'Bil'])
    })
  })

  describe('count', () => {
    it('counts what matches', async () => {
      await new Unit([['stuff'], ['people']]).create()

      sent()

      assert.equal(await Unit.many().count(), 2)
      assert.equal(await Unit.many({ name: 'people' }).count(), 1)
      assert.equal(await Unit.many({ like: 'p' }).count(), 1)

      assert.deepEqual(sent().map(shape), [
        ['POST', '/unit', { filter: {}, count: true }],
        ['POST', '/unit', { filter: { name__eq: 'people' }, count: true }],
        ['POST', '/unit', { filter: { like: 'p' }, count: true }]
      ])
    })

    it('folds in what the relations say first', async () => {
      const unit = await new Unit('people').create()
      await unit.test.add('stuff').add('things').create()

      sent()

      assert.equal(await Test.many({ unit__name: 'people' }).count(), 2)
      assert.equal(await Unit.many({ test__name: 'stuff' }).count(), 1)

      assert.deepEqual(sent().map(shape), [
        ['POST', '/unit', { filter: { name__eq: 'people' }, limit: { per_page: 100 } }],
        ['POST', '/test', { filter: { unit_id__in: [1] }, count: true }],
        ['POST', '/test', { filter: { name__eq: 'stuff' }, limit: { per_page: 100 } }],
        ['POST', '/unit', { filter: { id__in: [1] }, count: true }]
      ])
    })
  })

  describe('retrieve', () => {
    it('finds one, or complains', async () => {
      await new Unit([['people'], ['stuff']]).create()

      sent()

      await assert.rejects(
        () => Unit.one({ name__in: ['people', 'stuff'] }).retrieve(),
        (error: any) => error instanceof ModelError && error.message === 'unit: more than one retrieved'
      )

      const model = Unit.one({ name: 'things' })

      await assert.rejects(
        () => model.retrieve(),
        (error: any) => error instanceof ModelError && error.message === 'unit: none retrieved'
      )

      assert.equal(await model.retrieve(false), null)

      let unit = await Unit.one({ name: 'people' }).retrieve()

      assert.equal(unit.id, 1)
      assert.equal(unit._action, 'update')
      assert.equal(unit._record._action, 'update')

      assert.deepEqual(sent().map(shape).slice(-1), [['POST', '/unit', { filter: { name__eq: 'people' } }]])

      unit = await Unit.one({ like: 'p' }).retrieve()

      assert.equal(unit.id, 1)
      assert.equal(unit._action, 'update')
      assert.equal(unit._record._action, 'update')

      unit.test.add('things')[0].case.add('persons')

      assert.equal(await unit.update(), 1)
    })

    it('reads every kind of value back', async () => {
      await new Meta({
        name: 'yep',
        flag: true,
        spend: 1.1,
        people: new Set(['tom']),
        stuff: [1, null],
        things: { a: 1 }
      }).create()

      const model = await Meta.one({ name: 'yep' }).retrieve()

      assert.equal(model.flag, true)
      assert.equal(model.spend, 1.1)
      assert.deepEqual(model.people, new Set(['tom']))
      assert.deepEqual(model.stuff, [1, { 'relations.io': { '1': null } }])
      assert.deepEqual(model.things, { a: 1 })
    })

    it('sorts, limits and pages', async () => {
      await new Unit([['people'], ['stuff']]).create()

      sent()

      assert.deepEqual((await Unit.many().retrieve()).name, ['people', 'stuff'])
      assert.deepEqual((await Unit.many().sort('-name').retrieve()).name, ['stuff', 'people'])
      assert.deepEqual((await Unit.many().sort('-name').limit({ limit: 1, start: 1 }).retrieve()).name, ['people'])
      assert.deepEqual((await Unit.many().sort('-name').limit(0).retrieve()).name, [])
      assert.deepEqual((await Unit.many({ name: 'people' }).limit(1).retrieve()).name, ['people'])
      assert.deepEqual((await Unit.many().sort('name').limit({ page: 2, perPage: 1 }).retrieve()).name, ['stuff'])

      assert.deepEqual(sent().map(shape), [
        ['POST', '/unit', { filter: {} }],
        ['POST', '/unit', { filter: {}, sort: ['-name'] }],
        ['POST', '/unit', { filter: {}, sort: ['-name'], limit: { per_page: 1, start: 1 } }],
        ['POST', '/unit', { filter: {}, sort: ['-name'], limit: { per_page: 0 } }],
        ['POST', '/unit', { filter: { name__eq: 'people' }, limit: { per_page: 1 } }],
        ['POST', '/unit', { filter: {}, sort: ['+name'], limit: { per_page: 1, start: 1 } }]
      ])
    })

    it('reports when the API says there is more', async () => {
      await new Unit([['people'], ['stuff']]).create()

      const limited = await Unit.many().limit(1).retrieve()

      assert.equal(limited.overflow, true)
      assert.equal((await Unit.many().limit(3).retrieve()).overflow, false)
    })

    it('is held to the API chunk when no limit is sent, and says so', async () => {
      await new Unit(Array.from({ length: 101 }, (_, index) => [`unit ${index}`])).create()

      // restx always limits, so a client that sends no limit gets the server model's CHUNK
      const units = await Unit.many().retrieve()

      assert.equal(units.size, 100)
      assert.equal(units.overflow, true)
    })

    it('matches fuzzily, including through parents', async () => {
      const unit = await new Unit('people').create()
      await unit.test.add('things').create()
      await new Unit('stuff').create()

      assert.deepEqual((await Unit.many({ like: 'p' }).retrieve()).name, ['people'])
      assert.deepEqual((await Test.many({ like: 'p' }).retrieve()).name, ['things'])
    })

    it('follows relations to the children and parents', async () => {
      const unit = await new Unit('people').create()
      await unit.test.add('stuff')[0].case.add('persons')
      await unit.test.create()
      await new Unit('empty').create()

      sent()

      const people = await Unit.one({ name: 'people' }).retrieve()

      assert.deepEqual((await people.test.retrieve()).name, ['stuff'])
      assert.equal((await (await Test.one({ name: 'stuff' }).retrieve()).case.retrieve()).name, 'persons')

      assert.deepEqual((await Test.many({ unit__name: 'people' }).retrieve()).name, ['stuff'])
      assert.deepEqual((await Unit.many({ test__name: 'stuff' }).retrieve()).name, ['people'])
      assert.deepEqual((await Unit.many({ test__name: 'nope' }).retrieve()).name, [])

      assert.deepEqual(sent().map(shape).slice(0, 2), [
        ['POST', '/unit', { filter: { name__eq: 'people' } }],
        ['POST', '/test', { filter: { unit_id__eq: 1 } }]
      ])

      const test = await Test.one({ name: 'stuff' }).retrieve()

      assert.equal((await test.unit.retrieve()).name, 'people')
    })

    it('filters on every kind of value', async () => {
      await new Meta({
        name: 'dive',
        people: new Set(['tom', 'mary']),
        stuff: [1, 2, 3, null],
        things: { a: { b: [1, 2], c: 'sure' }, '4': 5, for: [{ '1': 'yep' }] }
      }).create()

      const dive = async (criteria: any) => (await Meta.many(criteria).retrieve()).size

      assert.equal(await dive({ people: new Set(['tom', 'mary']) }), 1)
      assert.equal(await dive({ stuff: [1, 2, 3, { 'relations.io': { '1': null } }] }), 1)
      assert.equal(await dive({ things: { a: { b: [1, 2], c: 'sure' }, '4': 5, for: [{ '1': 'yep' }] } }), 1)
      assert.equal(await dive({ stuff__1: 2 }), 1)
      assert.equal(await dive({ things__a__b__0: 1 }), 1)
      assert.equal(await dive({ things__a__c__like: 'su' }), 1)
      assert.equal(await dive({ things__a__d__null: true }), 1)
      assert.equal(await dive({ things____4: 5 }), 1)

      assert.equal(await dive({ things__a__b__0__gt: 1 }), 0)
      assert.equal(await dive({ things__a__c__notlike: 'su' }), 0)
      assert.equal(await dive({ things__a__d__null: false }), 0)
      assert.equal(await dive({ things___4: 6 }), 0)

      assert.equal(await dive({ things__a__b__has: 1 }), 1)
      assert.equal(await dive({ things__a__b__has: 3 }), 0)
      assert.equal(await dive({ things__a__b__any: [1, 3] }), 1)
      assert.equal(await dive({ things__a__b__any: [4, 3] }), 0)
      assert.equal(await dive({ things__a__b__all: [2, 1] }), 1)
      assert.equal(await dive({ things__a__b__all: [3, 2, 1] }), 0)

      assert.equal(await dive({ people__has: 'mary' }), 1)
      assert.equal(await dive({ people__has: 'dick' }), 0)
      assert.equal(await dive({ people__any: ['mary', 'dick'] }), 1)
      assert.equal(await dive({ people__any: ['harry', 'dick'] }), 0)
      assert.equal(await dive({ people__all: ['mary', 'tom'] }), 1)
      assert.equal(await dive({ people__all: ['tom', 'dick', 'mary'] }), 0)

      sent()

      await dive({ people: new Set(['tom', 'mary']) })

      assert.deepEqual(sent().map(shape), [['POST', '/meta', { filter: { people__eq: ['mary', 'tom'] } }]])
    })
  })

  describe('titles', () => {
    it('builds them from what the API sends back', async () => {
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
    })

    it('uses what is already loaded', async () => {
      await new Unit('people').create()

      const units = await Unit.many().retrieve()

      sent()

      assert.deepEqual((await units.titles()).ids, [1])
      assert.deepEqual(sent(), [])
    })
  })

  describe('update', () => {
    it('prepares fields', () => {
      // standard
      let field = new Field(int, { name: 'id' } as any)
      let values: Record<string, any> = {}

      rest.fieldInit(field)
      field.value = 1
      rest.updateField(field, values)

      assert.deepEqual(values, { id: 1 })
      assert.equal(field.original, 1)

      // not changed
      values = {}
      rest.updateField(field, values)

      assert.deepEqual(values, {})

      // auto
      field = new Field(int, { name: 'id', auto: true } as any)
      values = {}

      rest.fieldInit(field)
      field.value = 1
      rest.updateField(field, values)

      assert.deepEqual(values, {})
    })

    it('prepares fields for a mass update', () => {
      // standard
      let field = new Field(int, { name: 'id' } as any)
      let values: Record<string, any> = {}

      field.value = 1
      rest.fieldMass(field, values)

      assert.deepEqual(values, { id: 1 })

      // not changed
      field.changed = false
      values = {}
      rest.fieldMass(field, values)

      assert.deepEqual(values, {})
      assert.equal(field.changed, false)

      // auto
      field = new Field(int, { name: 'id', auto: true } as any)
      values = {}

      field.value = 1
      rest.fieldMass(field, values)

      assert.deepEqual(values, {})
    })

    it('updates many with the same values, in one request', async () => {
      await new Unit([['people'], ['stuff']]).create()

      sent()

      assert.equal(await Unit.many({ id: 2 }).set({ name: 'things' }).update(), 1)
      assert.deepEqual(sent().map(shape), [['PATCH', '/unit', { filter: { id__eq: 2 }, units: { name: 'things' } }]])

      assert.deepEqual((await Unit.many().retrieve()).name, ['people', 'things'])
    })

    it('updates everything when nothing narrows it', async () => {
      await new Unit('people').create()

      sent()

      assert.equal(await Unit.many().set({ name: 'solo' }).update(), 1)
      assert.deepEqual(sent().map(shape), [['PATCH', '/unit', { filter: {}, units: { name: 'solo' } }]])
    })

    it('updates by id, one request each, then the children', async () => {
      await new Unit([['people'], ['stuff']]).create()

      const unit = await Unit.one(2).retrieve()

      unit.name = 'thing'
      unit.test.add('moar')

      sent()

      assert.equal(await unit.update(), 1)
      assert.equal(unit.name, 'thing')
      assert.equal(unit.test[0].id, 1)
      assert.equal(unit.test[0].name, 'moar')

      assert.deepEqual(sent().map(shape), [
        ['PATCH', '/unit/2', { unit: { name: 'thing' } }],
        ['POST', '/test', { tests: [{ unit_id: 2, name: 'moar' }] }],
        ['PATCH', '/test/1', { test: {} }]
      ])

      const units = await Unit.many().retrieve()
      units[0].name = 'one'
      units[1].name = 'two'

      sent()

      assert.equal(await units.update(), 2)
      assert.deepEqual(sent().map(shape), [
        ['PATCH', '/unit/1', { unit: { name: 'one' } }],
        ['PATCH', '/unit/2', { unit: { name: 'two' } }]
      ])
    })

    it('puts the id in the path so it cannot escape it', async () => {
      const seen: Call[] = []

      // MockSource only keys by its own counter, so the API's answers are made up here.
      new RestSource('rest', {
        url: URL,
        fetch: async (url: string, init: any) => {
          seen.push({ method: init.method, url, headers: init.headers, init, body: JSON.parse(init.body) })

          return {
            status: 200,
            json: async () => (init.method === 'PATCH' ? { updated: 1 } : { slugs: [{ id: 'a/b?c', name: 'odd' }] })
          }
        }
      })

      const slug = await Slug.one({ id: 'a/b?c' }).retrieve()
      slug.name = 'even'

      assert.equal(await slug.update(), 1)
      assert.deepEqual(shape(seen[1]), ['PATCH', '/slug/a%2Fb%3Fc', { slug: { name: 'even' } }])
    })

    it('has nothing to go on without an id', async () => {
      const plain = await new Plain({ simple_id: 0, name: 'nope' }).create()

      await assert.rejects(
        () => plain.update(),
        (error: any) => error instanceof ModelError && error.message === 'plain: nothing to update from'
      )
      await assert.rejects(() => Plain.one().update(), /plain: nothing to update from/)
    })

    it('says what went wrong when the API refuses', async () => {
      await new Unit([['people'], ['stuff']]).create()

      await assert.rejects(
        () => Unit.many({ id: 2 }).set({ name: 'people' }).update(),
        /unit: unit: value {"name":"people"} violates unique name/
      )

      const again = await Unit.one(2).retrieve()
      again.name = 'people'

      await assert.rejects(() => again.update(), /unit: unit: value {"name":"people"} violates unique name/)
    })

    it('changes values inside containers', async () => {
      const meta = await new Meta({
        name: 'dive',
        people: new Set(['tom', 'mary']),
        stuff: [1, 2, 3, null],
        things: { a: { b: [1, 2], c: 'sure' }, '4': 5, for: [{ '1': 'yep' }] }
      }).create()

      meta.things.a.b[0] = 3
      assert.equal(meta.things__a__b__0, 3)

      sent()

      await meta.update()

      assert.deepEqual(sent().map(shape), [
        [
          'PATCH',
          `/meta/${meta.id}`,
          { meta: { things: { a: { b: [3, 2], c: 'sure' }, '4': 5, for: [{ '1': 'yep' }] } } }
        ]
      ])

      assert.equal((await Meta.one(meta.id).retrieve()).things__a__b__0, 3)
    })

    it('narrows a mass update the way a retrieve would be', async () => {
      const unit = await new Unit('people').create()
      await unit.test.add('stuff').add('things').create()
      await new Unit('empty').create()

      sent()

      assert.equal(await Test.many({ unit__name: 'people', name: 'things', like: 'th' }).set({ name: 'thang' }).update(), 1)

      assert.deepEqual(sent().map(shape), [
        ['POST', '/unit', { filter: { name__eq: 'people' }, limit: { per_page: 100 } }],
        ['PATCH', '/test', { filter: { name__eq: 'things', unit_id__in: [1], like: 'th' }, tests: { name: 'thang' } }]
      ])

      assert.deepEqual((await Test.many().retrieve()).name, ['stuff', 'thang'])
    })
  })

  describe('delete', () => {
    it('deletes by id, or by what matches', async () => {
      const unit = new Unit('people')
      unit.test.add('stuff').add('things')
      await unit.create()

      sent()

      assert.equal(await Test.one({ id: 2 }).delete(), 1)
      assert.deepEqual(sent().map(shape), [
        ['POST', '/test', { filter: { id__eq: 2 } }],
        ['DELETE', '/test', { filter: { id__in: [2] } }]
      ])

      assert.equal((await Test.many().retrieve()).size, 1)

      sent()

      assert.equal(await (await Unit.one(1).retrieve()).test.delete(), 1)
      assert.deepEqual(sent().map(shape).slice(-1), [['DELETE', '/test', { filter: { unit_id__eq: 1 } }]])

      const loaded = await Unit.one(1).retrieve()

      assert.equal(await loaded.delete(), 1)
      assert.equal(loaded._action, 'create')

      assert.equal((await Unit.many().retrieve()).size, 0)
      assert.equal((await Test.many().retrieve()).size, 0)
    })

    it('deletes everything it has loaded, and forgets it', async () => {
      await new Unit([['a'], ['b'], ['c']]).create()

      const units = await Unit.many().retrieve()

      sent()

      assert.equal(await units.delete(), 3)
      assert.deepEqual(sent().map(shape), [['DELETE', '/unit', { filter: { id__in: [1, 2, 3] } }]])

      assert.equal(units._action, 'create')
      assert.deepEqual(
        units._models.map((each: any) => each._action),
        ['create', 'create', 'create']
      )
    })

    it('leaves what it loaded alone when the API refuses', async () => {
      await new Unit('people').create()

      const unit = await Unit.one(1).retrieve()

      new RestSource('rest', { url: URL, fetch: answering(500, { message: 'no' }) })

      await assert.rejects(() => unit.delete(), /unit: no/)

      assert.equal(unit._action, 'update')
    })

    it('narrows a delete the way a retrieve would be', async () => {
      const unit = await new Unit('people').create()
      await unit.test.add('stuff').add('things').create()

      sent()

      assert.equal(await Test.many({ unit__name: 'people', name: 'things', like: 'th' }).delete(), 1)
      assert.deepEqual(sent().map(shape), [
        ['POST', '/unit', { filter: { name__eq: 'people' }, limit: { per_page: 100 } }],
        ['DELETE', '/test', { filter: { name__eq: 'things', unit_id__in: [1], like: 'th' } }]
      ])
    })

    it('has nothing to go on without an id', async () => {
      const plain = await new Plain({ simple_id: 0, name: 'nope' }).create()

      await assert.rejects(
        () => plain.delete(),
        (error: any) => error instanceof ModelError && error.message === 'plain: nothing to delete from'
      )
    })
  })

  describe('the fake itself', () => {
    it('refuses what resource.py would refuse', async () => {
      const call = async (method: string, path: string, body?: any) => {
        const response = await fake.fetch(`${URL}${path}`, {
          method,
          headers: {},
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        })

        return [response.status, await response.json()] as [number, any]
      }

      assert.equal((await call('GET', '/nope'))[0], 404)
      assert.equal((await call('GET', '/plain/1'))[0], 404)
      assert.equal((await call('GET', '/unit/1/2'))[0], 404)
      assert.equal((await call('GET', '/unit/1'))[0], 404)
      assert.equal((await call('PUT', '/unit'))[0], 405)
      assert.equal((await call('POST', '/unit/1', {}))[0], 405)
      assert.deepEqual(await call('POST', '/unit', {}), [400, { message: 'either unit or units required' }])
      assert.deepEqual(await call('PATCH', '/unit', {}), [400, { message: 'either unit or units required' }])
      assert.deepEqual(await call('PATCH', '/unit', { units: { name: 'x' } }), [
        400,
        { message: 'to confirm all, send a blank filter {}' }
      ])
      assert.deepEqual(await call('DELETE', '/unit'), [400, { message: 'to confirm all, send a blank filter {}' }])
      assert.equal((await call('PATCH', '/unit/9', { unit: { name: 'x' } }))[0], 404)
      assert.equal((await call('POST', '/unit', { filter: { nope: 1 } }))[0], 500)

      assert.deepEqual(await call('POST', '/unit', { unit: { name: 'one' } }), [201, { unit: { id: 1, name: 'one' } }])
      assert.deepEqual(await call('GET', '/unit/1'), [200, { unit: { id: 1, name: 'one' }, formats: {} }])
      assert.deepEqual(await call('GET', '/unit?name__eq=one&count=yes'), [200, { units: 1, overflow: false }])
      assert.deepEqual(await call('GET', '/unit?name__eq=one&count=0'), [
        200,
        { units: [{ id: 1, name: 'one' }], overflow: false, formats: {} }
      ])
      assert.deepEqual(await call('GET', '/unit?sort=-name&limit__per_page=1&limit__start=0&count=false'), [
        200,
        { units: [{ id: 1, name: 'one' }], overflow: true, formats: {} }
      ])
      assert.deepEqual(await call('POST', '/unit', { filter: {}, count: 1 }), [200, { units: 1, overflow: false }])
      assert.deepEqual(await call('PATCH', '/unit', { filter: { id__eq: 1 }, unit: { name: 'two' } }), [202, { updated: 1 }])
      assert.deepEqual(await call('DELETE', '/unit/1'), [202, { deleted: 1 }])
    })

    it('shows a crash as a 500 with a traceback', async () => {
      const response = await fake.fetch(`${URL}/unit`, { method: 'POST', headers: {}, body: JSON.stringify({ unit: null }) })
      const body = await response.json()

      assert.equal(response.status, 500)
      assert.ok(body.traceback)
    })
  })
})
