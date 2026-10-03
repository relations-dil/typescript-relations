/**
 * Sources: the abstract backend.
 *
 * Everything that actually stores data implements this. The methods that touch storage
 * are async, because in JavaScript anything that talks to a database, a socket, or a
 * file has to be. Everything else - definitions, migrations, query building - is plain
 * synchronous work on structures already in memory.
 */

import { ModelError } from './errors.js'
import { register } from './registry.js'
import type { Field } from './field.js'
import type { Record as FieldRecord } from './record.js'
import type { ManyToMany } from './relation.js'
import type { Model, ModelClass, ModelIdentity } from './model.js'

/** A query a source built but hasn't run. */
export interface Query {
  bind(model: Model): Query
  [member: string]: any
}

/**
 * Base source. Subclass it, give it a name, and register happens for you.
 *
 * ```ts
 * class MySource extends Source {
 *   async create(model) { ... }
 * }
 *
 * new MySource('example')   // models with `static source = 'example'` now use it
 * ```
 */
export class Source {
  /** Anything the subclass was constructed with. */
  [option: string]: any

  /** What kind of source this is, used to namespace migration files. */
  static KIND: string | null = null

  /** The name models refer to this source by. */
  name: string

  constructor(name: string, options: globalThis.Record<string, any> = {}) {
    this.name = name

    for (const [option, value] of Object.entries(options)) {
      this[option] = value
    }

    register(this as any)
  }

  /** What kind of source this is. */
  get KIND(): string | null {
    return (this.constructor as typeof Source).KIND
  }

  /** Give an object an attribute if it hasn't got one. */
  ensureAttribute(item: any, attribute: string, value: any = null): void {
    if (attribute in item) {
      return
    }

    item[attribute] = value
  }

  // ------------------------------------------------------------------ init

  /** Prepare a field for this source. */
  fieldInit(field: Field): void {}

  /** Prepare every field in a record. */
  recordInit(record: FieldRecord): void {
    for (const field of record._order) {
      this.fieldInit(field)
    }
  }

  /** Prepare a model. Called once per model identity. */
  init(model: ModelIdentity): void {
    this.recordInit(model._fields)
  }

  // ------------------------------------------------------------------ definitions

  /** Turn a field definition into whatever this source needs. */
  fieldDefine(field: globalThis.Record<string, any>, ...args: any[]): void {}

  /** Turn every field definition in a record. */
  recordDefine(record: globalThis.Record<string, any>[], ...args: any[]): void {
    for (const field of record) {
      this.fieldDefine(field, ...args)
    }
  }

  /** Turn a model definition into whatever this source needs. */
  define(model: globalThis.Record<string, any>, ...args: any[]): any {}

  // ------------------------------------------------------------------ migrations

  /** Add a field. */
  fieldAdd(migration: globalThis.Record<string, any>, ...args: any[]): void {}

  /** Remove a field. */
  fieldRemove(definition: globalThis.Record<string, any>, ...args: any[]): void {}

  /** Change a field. */
  fieldChange(definition: globalThis.Record<string, any>, migration: globalThis.Record<string, any>, ...args: any[]): void {}

  /** Apply a record's worth of field changes. */
  recordChange(
    definition: globalThis.Record<string, any>[],
    migration: globalThis.Record<string, any>,
    ...args: any[]
  ): void {
    for (const add of migration.add ?? []) {
      this.fieldAdd(add, ...args)
    }

    for (const remove of migration.remove ?? []) {
      this.fieldRemove(lookup(remove, definition) as globalThis.Record<string, any>, ...args)
    }

    for (const field of definition) {
      if (field.name in (migration.change ?? {})) {
        this.fieldChange(field, migration.change[field.name], ...args)
      }
    }
  }

  /** Add a model. */
  modelAdd(migration: globalThis.Record<string, any>): any {}

  /** Remove a model. */
  modelRemove(definition: globalThis.Record<string, any>): any {}

  /** Change a model. */
  modelChange(definition: globalThis.Record<string, any>, migration: globalThis.Record<string, any>): any {}

  // ------------------------------------------------------------------ create

  /** Prepare a field for a create. */
  createField(field: Field, ...args: any[]): void {}

