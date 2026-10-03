/**
 * An in-memory source.
 *
 * Everything relations can do, done against plain objects in this process. Use it in
 * tests, in examples, and to feel out a model's shape before you pick a backend.
 *
 * ```ts
 * import { MockSource } from '@relations-dil/relations/mock'
 *
 * new MockSource('example')
 * ```
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import * as overscore from './overscore.js'
import { ModelError, UniqueError } from './errors.js'
import { Source, type Query } from './source.js'
import { Titles } from './titles.js'
import { clone, stable } from './util.js'
import { construct, type Model, type ModelIdentity } from './model.js'
import type { Field } from './field.js'

/** A stand-in for a real source's query object. */
export class MockQuery implements Query {
  /** What the query would do. */
  action: string
  /** The model it was built for. */
  model: Model | null = null

  constructor(action: string) {
    this.action = action
  }

  /** Attach the model, the way a real query builder would. */
  bind(model: Model): this {
    this.model = model
    return this
  }
}

type Stored = globalThis.Record<string, any>

/** A complete source that keeps everything in memory. */
export class MockSource extends Source {
  static KIND = 'mock'

  /** Query classes, so tests can assert on what would run. */
  SELECT: typeof MockQuery = MockQuery
  INSERT: typeof MockQuery = MockQuery
  UPDATE: typeof MockQuery = MockQuery
  DELETE: typeof MockQuery = MockQuery

  /** Last id handed out, keyed by model name. */
  ids: globalThis.Record<string, number> = {}
  /** Records keyed by id, keyed by model name. */
  data: globalThis.Record<string, Map<number, Stored>> = {}
  /** Unique index values keyed by id, keyed by index, keyed by model name. */
  unique: globalThis.Record<string, globalThis.Record<string, Map<number, string>>> = {}
  /** Migrations applied so far, or null when nothing has been loaded. */
  migrations: string[] | null = null

  /** Snapshot taken while a write is in flight, so a failure can roll back. */
  transaction: [typeof this.ids, typeof this.data, typeof this.unique] | null = null

  constructor(name: string, options: globalThis.Record<string, any> = {}) {
    super(name, options)

    this.ids = {}
    this.data = {}
    this.unique = {}
    this.migrations = null
  }

  /** Make room for a model, and give it an auto id if it has an id field. */
  init(model: ModelIdentity): void {
    this.recordInit(model._fields)

    // Even models without an id field get one internally. It just isn't visible.
    const name = model.NAME as string

    this.ids[name] = this.ids[name] ?? 0
    this.data[name] = this.data[name] ?? new Map()
    this.unique[name] = this.unique[name] ?? {}

    for (const unique of Object.keys(model._unique)) {
      this.unique[name][unique] = this.unique[name][unique] ?? new Map()
    }

    if (model._id !== null) {
      const field = model._fields.field(model._id) as Field
      if (field.auto === null) {
        field.auto = true
      }
    }
  }

  // ------------------------------------------------------------------ definitions

  fieldDefine(field: Stored, definitions: Stored[]): void {
    definitions.push(field)
  }

  define(model: Stored): Stored[] {
    const definitions: Stored[] = []

    this.recordDefine(model.fields, definitions)

    return [{ ACTION: 'add', ...model, fields: definitions }]
  }

  fieldAdd(migration: Stored, migrations: Stored[]): void {
    const definitions: Stored[] = []

    this.fieldDefine(migration, definitions)

    migrations.push(...definitions.map((definition) => ({ ...definition, ACTION: 'add' })))
  }

  fieldRemove(definition: Stored, migrations: Stored[]): void {
    migrations.push({ ACTION: 'remove', ...definition })
  }

  fieldChange(definition: Stored, migration: Stored, migrations: Stored[]): void {
    migrations.push({ ACTION: 'change', DEFINITION: definition, MIGRATION: migration })
  }

  modelAdd(definition: Stored): Stored[] {
    return this.define(definition)
  }

  modelRemove(definition: Stored): Stored[] {
    return [{ ACTION: 'remove', ...definition }]
  }

