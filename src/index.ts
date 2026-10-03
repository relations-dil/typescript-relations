/**
 * relations - a simple, flexible DIL (data interface layer).
 *
 * Define a model once, independent of any backend. Point it at a source at runtime. The
 * same model description drives a database in one service and a REST API in the next.
 *
 * ```ts
 * import { Model, OneToMany, int, str } from '@relations-dil/relations'
 * import { MockSource } from '@relations-dil/relations/mock'
 *
 * class Base extends Model {
 *   static source = 'example'
 * }
 *
 * class Unit extends Base {
 *   static fields = { id: int, name: str }
 * }
 *
 * class Test extends Base {
 *   static fields = { id: int, unit_id: int, name: str }
 * }
 *
 * new OneToMany(Unit, Test)
 * new MockSource('example')
 *
 * await new Unit('yep').create()
 *
 * const unit = await Unit.one({ name: 'yep' }).retrieve()
 * unit.id  // 1
 * ```
 */

import * as overscore from './overscore.js'

export { overscore }

export { FieldError, MigrationsError, ModelError, RecordError, UniqueError } from './errors.js'
export { OverscoreError } from './overscore.js'

export {
  bool,
  builtin,
  container,
  dict,
  float,
  int,
  kindName,
  kindOf,
  list,
  scalar,
  set,
  str,
  CONTAINERS,
  KINDS,
  SCALARS,
  type FieldKind,
  type Kind,
  type KindClass
} from './kinds.js'

export {
  Field,
  OPERATORS,
  RESERVED,
  type Attr,
  type FieldOptions,
  type Init,
  type Validation
} from './field.js'

export { Record, type Action } from './record.js'

export {
  Model,
  ModelIdentity,
  construct,
  toField,
  type FieldSpec,
  type ModelAction,
  type ModelClass,
  type ModelMode,
  type ModelRole
} from './model.js'

export {
  ManyToMany,
  OneTo,
  OneToMany,
  OneToOne,
  Relation,
  type ManyToManyOptions,
  type OneToOptions
} from './relation.js'

export { Source, lookup, type Query } from './source.js'

export { Titles } from './titles.js'

export { Migrations, pretty, type Renamer } from './migrations.js'

export { MockQuery, MockSource } from './mock.js'

export { LocalSource, type StorageLike } from './local.js'

export { RestSource, type FetchInit, type FetchLike, type FetchResponse } from './rest.js'

export {
  fields,
  type Listed,
  type Typed,
  type TypedClass,
  type ValueOfKind,
  type ValueOfSpec,
  type Values
} from './typed.js'

export {
  definitionsOf,
  modelFrom,
  modelsFrom,
  type Built,
  type Definition,
  type RelationDefinition
} from './dynamic.js'

export { SOURCES, clear, register, source, unregister, type Registered } from './registry.js'

import type { ModelClass } from './model.js'
import { Model as ModelBase } from './model.js'

/**
 * Every model class exported by a module, for handing to migrations.
 *
 * ```ts
 * import * as schema from './models.js'
 *
 * await new Migrations('ddl').generate(models(schema))
 * ```
 */
export function models(module: globalThis.Record<string, any>, fromBase: any = ModelBase): ModelClass[] {
  const found: ModelClass[] = []

  for (const value of Object.values(module)) {
    if (typeof value !== 'function' || value === fromBase) {
      continue
    }

    let prototype = Object.getPrototypeOf(value)

    while (prototype) {
      if (prototype === fromBase) {
        found.push(value as ModelClass)
        break
      }
      prototype = Object.getPrototypeOf(prototype)
    }
  }

  return found
}