  /** Prepare every field in a record for a create. */
  createRecord(record: FieldRecord, ...args: any[]): void {
    for (const field of record._order) {
      this.createField(field, ...args)
    }
  }

  /** The query that would create these records. */
  createQuery(model: Model, ...args: any[]): Query | undefined {
    return undefined
  }

  /** Whether any tie records need writing. */
  static hasTies(model: Model, data?: any): boolean {
    const values = data ?? model

    for (const relation of Object.values(model.SISTERS)) {
      if (relation.brotherSisterRef in values && filled((values as any)[relation.brotherSisterRef])) {
        return true
      }
    }

    for (const relation of Object.values(model.BROTHERS)) {
      if (relation.sisterBrotherRef in values && filled((values as any)[relation.sisterBrotherRef])) {
        return true
      }
    }

    return false
  }

  /** Write the tie records for a many-to-many. */
  static async createTies(model: Model, data?: any, ids?: any): Promise<void> {
    const values = data ?? model
    let keys = ids ?? (values as any)[model._id as string]

    if (!Array.isArray(keys)) {
      keys = [keys]
    }

    const write = async (relation: ManyToMany, ref: string, keyRef: string, valueRef: string) => {
      if (!(ref in values)) {
        return
      }

      const holder = values as any

      const records: globalThis.Record<string, any>[] = []

      for (const key of keys) {
        for (const value of holder[ref] ?? []) {
          records.push({ [keyRef]: key, [valueRef]: value })
        }
      }

      if (records.length) {
        await new (relation.Tie as any)(records).create()
      }
    }

    for (const relation of Object.values(model.SISTERS)) {
      await write(relation, relation.brotherSisterRef, relation.tieBrotherRef, relation.tieSisterRef)
    }

    for (const relation of Object.values(model.BROTHERS)) {
      await write(relation, relation.sisterBrotherRef, relation.tieSisterRef, relation.tieBrotherRef)
    }
  }

  /** Write records. Subclasses do the actual storing and call this first. */
  async create(model: Model, ...args: any[]): Promise<any> {
    if (model._bulk && Source.hasTies(model)) {
      throw new ModelError(model, 'cannot create ties in bulk mode')
    }
  }

  // ------------------------------------------------------------------ retrieve

  /** Prepare a field for a retrieve. */
  retrieveField(field: Field, ...args: any[]): void {}

  /** Prepare every field in a record for a retrieve. */
  retrieveRecord(record: FieldRecord, ...args: any[]): void {
    for (const field of record._order) {
      this.retrieveField(field, ...args)
    }
  }

  /** The ids on one side of a tie that match a set operator on the other. */
  static async tieIds(
    Tie: ModelClass,
    queryRef: string,
    resultRef: string,
    operator: string,
    values: any
  ): Promise<Set<any>> {
    const wanted = new Set<any>(values instanceof Set ? values : Array.isArray(values) ? values : [values])

    const ties = await (Tie as any).many({ [`${queryRef}__in`]: [...wanted] }).retrieve()

    const results: any[] = ties[resultRef]
    const queries: any[] = ties[queryRef]

    // "all" wants every requested value present, so group by the model side and
    // require the distinct match count to equal the de-duplicated request size.
    if (operator === 'all') {
      const matched = new Map<any, Set<any>>()

      results.forEach((result, index) => {
        if (!matched.has(result)) {
          matched.set(result, new Set())
        }
        matched.get(result)?.add(queries[index])
      })

      const found = new Set<any>()

      for (const [result, seen] of matched) {
        if (seen.size === wanted.size) {
          found.add(result)
        }
      }

      return found
    }

    // has, any, eq: tied to at least one of the requested values.
    return new Set(results)
  }

