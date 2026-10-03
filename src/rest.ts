/**
 * A source whose backend is a relations-restx API.
 *
 * The models stay exactly as they were; only the source they name changes. Swap `MockSource`
 * or `LocalSource` for this one and the same code reads and writes a remote service.
 *
 * ```ts
 * import { RestSource } from '@relations-dil/relations/rest'
 *
 * new RestSource('example', { url: 'https://api.example.com' })
 * ```
 *
 * Browsers can't send a body with a GET, so reads are sent as `POST /<endpoint>` with a
 * `{"filter": ...}` body, which relations-restx treats exactly like a GET.
 */

import { ModelError } from './errors.js'
import { Source } from './source.js'
import { Titles } from './titles.js'
import { sorted } from './util.js'
import { construct, type Model, type ModelIdentity } from './model.js'
import type { Field } from './field.js'
import type { Record as FieldRecord } from './record.js'

/** The part of a fetch response that's used, so anything fetch-shaped can stand in. */
export interface FetchResponse {
  status: number
  json(): Promise<any>
}

/** The part of fetch's init that's used. */
export interface FetchInit {
  method: string
  headers: globalThis.Record<string, string>
  body?: string
  credentials?: string
  [option: string]: any
}

/** Anything shaped like `fetch`. */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>

type Values = globalThis.Record<string, any>

/** A set goes over the wire as a sorted list. */
function wire(value: any): any {
  return value instanceof Set ? sorted(value) : value
}

/** A source that uses a relations-restx API as its backend. */
export class RestSource extends Source {
  /** Where the API lives, without a trailing slash. */
  declare url: string
  /** The fetch every request goes through. */
  declare fetch: FetchLike
  /** Headers sent with every request. */
  declare headers: globalThis.Record<string, string>
  /** Passed to fetch as `credentials`, e.g. `'include'` to send cookies. */
  declare credentials: string | undefined
  /** Anything else to hand fetch on every request, like `mode` or `cache`. */
  declare request: globalThis.Record<string, any>

  constructor(name: string, options: globalThis.Record<string, any> = {}) {
    if (typeof options.url !== 'string') {
      throw new Error(`${name}: no url - pass options.url`)
    }

    const fetcher = options.fetch ?? (globalThis as any).fetch

    if (typeof fetcher !== 'function') {
      throw new Error(`${name}: no fetch here - pass options.fetch`)
    }

    super(name, options)

    // Called bare, so a browser's own fetch doesn't complain about what it was called on.
    this.fetch = (url, init) => fetcher(url, init)
    this.url = options.url.replace(/\/+$/, '')
    this.headers = { ...options.headers }
    this.credentials = options.credentials
    this.request = { ...options.request }
  }

  /** Send a request, always with a JSON body, and hand back the response. */
  async send(method: string, path: string, body: any): Promise<FetchResponse> {
    const init: FetchInit = {
      ...this.request,
      method,
      headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify(body)
    }

    if (this.credentials !== undefined) {
      init.credentials = this.credentials
    }

    return this.fetch(`${this.url}/${path}`, init)
  }

  /** Checks a response and returns the result. */
  async result(model: Model, key: string, response: FetchResponse): Promise<any> {
    let body: any

    try {
      body = await response.json()
    } catch {
      body = null
    }

    if (response.status >= 400) {
      throw new ModelError(model, body?.message ?? 'API Error')
    }

    if (body === null || typeof body !== 'object') {
      throw new ModelError(model, 'API Error')
    }

    if ('overflow' in body) {
      model.overflow = model.overflow || body.overflow
    }

    return body[key]
  }

  /** Init the model. */
  init(model: ModelIdentity): void {
    this.recordInit(model._fields)

    model.SINGULAR = model.SINGULAR ?? model.NAME
    model.PLURAL = model.PLURAL ?? `${model.SINGULAR}s`
    model.ENDPOINT = model.ENDPOINT ?? model.SINGULAR

    if (model._id !== null) {
      const field = model._fields.field(model._id) as Field

      if (field.auto === null) {
        field.auto = true
      }
    }
  }

  // ------------------------------------------------------------------ create

  /** Updates values with the field's that changed. */
  createField(field: Field, values: Values): void {
    if (!field.auto) {
      values[field.name as string] = field.export()
      field.original = field.export()
    }
  }

  /** Executes the create. */
  async create(model: Model): Promise<Model> {
    const models = model._each('create')
    const values: Values[] = []

    for (const creating of models) {
      const record: Values = {}

      this.createRecord(creating._record as FieldRecord, record)
      values.push(record)
    }

    const records: Values[] = await this.result(
      model,
      model.PLURAL,
      await this.send('POST', model.ENDPOINT, { [model.PLURAL]: values })
    )

    for (const [index, creating] of models.entries()) {
      if (model._id !== null && (model._fields.field(model._id) as Field).auto) {
        ;(creating as any)[model._id] = records[index][model._id]
      }

      if (!model._bulk) {
        for (const attr of Object.keys(creating.CHILDREN)) {
          const child = creating._children[attr]

          if (child) {
            await child.create()
          }
        }
      }

      creating._action = 'update'
      ;(creating._record as FieldRecord)._action = 'update'
    }

    if (model._bulk) {
      model._models = []
    } else {
      model._action = 'update'
    }

    return model
  }

  // ------------------------------------------------------------------ retrieve

  /** Adds criteria to the filter. */
  retrieveField(field: Field, criteria: Values): void {
    for (const [operator, value] of Object.entries(field.criteria ?? {})) {
      criteria[`${field.name}__${operator}`] = wire(value)
    }
  }