  modelChange(definition: Stored, migration: Stored): Stored[] {
    const migrations: Stored[] = []

    this.recordChange(definition.fields, migration.fields ?? {}, migrations)

    return [{ ACTION: 'change', DEFINITION: definition, MIGRATION: { ...migration, fields: migrations } }]
  }

  // ------------------------------------------------------------------ storage helpers

  /** Copy extracted paths out of container fields into their own stored keys. */
  static extract(model: Model, values: Stored): Stored {
    for (const field of model._fields._order) {
      if (!field.extract) {
        continue
      }
      for (const path of Object.keys(field.extract)) {
        values[`${field.store}__${path}`] = overscore.get(values[field.store as string], path)
      }
    }

    return values
  }

  /** Check every unique index, recording the new value or throwing. */
  uniques(model: Model, values: Stored, id: number): void {
    const name = model.NAME as string

    for (const [unique, fields] of Object.entries(model._unique)) {
      const value = stable(Object.fromEntries(fields.map((field) => [field, overscore.get(values, field)])))

      for (const [key, exists] of this.unique[name][unique]) {
        if (value === exists && id !== key) {
          throw new UniqueError(model, `value ${value} violates unique ${unique}`)
        }
      }

      this.unique[name][unique].set(id, value)
    }
  }

  /** Run a write with a snapshot in place, restoring it if the write fails. */
  private async rolling<T>(work: () => Promise<T>): Promise<T> {
    if (this.transaction !== null) {
      return work()
    }

    this.transaction = clone([this.ids, this.data, this.unique])

    try {
      const result = await work()
      this.transaction = null
      return result
    } catch (error) {
      const snapshot = this.transaction as NonNullable<typeof this.transaction>
      this.ids = snapshot[0]
      this.data = snapshot[1]
      this.unique = snapshot[2]
      this.transaction = null
      throw error
    }
  }

  // ------------------------------------------------------------------ create

  createQuery(model: Model): Query {
    return new this.INSERT('CREATE')
  }

  async create(model: Model): Promise<Model> {
    await super.create(model)

    return this.rolling(async () => {
      const name = model.NAME as string

      for (const creating of model._each('create')) {
        const values = (creating._record as any).create({})

        this.ids[name] += 1

        this.uniques(model, values, this.ids[name])

        if (model._id !== null && (values[model._id] ?? null) === null) {
          values[(model._fields.field(model._id) as Field).store as string] = this.ids[name]
          ;(creating as any)[model._id] = this.ids[name]
        }

        this.data[name].set(this.ids[name], MockSource.extract(creating, values))

        if (!model._bulk) {
          if (model._id) {
            await Source.createTies(creating)
          }

          for (const attr of Object.keys(creating.CHILDREN)) {
            const child = creating._children[attr]
            if (child) {
              await child.create()
            }
          }

          creating._action = 'update'
          ;(creating._record as any)._action = 'update'
        }
      }

      if (model._bulk) {
        model._models = []
      } else {
        model._action = 'update'
      }

      return model
    })
  }

  // ------------------------------------------------------------------ retrieve

  /** The records matching a fuzzy `like`, including matches through parent titles. */
  async modelLike(model: Model): Promise<Stored[]> {
    const parents: globalThis.Record<string, any[]> = {}

    for (const field of model._titles) {
      const relation = model._ancestor(field)
      if (relation) {
        const parent = await (relation.Parent as any).many({ like: model._like }).limit(model._chunk).retrieve()
        parents[(model._fields.field(field) as Field).store as string] = parent[relation.parentId]
        model.overflow = model.overflow || parent.overflow
      }
    }

    const likes: Stored[] = []

    for (const record of this.data[model.NAME as string].values()) {
      if ((model._record as any).like(record, model._titles, model._like, parents)) {
        likes.push(record)
      }
    }

    return likes
  }

  /** Apply the model's sort, or its default order. */
  static modelSort(model: Model): void {
    const sort = model._sort ?? model._order

    if (sort.length) {
      model.sort(...sort)
      model._sort = null
    }
  }

  /** Apply the model's limit, flagging overflow when it was reached. */
  static modelLimit(model: Model): void {
    if (model._limit === null) {
      return
    }

    model._models = (model._models ?? []).slice(model._offset, model._offset + model._limit)
    model.overflow = model.overflow || model._models.length >= model._limit
  }

