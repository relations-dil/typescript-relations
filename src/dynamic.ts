/**
 * Models from data.
 *
 * `identity.define()` turns a model class into a plain, backend-neutral object. This
 * module goes the other way: it turns that object back into a working model class. The
 * round trip means a set of models can be written as data - JSON, YAML, a database row,
 * a form in a UI - saved, shipped, and loaded somewhere that has never seen the code.
 *
 * ```ts
 * import { modelsFrom } from '@relations-dil/relations'
 * import { parse } from 'yaml'          // any YAML parser; relations has no opinion
 *
 * const app = parse(await readFile('app.yaml', 'utf8'))
 * const { Unit, Test } = modelsFrom(app.models, { relations: app.relations })
 *
 * await new Unit('yep').create()
 * ```
 *
 * The YAML for that looks like:
 *
 * ```yaml
 * models:
 *   unit:
 *     source: example
 *     name: unit
 *     fields:
 *       - {kind: int,  name: id,   store: id,   auto: true}
 *       - {kind: str,  name: name, store: name, none: false}
 *   test:
 *     source: example
 *     name: test
 *     fields:
 *       - {kind: int, name: id,      store: id, auto: true}
 *       - {kind: int, name: unit_id, store: unit_id}
 *       - {kind: str, name: name,    store: name, none: false}
 * relations:
 *   - {kind: OneToMany, parent: unit, child: test}
 * ```
 */

import { ModelError } from './errors.js'
import { kindOf, str } from './kinds.js'
import { Model, type FieldSpec, type ModelClass } from './model.js'
import { ManyToMany, OneToMany, OneToOne, type ManyToManyOptions, type OneToOptions } from './relation.js'

/** A model definition, as `identity.define()` emits it. */
export interface Definition {
  /** Name of the source the model lives in. */
  source?: string
  /** Name of the model in the source. */
  name: string
  /** Human-facing title. */
  title?: string
  /** Whether this model is a many-to-many tie table. */
  tie?: boolean
  /** Field definitions, in order. */
  fields: globalThis.Record<string, any>[]
  /** Which field is the id. */
  id?: string | null
  /** Which fields make up a title. Optional; derived when absent. */
  titles?: string | string[]
  /** Which fields to show in a listing. Optional; derived when absent. */
  list?: string | string[]
  /** Unique indexes. */
  unique?: globalThis.Record<string, string[]>
  /** Regular indexes. */
  index?: globalThis.Record<string, string[]>
  /** Default sort order. */
  order?: string | string[]
  /** Default chunk size. */
  chunk?: number
}

/** A relation between two definitions, by model name. */
export interface RelationDefinition {
  /** Which kind of relation. */
  kind: 'OneToMany' | 'OneToOne' | 'ManyToMany'
  /** The one side, for a one-to-* relation. */
  parent?: string
  /** The many side, for a one-to-* relation. */
  child?: string
  /** The first side of a many-to-many. */
  sister?: string
  /** The second side of a many-to-many. */
  brother?: string
  /** The joining model of a many-to-many. */
  tie?: string
  /** Anything the relation lets you spell out instead of inferring. */
  options?: OneToOptions & ManyToManyOptions
}

/** What `modelsFrom` gives you back. */
export type Built = globalThis.Record<string, ModelClass>

function fieldFrom(definition: globalThis.Record<string, any>): [string, FieldSpec] {
  const { kind: kindName, name, ...options } = definition

  const kind = kindOf(kindName)

  if (kind === undefined) {
    throw new ModelError(null, `unknown kind '${kindName}' for field '${name}' - expected one of bool, int, float, str, set, list, dict`)
  }

  if (options.extract) {
    options.extract = Object.fromEntries(
      Object.entries(options.extract as globalThis.Record<string, string>).map(([path, each]) => [
        path,
        kindOf(each) ?? str
      ])
    )
  }

  return [name, { kind, ...options } as FieldSpec]
}