  /**
   * Adds sibling-attribute filters (model._ties, e.g. bro__name: 'Tom') to the filter so the
   * remote API resolves them through many(); the tie field lives on the model, not the record.
   */
  static filterTies(model: Model, criteria: Values): void {
    for (const [name, attrs] of Object.entries(model._ties)) {
      for (const [predicate, value] of Object.entries(attrs)) {
        criteria[`${name}__${predicate}`] = wire(value)
      }
    }
  }

  /** Everything that narrows the model down, as the API wants it. */
  async filter(model: Model): Promise<Values> {
    await model._collate()

    const criteria: Values = {}

    this.retrieveRecord(model._record as FieldRecord, criteria)
    RestSource.filterTies(model, criteria)

    if (model._like !== null) {
      criteria.like = model._like
    }

    return criteria
  }

  /** Executes the count. */
  async count(model: Model): Promise<number> {
    const body = { filter: await this.filter(model), count: true }

    return this.result(model, model.PLURAL, await this.send('POST', model.ENDPOINT, body))
  }

  /** Executes the retrieve. */
  async retrieve(model: Model, verify = true): Promise<Model | null> {
    const body: Values = { filter: await this.filter(model) }

    if (model._sort?.length) {
      body.sort = model._sort
    }

    if (model._limit !== null) {
      body.limit = { per_page: model._limit }

      if (model._offset) {
        body.limit.start = model._offset
      }
    }

    const matches: Values[] = await this.result(model, model.PLURAL, await this.send('POST', model.ENDPOINT, body))

    if (model._mode === 'one' && matches.length > 1) {
      throw new ModelError(model, 'more than one retrieved')
    }

    if (model._mode === 'one' && model._role !== 'child') {
      if (matches.length < 1) {
        if (verify) {
          throw new ModelError(model, 'none retrieved')
        }

        return null
      }

      model._record = model._build('update', { read: matches[0] })
      model._action = 'update'
      this.retrieveTies(model, matches[0])

      return model
    }

    model._models = []

    for (const match of matches) {
      const retrieved = construct(model.constructor as any, { read: match })

      this.retrieveTies(retrieved, match)
      model._models.push(retrieved)
    }

    model._record = null
    model._action = 'update'

    return model
  }

  /**
   * Loads the tie ids the API already resolved onto the model.
   *
   * Other sources query the tie table; the API has no tie endpoint but returns the
   * resolved ids inline, so they're read straight off the response.
   */
  retrieveTies(model: Model, read: Values): void {
    for (const relation of Object.values(model.SISTERS)) {
      if (relation.brotherSisterRef in read) {
        ;(model as any)[relation.brotherSisterRef] = read[relation.brotherSisterRef]
      }
    }

    for (const relation of Object.values(model.BROTHERS)) {
      if (relation.sisterBrotherRef in read) {
        ;(model as any)[relation.sisterBrotherRef] = read[relation.sisterBrotherRef]
      }
    }
  }

  // ------------------------------------------------------------------ titles

  /** Creates the titles structure. */
  async titles(model: Model): Promise<Titles> {
    if (model._action === 'retrieve') {
      await this.retrieve(model)
    }

    const titles = await Titles.build(model)

    for (const titling of model._each()) {
      titles.add(titling)
    }

    return titles
  }

  // ------------------------------------------------------------------ update

  /** Updates values with the field's that changed. */
  updateField(field: Field, values: Values): void {
    if (!field.auto && field.delta()) {
      field.original = field.export()
      values[field.name as string] = field.original
    }
  }

  /** Mass values with the field's that changed. */
  fieldMass(field: Field, values: Values): void {
    if (!field.auto && field.changed) {
      values[field.name as string] = field.export()
    }
  }

  /** Executes the update. */
  async update(model: Model): Promise<number> {
    let updated = 0

    if (model._action === 'retrieve' && (model._record as FieldRecord)._action === 'update') {
      // The model is still retrieving but has values set: change everything it matches.

      const criteria = await this.filter(model)
      const values: Values = {}

      this.recordMass(model._record as FieldRecord, values)

      updated += await this.result(
        model,
        'updated',
        await this.send('PATCH', model.ENDPOINT, { filter: criteria, [model.PLURAL]: values })
      )
    } else if (model._id) {
      for (const updating of model._each('update')) {
        const values: Values = {}

        this.updateRecord(updating._record as FieldRecord, values)

        updated += await this.result(
          updating,
          'updated',
          await this.send('PATCH', `${model.ENDPOINT}/${encodeURIComponent((updating as any)[model._id])}`, {
            [model.SINGULAR]: values
          })
        )

        for (const attr of Object.keys(updating.CHILDREN)) {
          const child = updating._children[attr]

          if (child) {
            await child.create()
            await child.update()
          }
        }
      }
    } else {
      throw new ModelError(model, 'nothing to update from')
    }

    return updated
  }

  // ------------------------------------------------------------------ delete

  /** Executes the delete. */
  async delete(model: Model): Promise<number> {
    let criteria: Values = {}
    let deleting: Model[] = []

    if (model._action === 'retrieve') {
      criteria = await this.filter(model)
    } else if (model._id) {
      deleting = model._each()
      criteria[`${model._id}__in`] = deleting.map((each) => (each as any)[model._id as string])
    } else {
      throw new ModelError(model, 'nothing to delete from')
    }

    const deleted = await this.result(model, 'deleted', await this.send('DELETE', model.ENDPOINT, { filter: criteria }))

    for (const each of deleting) {
      each._action = 'create'
    }

    if (model._action !== 'retrieve') {
      model._action = 'create'
    }

    return deleted
  }
}

RestSource.KIND = 'rest'