  /**
   * The ids tied to a sibling matching field criteria, for filters like
   * `{brother__name: 'Tom'}`. A model matches when it's tied to any such sibling.
   */
  static async attrIds(
    relation: ManyToMany,
    side: 'sister' | 'brother',
    criteria: globalThis.Record<string, any>
  ): Promise<Set<any>> {
    const Sibling = side === 'sister' ? relation.Sister : relation.Brother
    const siblingId = side === 'sister' ? relation.sisterId : relation.brotherId
    const queryRef = side === 'sister' ? relation.tieSisterRef : relation.tieBrotherRef
    const resultRef = side === 'sister' ? relation.tieBrotherRef : relation.tieSisterRef

    const siblings = await (Sibling as any).many(criteria).retrieve()
    const siblingIds: any[] = siblings[siblingId]

    if (!siblingIds.length) {
      return new Set()
    }

    return Source.tieIds(relation.Tie, queryRef, resultRef, 'any', siblingIds)
  }

  /**
   * Resolve tie criteria into plain id filters by walking the tie model. Handles both
   * tie-id criteria (`{brother_id__has: [...]}`) and sibling-attribute criteria
   * (`{brother__name: 'Tom'}`).
   */
  static async collateTies(model: Model): Promise<void> {
    if (!Object.keys(model.SISTERS).length && !Object.keys(model.BROTHERS).length) {
      return
    }

    let include: Set<any> | null = null
    const exclude = new Set<any>()
    let any = false

    const sides: [ManyToMany, string, string, string][] = [
      ...Object.values(model.SISTERS).map(
        (relation) =>
          [relation, relation.brotherSisterRef, relation.tieSisterRef, relation.tieBrotherRef] as [
            ManyToMany,
            string,
            string,
            string
          ]
      ),
      ...Object.values(model.BROTHERS).map(
        (relation) =>
          [relation, relation.sisterBrotherRef, relation.tieBrotherRef, relation.tieSisterRef] as [
            ManyToMany,
            string,
            string,
            string
          ]
      )
    ]

    for (const [relation, fieldRef, queryRef, resultRef] of sides) {
      const field = model._record?.field(fieldRef)

      if (!field?.criteria) {
        continue
      }

      any = true

      for (const [criterion, values] of Object.entries(field.criteria)) {
        const negate = criterion.startsWith('not_')
        const operator = negate ? criterion.slice(4) : criterion

        const matched = await Source.tieIds(relation.Tie, queryRef, resultRef, operator, values)

        if (negate) {
          for (const id of matched) {
            exclude.add(id)
          }
        } else {
          include = include === null ? matched : intersect(include, matched)
        }
      }

      field.criteria = {}
    }

    for (const [name, criteria] of Object.entries(model._ties)) {
      any = true

      const relation = name in model.SISTERS ? model.SISTERS[name] : model.BROTHERS[name]
      const side = name in model.SISTERS ? 'sister' : 'brother'

      const matched = await Source.attrIds(relation, side, criteria)

      include = include === null ? matched : intersect(include, matched)
    }

    model._ties = {}

    if (!any) {
      return
    }

    if (include !== null) {
      model._record?.filter(`${model._id}__in`, [...include])
    }

    if (exclude.size) {
      model._record?.filter(`${model._id}__not_in`, [...exclude])
    }
  }

  /** Fill in the tie fields on retrieved records. */
  static async retrieveTies(model: Model): Promise<void> {
    for (const retrieved of model._each()) {
      const holder = retrieved as any

      for (const relation of Object.values(model.SISTERS)) {
        const ties = await (relation.Tie as any)
          .many({ [relation.tieBrotherRef]: holder[relation.brotherId] })
          .retrieve()
        holder[relation.brotherSisterRef] = ties[relation.tieSisterRef]
      }

      for (const relation of Object.values(model.BROTHERS)) {
        const ties = await (relation.Tie as any)
          .many({ [relation.tieSisterRef]: holder[relation.sisterId] })
          .retrieve()
        holder[relation.sisterBrotherRef] = ties[relation.tieBrotherRef]
      }
    }
  }

  /** The query that would count matching records. */
  countQuery(model: Model, ...args: any[]): Query | undefined {
    return undefined
  }

  /** Count matching records. Subclasses do the counting and call this first. */
  async count(model: Model, ...args: any[]): Promise<any> {
    await Source.collateTies(model)
  }

  /** The query that would retrieve matching records. */
  retrieveQuery(model: Model, ...args: any[]): Query | undefined {
    return undefined
  }

