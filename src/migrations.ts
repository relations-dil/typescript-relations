/**
 * Migrations: diffing model definitions over time, and handing the diffs to a source.
 *
 * Definitions are backend-neutral JSON. A source converts them into whatever it needs -
 * DDL for a database, nothing at all for an API - so the same migration history drives
 * every backend a set of models is used with.
 */


import { MigrationsError } from './errors.js'
import { source as registered } from './registry.js'
import { equal, joinPath } from './util.js'
import { MigrationsRef, type ModelClass } from './model.js'

/**
 * Decides which removals are actually renames. Called with the kind of thing being
 * renamed and the names added and removed; returns removed-name to added-name pairs.
 *
 * Python's relations prompts on stdin here. This takes a function instead, so the same
 * code works in a script, a test, or a CLI you write yourself.
 */
export type Renamer = (
  name: string,
  adds: string[],
  removes: string[]
) => globalThis.Record<string, string>

const noRenames: Renamer = () => ({})

/** Diffs model definitions and drives a source through the resulting changes. */
export class Migrations {
  /** Directory the definition and migration files live in. */
  directory: string
  /** How renames are decided. Defaults to treating nothing as a rename. */
  renamer: Renamer

  constructor(directory = 'ddl', options: { renamer?: Renamer } = {}) {
    this.directory = directory
    this.renamer = options.renamer ?? noRenames
  }

