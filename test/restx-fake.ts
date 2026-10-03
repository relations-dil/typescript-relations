/**
 * A relations-restx API, in-process.
 *
 * `restxFake(...)` hands back a `fetch` that answers the way python-relations-restx's
 * `Resource` does (resource.py): the same endpoints, request bodies, response shapes and
 * status codes, on top of whatever source the server-side models use. It also records every
 * call it gets, so tests can assert on exactly what a client sent.
 */

import { ModelError } from '../src/index.js'
import type { ModelClass } from '../src/index.js'
import type { FetchInit, FetchResponse } from '../src/index.js'

/** A request as the fake received it. */
export interface Call {
  method: string
  url: string
  headers: Record<string, string>
  credentials?: string
  init: FetchInit
  /** The JSON body, parsed; undefined when there wasn't one. */
  body: any
}

/** A resource: a model, and the names it's served under. */
export type Served = ModelClass | { model: ModelClass; singular?: string; plural?: string; endpoint?: string }

/** A request that's wrong, as opposed to one that fails. */
class BadRequest extends Error {}

interface Resource {
  model: any
  singular: string
  plural: string
  id: string | null
}

const NOT_FOUND = 'The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.'
const NOT_ALLOWED = 'The method is not allowed for the requested URL.'

/** Bodies cross the wire as JSON, so nothing is shared by reference and sets become lists. */
function wire(value: any): any {
  return JSON.parse(JSON.stringify(value))
}

export function restxFake(served: Served[]) {
  const calls: Call[] = []
  const resources: Map<string, Resource> = new Map()

  for (const each of served) {
    const options = 'model' in each ? each : { model: each }
    const thy = (options.model as any).thy()

    const singular: string = options.singular ?? thy.NAME
    const plural: string = options.plural ?? `${singular}s`

    resources.set(options.endpoint ?? singular, { model: options.model, singular, plural, id: thy._id })
  }

  function handle(resource: Resource, method: string, id: string | null, query: URLSearchParams, json: any) {
    const Model = resource.model
    const { singular, plural } = resource

    const has = (name: string) => name in json

    function criteria(verify = false): Record<string, any> {
      if (verify && ![...query].length && !has('filter')) {
        throw new BadRequest('to confirm all, send a blank filter {}')
      }

      const found: Record<string, any> = {}

      for (const [name, value] of query) {
        if (!name.startsWith('limit') && !['sort', 'count'].includes(name)) {
          found[name] = value
        }
      }

      return Object.assign(found, json.filter)
    }

    function sort(): string[] {
      const sorting: string[] = []

      if (query.has('sort')) {
        sorting.push(...(query.get('sort') as string).split(','))
      }

      if (has('sort')) {
        sorting.push(...json.sort)
      }

      return sorting
    }

    // What Python's limit(**limit) takes: limit, start, page, per_page.
    function limit(): Record<string, number> {
      const limiting: Record<string, number> = {}

      for (const [name, value] of query) {
        if (name.startsWith('limit')) {
          limiting[name.split('__').pop() as string] = parseInt(value, 10)
        }
      }

      for (const [name, value] of Object.entries<any>(json.limit ?? {})) {
        limiting[name] = parseInt(value, 10)
      }

      return limiting
    }

    function counting(): boolean {
      let count: any = false

      if (query.has('count')) {
        count = query.get('count')
      }

      if (has('count')) {
        count = json.count
      }

      if (typeof count === 'boolean' || typeof count === 'number') {
        return Boolean(count)
      }

      return !['0', 'no', 'false'].includes(count.toLowerCase())
    }

    function many(found: Record<string, any>) {
      return Object.keys(found).length ? Model.many(found) : Model.many()
    }

    async function get(): Promise<[number, any]> {
      const { per_page: perPage, ...rest } = limit()
      const models = many(criteria()).sort(...sort()).limit(perPage === undefined ? rest : { ...rest, perPage })

      if (counting()) {
        return [200, { [plural]: await models.count(), overflow: models.overflow }]
      }

      await models.retrieve()

      return [200, { [plural]: models.export(), overflow: models.overflow, formats: {} }]
    }

    return (async (): Promise<[number, any]> => {
      if (id !== null) {
        if (method !== 'GET' && method !== 'PATCH' && method !== 'DELETE') {
          return [405, { message: NOT_ALLOWED }]
        }
      }

      if (method === 'POST' && id === null) {
        if (has('filter')) {
          return get()
        }

        if (has(singular)) {
          return [201, { [singular]: (await new Model(json[singular]).create()).export() }]
        }

        if (has(plural)) {
          return [201, { [plural]: (await new Model(json[plural]).create()).export() }]
        }

        throw new BadRequest(`either ${singular} or ${plural} required`)
      }

      if (method === 'GET') {
        if (id !== null) {
          const model = await Model.one({ [resource.id as string]: id }).retrieve()
          return [200, { [singular]: model.export(), formats: {} }]
        }

        return get()
      }

      if (method === 'PATCH') {
        if (!has(singular) && !has(plural)) {
          throw new BadRequest(`either ${singular} or ${plural} required`)
        }

        let model: any

        if (id !== null) {
          model = (await Model.one({ [resource.id as string]: id }).retrieve()).set(json[singular])
        } else if (has(singular)) {
          model = (await Model.one(criteria(true)).retrieve()).set(json[singular])
        } else {
          model = many(criteria(true)).set(json[plural])
        }

        return [202, { updated: await model.update() }]
      }

      if (method === 'DELETE') {
        const model = id !== null ? Model.one({ [resource.id as string]: id }) : many(criteria(true))

        return [202, { deleted: await model.delete() }]
      }

      return [405, { message: NOT_ALLOWED }]
    })()
  }

  /** What fetch would hand back for a request. */
  async function fetch(url: string, init: FetchInit): Promise<FetchResponse> {
    let body: any

    if (init.body !== undefined) {
      body = JSON.parse(init.body)
    }

    calls.push({ method: init.method, url, headers: init.headers, credentials: init.credentials, init, body })

    const parsed = new URL(url, 'http://fake.test')
    const [endpoint, id = null, ...extra] = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const resource = resources.get(endpoint)

    let status: number
    let json: any

    if (resource === undefined || extra.length || (id !== null && resource.id === null)) {
      ;[status, json] = [404, { message: NOT_FOUND }]
    } else {
      // The exceptions decorator: bad requests are 400, a record that isn't there is 404,
      // anything else is 500, and each carries a message.
      try {
        ;[status, json] = await handle(resource, init.method, id, parsed.searchParams, body ?? {})
      } catch (error: any) {
        if (error instanceof BadRequest) {
          status = 400
          json = { message: error.message }
        } else if (error instanceof ModelError) {
          status = error.message.includes('none retrieved') ? 404 : 500
          json = { message: error.message }
        } else {
          status = 500
          json = { message: error.message, traceback: error.stack }
        }
      }
    }

    return { status, json: async () => wire(json) }
  }

  return { fetch, calls }
}