  /** Read records. Subclasses do the reading and call this first. */
  async retrieve(model: Model, verify = true, ...args: any[]): Promise<any> {
    await Source.collateTies(model)
  }

  // ------------------------------------------------------------------ titles

  /** The query that would retrieve titles. */
  titlesQuery(model: Model, ...args: any[]): Query | undefined {
    return undefined
  }

  /** Titles for matching records. Subclasses build them and call this first. */
  async titles(model: Model, ...args: any[]): Promise<any> {
    if (model._action === 'retrieve') {
      await Source.collateTies(model)
    }
  }

  // ------------------------------------------------------------------ update

  /** Prepare a field for an update. */
  updateField(field: Field, ...args: any[]): void {}

  /** Prepare every field in a record for an update. */
  updateRecord(record: FieldRecord, ...args: any[]): void {
    for (const field of record._order) {
      this.updateField(field, ...args)
    }
  }

  /** Prepare a field for a mass update. */
  fieldMass(field: Field, ...args: any[]): void {}

  /** Prepare every field in a record for a mass update. */
  recordMass(record: FieldRecord, ...args: any[]): void {
    for (const field of record._order) {
      this.fieldMass(field, ...args)
    }
  }

  /** The query that would update records. */
  updateQuery(model: Model, ...args: any[]): Query | undefined {
    return undefined
  }

  /** Write changes. Resolves to how many records changed. */
  async update(model: Model, ...args: any[]): Promise<number> {
    return 0
  }

  // ------------------------------------------------------------------ delete

  /** Prepare a field for a delete. */
  deleteField(field: Field, ...args: any[]): void {}

  /** Prepare every field in a record for a delete. */
  deleteRecord(record: FieldRecord, ...args: any[]): void {
    for (const field of record._order) {
      this.deleteField(field, ...args)
    }
  }

  /** The query that would delete records. */
  deleteQuery(model: Model, ...args: any[]): Query | undefined {
    return undefined
  }

  /** Remove the tie records for a many-to-many. */
  static async deleteTies(model: Model, ids?: any): Promise<void> {
    let keys = ids ?? (model as any)[model._id as string]

    if (!Array.isArray(keys)) {
      keys = [keys]
    }

    for (const relation of Object.values(model.SISTERS)) {
      await (relation.Tie as any).many({ [`${relation.tieBrotherRef}__in`]: keys }).delete()
    }

    for (const relation of Object.values(model.BROTHERS)) {
      await (relation.Tie as any).many({ [`${relation.tieSisterRef}__in`]: keys }).delete()
    }
  }

  /** Remove records. Resolves to how many were removed. */
  async delete(model: Model, ...args: any[]): Promise<number> {
    return 0
  }

  // ------------------------------------------------------------------ files

  /** Convert a general definition file into a source-specific one. */
  async definition(filePath: string, sourcePath: string): Promise<void> {}

  /** Convert a general migration file into a source-specific one. */
  async migration(filePath: string, sourcePath: string): Promise<void> {}

  /** Run a command or commands against the source. */
  async execute(commands: any): Promise<void> {}

  /** The migration pairs available for this source. */
  async list(sourcePath: string): Promise<globalThis.Record<string, any>> {
    return {}
  }

  /** Load a definition or migration file into the source. */
  async load(filePath: string): Promise<void> {}

  /** Bring the source up to date with everything in a migration directory. */
  async migrate(sourcePath: string): Promise<boolean> {
    return false
  }
}

/** A field definition by name. */
export function lookup(
  name: string,
  fields: globalThis.Record<string, any>[]
): globalThis.Record<string, any> | null {
  for (const field of fields) {
    if (name === field.name) {
      return field
    }
  }

  return null
}

/** Truthy the way Python is: an empty Set, array or object counts as nothing. */
function filled(value: any): boolean {
  if (value instanceof Set || value instanceof Map) {
    return value.size > 0
  }
  if (Array.isArray(value)) {
    return value.length > 0
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).length > 0
  }
  return Boolean(value)
}

function intersect(first: Set<any>, second: Set<any>): Set<any> {
  return new Set([...first].filter((item) => second.has(item)))
}