  /** The definition as of the last generate, or an empty one. */
  async current(): Promise<globalThis.Record<string, any>> {
    const { readFile } = await import('node:fs/promises')

    try {
      return JSON.parse(await readFile(joinPath(this.directory, 'definition.json'), 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {}
      }
      throw error
    }
  }

  /** Definitions for a set of model classes, keyed by model name. */
  static define(models: ModelClass[]): globalThis.Record<string, any> {
    const definitions: globalThis.Record<string, any> = {}

    for (const model of models) {
      const definition = model.thy().define()
      definitions[definition.name] = definition
    }

    return definitions
  }

  /** Work out which removals are renames, and take those out of adds and removes. */
  static rename(
    renamer: Renamer,
    name: string,
    adds: string[],
    removes: string[]
  ): globalThis.Record<string, string> {
    if (!adds.length || !removes.length) {
      return {}
    }

    const renames = renamer(name, [...adds], [...removes])

    for (const [remove, add] of Object.entries(renames)) {
      const removeAt = removes.indexOf(remove)
      const addAt = adds.indexOf(add)

      if (removeAt === -1 || addAt === -1) {
        throw new MigrationsError(`${name} rename ${remove} to ${add} is not in the changes`)
      }

      removes.splice(removeAt, 1)
      adds.splice(addAt, 1)
    }

    return renames
  }

  /** A field definition by name. */
  static lookup(
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

  /** What changed between two field definitions. */
  static field(
    current: globalThis.Record<string, any>,
    define: globalThis.Record<string, any>
  ): globalThis.Record<string, any> {
    const migration: globalThis.Record<string, any> = {}

    for (const attr of new Set([...Object.keys(current), ...Object.keys(define)])) {
      if (!equal(current[attr], define[attr])) {
        migration[attr] = define[attr] ?? null
      }
    }

    return migration
  }

  /** What changed between two sets of field definitions. */
  static fields(
    renamer: Renamer,
    model: string,
    current: globalThis.Record<string, any>[],
    define: globalThis.Record<string, any>[]
  ): globalThis.Record<string, any> {
    const migration: globalThis.Record<string, any> = {}

    const currentNames = current.map((field) => field.name)
    const defineNames = define.map((field) => field.name)

    const add = defineNames.filter((name) => !currentNames.includes(name))
    const remove = currentNames.filter((name) => !defineNames.includes(name))

    const renames = Migrations.rename(renamer, `${model} fields`, add, remove)

    if (add.length) {
      migration.add = define.filter((field) => add.includes(field.name))
    }

    if (remove.length) {
      migration.remove = remove
    }

    const change: globalThis.Record<string, any> = {}

    for (const currentField of current) {
      const defineField = Migrations.lookup(renames[currentField.name] ?? currentField.name, define)
      if (defineField !== null && !equal(currentField, defineField)) {
        change[currentField.name] = Migrations.field(currentField, defineField)
      }
    }

    if (Object.keys(change).length) {
      migration.change = change
    }

    return migration
  }

  /** What changed between two sets of indexes. */
  static indexes(
    renamer: Renamer,
    model: string,
    kind: string,
    current: globalThis.Record<string, string[]>,
    define: globalThis.Record<string, string[]>
  ): globalThis.Record<string, any> {
    const migration: globalThis.Record<string, any> = {}

    const add = Object.keys(define)
      .sort()
      .filter((name) => !(name in current))
    const remove = Object.keys(current)
      .sort()
      .filter((name) => !(name in define))

    const renames = Migrations.rename(renamer, `${model} ${kind}`, add, remove)

    if (add.length) {
      migration.add = Object.fromEntries(add.map((name) => [name, define[name]]))
    }

    if (remove.length) {
      migration.remove = remove
    }

    if (Object.keys(renames).length) {
      for (const [currentName, defineName] of Object.entries(renames)) {
        if (!equal(current[currentName], define[defineName])) {
          throw new MigrationsError(
            `${model} ${kind} ${currentName} and ${defineName} must have same fields to rename`
          )
        }
      }

      migration.rename = renames
    }

    return migration
  }

  /** What changed between two model definitions. */
  static model(
    current: globalThis.Record<string, any>,
    define: globalThis.Record<string, any>,
    renamer: Renamer = noRenames
  ): globalThis.Record<string, any> {
    const model = current.name !== define.name ? `${current.name}/${define.name}` : current.name

    const migration: globalThis.Record<string, any> = {}

    const attrs = new Set(['name', 'title', 'id', ...Object.keys(current), ...Object.keys(define)])

    for (const attr of attrs) {
      if (['fields', 'index', 'unique'].includes(attr)) {
        continue
      }
      if (!equal(current[attr], define[attr])) {
        migration[attr] = define[attr] ?? null
      }
    }

    if (!equal(current.fields, define.fields)) {
      migration.fields = Migrations.fields(renamer, model, current.fields, define.fields)
    }

    for (const attr of ['unique', 'index']) {
      const kind = attr === 'unique' ? 'unique indexes' : 'indexes'
      if (!equal(current[attr], define[attr])) {
        migration[attr] = Migrations.indexes(renamer, model, kind, current[attr] ?? {}, define[attr] ?? {})
      }
    }

    return migration
  }

  /** What changed across a whole set of models. */
  static models(
    current: globalThis.Record<string, any>,
    define: globalThis.Record<string, any>,
    renamer: Renamer = noRenames
  ): globalThis.Record<string, any> {
    const migration: globalThis.Record<string, any> = {}

    const add = Object.keys(define)
      .sort()
      .filter((name) => !(name in current))
    const remove = Object.keys(current)
      .sort()
      .filter((name) => !(name in define))

    const renames = Migrations.rename(renamer, 'models', add, remove)

    if (add.length) {
      migration.add = Object.fromEntries(add.map((name) => [name, define[name]]))
    }

    if (remove.length) {
      migration.remove = Object.fromEntries(remove.map((name) => [name, current[name]]))
    }

    const change: globalThis.Record<string, any> = {}

    for (const name of Object.keys(current)) {
      const defineModel = define[renames[name] ?? name]
      if (defineModel !== undefined && !equal(current[name], defineModel)) {
        change[name] = {
          definition: current[name],
          migration: Migrations.model(current[name], defineModel, renamer)
        }
      }
    }

    if (Object.keys(change).length) {
      migration.change = change
    }

    return migration
  }

  /**
   * Snapshot the current models, writing a migration alongside the previous snapshot.
   * Resolves to whether anything was written.
   */
  async generate(models: ModelClass[], stamp?: string): Promise<boolean> {
    const { mkdir, rename: renameFile, writeFile } = await import('node:fs/promises')

    await mkdir(this.directory, { recursive: true })

    const current = await this.current()
    const define = Migrations.define(models)

    if (Object.keys(current).length) {
      if (equal(current, define)) {
        return false
      }

      const migration = Migrations.models(current, define, this.renamer)
      const at = stamp ?? stamped()

      await renameFile(
        joinPath(this.directory, 'definition.json'),
        joinPath(this.directory, `definition-${at}.json`)
      )

      await writeFile(joinPath(this.directory, `migration-${at}.json`), pretty(migration))
    }

    await writeFile(joinPath(this.directory, 'definition.json'), pretty(define))

    return true
  }

  /** Where a source's converted files live. */
  sourcePath(name: string): string {
    const source = registered(name)

    if (source === undefined) {
      throw new MigrationsError(`no source registered as '${name}'`)
    }

    return joinPath(this.directory, source.name, String(source.KIND))
  }

  /** Convert every definition and migration into a source's own form. */
  async convert(name: string): Promise<void> {
    const source = registered(name)

    if (source === undefined) {
      throw new MigrationsError(`no source registered as '${name}'`)
    }

    const { mkdir, readdir } = await import('node:fs/promises')
    const path = this.sourcePath(name)

    await mkdir(path, { recursive: true })

    for (const file of (await readdir(this.directory)).sort()) {
      if (!file.endsWith('.json')) {
        continue
      }

      if (file.startsWith('definition')) {
        await source.definition(joinPath(this.directory, file), path)
      } else if (file.startsWith('migration')) {
        await source.migration(joinPath(this.directory, file), path)
      }
    }
  }

  /** The migration pairs available for a source. */
  async list(name: string): Promise<globalThis.Record<string, any>> {
    const source = registered(name)

    if (source === undefined) {
      throw new MigrationsError(`no source registered as '${name}'`)
    }

    return source.list(this.sourcePath(name))
  }

  /** Load one converted file into a source. */
  async load(name: string, fileName: string): Promise<void> {
    const source = registered(name)

    if (source === undefined) {
      throw new MigrationsError(`no source registered as '${name}'`)
    }

    return source.load(joinPath(this.sourcePath(name), fileName))
  }

  /** Bring a source up to date. Resolves to whether anything was applied. */
  async apply(name: string): Promise<boolean> {
    const source = registered(name)

    if (source === undefined) {
      throw new MigrationsError(`no source registered as '${name}'`)
    }

    return source.migrate(this.sourcePath(name))
  }
}

/** Sorted-key JSON, so definitions diff cleanly in version control. */
export function pretty(value: any): string {
  return `${JSON.stringify(value, (_key, item) => ordered(item), 4)}\n`
}

function ordered(value: any): any {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return value
  }
  const sorted: globalThis.Record<string, any> = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key]
  }
  return sorted
}

function stamped(at: Date = new Date()): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')

  return [
    at.getFullYear(),
    pad(at.getMonth() + 1),
    pad(at.getDate()),
    pad(at.getHours()),
    pad(at.getMinutes()),
    pad(at.getSeconds()),
    pad(at.getMilliseconds() * 1000, 6)
  ].join('-')
}

// Let a model identity diff itself without importing this module.
MigrationsRef.model = (current: any, define: any) => Migrations.model(current, define)