/**
 * A model class built from a definition. Extend the result, or use it as it is.
 *
 * ```ts
 * const Unit = modelFrom({
 *   source: 'example',
 *   name: 'unit',
 *   fields: [
 *     { kind: 'int', name: 'id', store: 'id', auto: true },
 *     { kind: 'str', name: 'name', store: 'name', none: false }
 *   ],
 *   id: 'id',
 *   unique: { name: ['name'] }
 * })
 * ```
 */
export function modelFrom(definition: Definition, base: ModelClass = Model as unknown as ModelClass): ModelClass {
  const spec: globalThis.Record<string, FieldSpec> = {}

  for (const field of definition.fields ?? []) {
    const [name, made] = fieldFrom(field)
    spec[name] = made
  }

  class Defined extends (base as any) {
    static fields = spec
  }

  const cls = Defined as unknown as ModelClass

  cls.store = definition.name
  cls.source = definition.source ?? base.source
  cls.id = definition.id ?? null

  if (definition.title !== undefined) {
    cls.title = definition.title
  }
  if (definition.titles !== undefined) {
    cls.titles = definition.titles
  }
  if (definition.list !== undefined) {
    cls.list = definition.list
  }
  if (definition.unique !== undefined) {
    cls.unique = definition.unique
  }
  if (definition.index !== undefined) {
    cls.index = definition.index
  }
  if (definition.order !== undefined) {
    cls.order = definition.order
  }
  if (definition.chunk !== undefined) {
    cls.chunk = definition.chunk
  }
  if (definition.tie !== undefined) {
    cls.TIE = definition.tie
  }

  Object.defineProperty(cls, 'name', { value: definition.title ?? definition.name, configurable: true })

  return cls
}

/**
 * Every model in a set of definitions, wired up. Pass `relations` to connect them; the
 * names in each relation refer to the keys of `definitions`, or to a definition's `name`.
 *
 * ```ts
 * const { unit, test } = modelsFrom(
 *   { unit: unitDefinition, test: testDefinition },
 *   { relations: [{ kind: 'OneToMany', parent: 'unit', child: 'test' }] }
 * )
 * ```
 */
export function modelsFrom(
  definitions: globalThis.Record<string, Definition> | Definition[],
  options: { relations?: RelationDefinition[]; base?: ModelClass } = {}
): Built {
  const entries = Array.isArray(definitions)
    ? definitions.map((definition) => [definition.name, definition] as const)
    : Object.entries(definitions).map(([key, definition]) => [definition.name ?? key, definition] as const)

  const built: Built = {}

  for (const [name, definition] of entries) {
    built[name] = modelFrom({ ...definition, name: definition.name ?? name }, options.base)
  }

  const need = (name: string | undefined, relation: RelationDefinition): ModelClass => {
    if (name === undefined || built[name] === undefined) {
      throw new ModelError(null, `relation ${relation.kind} refers to unknown model '${name}'`)
    }
    return built[name]
  }

  for (const relation of options.relations ?? []) {
    if (relation.kind === 'OneToMany') {
      new OneToMany(need(relation.parent, relation), need(relation.child, relation), relation.options)
    } else if (relation.kind === 'OneToOne') {
      new OneToOne(need(relation.parent, relation), need(relation.child, relation), relation.options)
    } else if (relation.kind === 'ManyToMany') {
      new ManyToMany(
        need(relation.sister, relation),
        need(relation.brother, relation),
        need(relation.tie, relation),
        relation.options
      )
    } else {
      throw new ModelError(null, `unknown relation kind '${(relation as any).kind}'`)
    }
  }

  return built
}

/** The definitions for a set of model classes, keyed by model name - the way back out. */
export function definitionsOf(models: ModelClass[]): globalThis.Record<string, Definition> {
  const definitions: globalThis.Record<string, Definition> = {}

  for (const model of models) {
    const definition = model.thy().define() as Definition
    definitions[definition.name] = definition
  }

  return definitions
}