  countQuery(model: Model): Query {
    return new this.SELECT('COUNT')
  }

  async count(model: Model): Promise<number> {
    await super.count(model)

    await model._collate()

    const values =
      model._like !== null ? await this.modelLike(model) : [...this.data[model.NAME as string].values()]

    let matches = 0

    for (const record of values) {
      if ((model._record as any).retrieve(record)) {
        matches += 1
      }
    }

    return matches
  }

  retrieveQuery(model: Model): Query {
    return new this.SELECT('RETRIEVE')
  }

  async retrieve(model: Model, verify = true): Promise<Model | null> {
    await super.retrieve(model, verify)

    await model._collate()

    const values =
      model._like !== null ? await this.modelLike(model) : [...this.data[model.NAME as string].values()]

    const matches: Stored[] = []

    for (const record of values) {
      if ((model._record as any).retrieve(record)) {
        matches.push(record)
      }
    }

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
    } else {
      model._models = matches.map((match) =>
        construct(model.constructor as any, { read: match })
      )
      model._record = null
    }

    model._action = 'update'

    if (model._mode === 'many') {
      MockSource.modelSort(model)
      MockSource.modelLimit(model)
    }

    await Source.retrieveTies(model)

    return model
  }

  // ------------------------------------------------------------------ titles

  titlesQuery(model: Model): Query {
    return new this.SELECT('TITLES')
  }

  async titles(model: Model): Promise<Titles> {
    await super.titles(model)

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

  updateQuery(model: Model): Query {
    return new this.UPDATE('UPDATE')
  }

  async update(model: Model): Promise<number> {
    return this.rolling(async () => {
      const name = model.NAME as string
      let updated = 0

      if (model._action === 'retrieve' && (model._record as any)._action === 'update') {
        // A mass update: every matching record gets the same values.
        const values = (model._record as any).mass({})
        const ties = (model._record as any).tie({})

        for (const [id, data] of this.data[name]) {
          if ((model._record as any).retrieve(data)) {
            updated += 1
            const updating = { ...data, ...values }
            this.uniques(model, updating, id)
            Object.assign(data, MockSource.extract(model, clone(values)))
            await Source.deleteTies(model, id)
            await Source.createTies(model, { ...updating, ...ties })
          }
        }
      } else if (model._id) {
        for (const updating of model._each('update')) {
          const data = MockSource.extract(updating, (updating._record as any).update({}))
          this.uniques(model, data, (updating as any)[model._id])
          Object.assign(this.data[name].get((updating as any)[model._id]) as Stored, data)

          await Source.deleteTies(updating)
          await Source.createTies(updating)

          updated += 1

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
    })
  }

  // ------------------------------------------------------------------ delete

  deleteQuery(model: Model): Query {
    return new this.DELETE('DELETE')
  }

  async delete(model: Model): Promise<number> {
    return this.rolling(async () => {
      const name = model.NAME as string
      const ids: number[] = []

      if (model._action === 'retrieve') {
        for (const [id, record] of this.data[name]) {
          if ((model._record as any).retrieve(record)) {
            ids.push(id)
          }
        }
      } else if (model._id) {
        for (const deleting of model._each()) {
          ids.push((deleting as any)[model._id])
          deleting._action = 'create'
        }

        model._action = 'create'
      } else {
        throw new ModelError(model, 'nothing to delete from')
      }

      for (const id of ids) {
        this.data[name].delete(id)

        for (const unique of Object.keys(model._unique)) {
          this.unique[name][unique].delete(id)
        }

        await Source.deleteTies(model, id)
      }

      return ids.length
    })
  }

  // ------------------------------------------------------------------ files

  async definition(filePath: string, sourcePath: string): Promise<void> {
    const definitions: Stored[] = []
    const definition = JSON.parse(await readFile(filePath, 'utf8'))

    for (const name of Object.keys(definition).sort()) {
      if (definition[name].source === this.name) {
        definitions.push(...this.define(definition[name]))
      }
    }

    if (definitions.length) {
      await write(sourcePath, filePath, definitions)
    }
  }

  async migration(filePath: string, sourcePath: string): Promise<void> {
    const migrations: Stored[] = []
    const migration = JSON.parse(await readFile(filePath, 'utf8'))

    for (const add of Object.keys(migration.add ?? {}).sort()) {
      if (migration.add[add].source === this.name) {
        migrations.push(...this.modelAdd(migration.add[add]))
      }
    }

    for (const remove of Object.keys(migration.remove ?? {}).sort()) {
      if (migration.remove[remove].source === this.name) {
        migrations.push(...this.modelRemove(migration.remove[remove]))
      }
    }

    for (const change of Object.keys(migration.change ?? {}).sort()) {
      if (migration.change[change].definition.source === this.name) {
        migrations.push(
          ...this.modelChange(migration.change[change].definition, migration.change[change].migration)
        )
      }
    }

    if (migrations.length) {
      await write(sourcePath, filePath, migrations)
    }
  }

  async execute(models: Stored | Stored[]): Promise<void> {
    const each = Array.isArray(models) ? models : [models]

    for (const model of each) {
      if (model.ACTION === 'add') {
        this.data[model.name] = this.data[model.name] ?? new Map()
        this.ids[model.name] = this.ids[model.name] ?? 0
      } else if (model.ACTION === 'remove') {
        delete this.data[model.name]
        delete this.ids[model.name]
      } else if (model.ACTION === 'change') {
        const name = model.MIGRATION.name ?? model.DEFINITION.name

        if (model.DEFINITION.name !== name) {
          this.data[name] = this.data[model.DEFINITION.name]
          this.ids[name] = this.ids[model.DEFINITION.name]

          delete this.data[model.DEFINITION.name]
          delete this.ids[model.DEFINITION.name]
        }

        for (const field of model.MIGRATION.fields ?? []) {
          if (field.ACTION === 'add') {
            for (const record of this.data[name].values()) {
              record[field.store] = field.default ?? null
            }
          } else if (field.ACTION === 'remove') {
            for (const record of this.data[name].values()) {
              delete record[field.store]
            }
          } else if (field.ACTION === 'change') {
            const store = field.MIGRATION.store ?? field.DEFINITION.store

            if (field.DEFINITION.store !== store) {
              for (const record of this.data[name].values()) {
                record[store] = record[field.DEFINITION.store]
                delete record[field.DEFINITION.store]
              }
            }
          }
        }
      }
    }
  }

  async load(loadPath: string): Promise<void> {
    await this.execute(JSON.parse(await readFile(loadPath, 'utf8')))
  }

  async list(sourcePath: string): Promise<globalThis.Record<string, any>> {
    const migrations: globalThis.Record<string, any> = {}

    for (const fileName of await readdir(sourcePath)) {
      if (!fileName.endsWith('.json') || !fileName.includes('-')) {
        continue
      }

      const base = fileName.split('.')[0]
      const at = base.indexOf('-')
      const kind = base.slice(0, at)
      const stamp = base.slice(at + 1)

      migrations[stamp] = migrations[stamp] ?? {}
      migrations[stamp][kind] = fileName
    }

    return migrations
  }

  async migrate(sourcePath: string): Promise<boolean> {
    let migrated = false

    const paths = (await readdir(sourcePath))
      .filter((file) => file.startsWith('migration-') && file.endsWith('.json'))
      .sort()

    if (this.migrations === null) {
      this.migrations = []

      await this.load(join(sourcePath, 'definition.json'))
      migrated = true
    } else {
      for (const path of paths) {
        if (!this.migrations.includes(stampOf(path))) {
          await this.load(join(sourcePath, path))
          migrated = true
        }
      }
    }

    for (const path of paths) {
      const stamp = stampOf(path)
      if (!this.migrations.includes(stamp)) {
        this.migrations.push(stamp)
      }
    }

    return migrated
  }
}

function stampOf(path: string): string {
  return path.split('/').pop()?.replace(/^migration-/, '').split('.')[0] as string
}

async function write(sourcePath: string, filePath: string, contents: unknown): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  const fileName = (filePath.split('/').pop() as string).split('.')[0]

  await writeFile(join(sourcePath, `${fileName}.json`), `${JSON.stringify(contents)}\n`)
}
