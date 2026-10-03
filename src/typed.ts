/**
 * Typed models.
 *
 * Field values are reached through a Proxy at runtime, which TypeScript can't see into
 * on its own. `fields()` closes that gap: it declares the fields once and hands back a
 * base class that already knows their types.
 *
 * ```ts
 * import { fields, int, str, list } from '@relations-dil/relations'
 *
 * class Unit extends fields({ id: int, name: str, tags: list }) {
 *   static source = 'example'
 * }
 *
 * const unit = await Unit.one({ name: 'yep' }).retrieve()
 *
 * unit.name.toUpperCase()   // string, checked
 * unit.nmae                 // error: no such field
 * unit.name = 5             // error: not a string
 * ```
 *
 * Relations are declared separately from the model, so add them with `declare` when you
 * want them typed too. `declare` is erased at compile time and costs nothing to run:
 *
 * ```ts
 * class Unit extends fields({ id: int, name: str }) {
 *   static source = 'example'
 *   declare test: Test
 * }
 * ```
 */

import { Field } from './field.js'
import { Model, type FieldSpec, type ModelClass, type ModelIdentity } from './model.js'
import type { bool, dict, float, int, list, set, str } from './kinds.js'

/** The value type behind a kind sentinel. */
export type ValueOfKind<K> = K extends typeof bool
  ? boolean
  : K extends typeof int
    ? number
    : K extends typeof float
      ? number
      : K extends typeof str
        ? string
        : K extends typeof set
          ? Set<any>
          : K extends typeof list
            ? any[]
            : K extends typeof dict
              ? globalThis.Record<string, any>
              : K extends abstract new (...args: any[]) => infer T
                ? T
                : any

/** The value type behind a field declaration. */
export type ValueOfSpec<S> = S extends Field
  ? any
  : S extends readonly (infer T)[]
    ? T
    : S extends Set<infer T>
      ? Set<T>
      : S extends (...args: any[]) => infer T
        ? T
        : S extends { kind: infer K }
          ? ValueOfKind<K>
          : ValueOfKind<S>

/** Every field of a declaration, as the values they hold. */
export type Values<F> = { [Name in keyof F]: ValueOfSpec<F[Name]> }

/** A model instance with its fields typed. */
export type Typed<F> = Model & Values<F>

/**
 * A model in many mode: every field reads back as an array of its values, and indexing
 * gives you one model.
 */
export type Listed<I> = Model & { [Name in keyof Omit<I, keyof Model>]: I[Name][] } & {
  [index: number]: I
}

/** The class of a model with its fields typed. */
export interface TypedClass<F> {
  [member: string]: any

  new (...args: any[]): Typed<F>

  /** The field declaration this class was built from. */
  fields: F

  /** Name of the source this model lives in. */
  source?: string
  /** Name of the model in the source. Defaults to the underscored class name. */
  store?: string
  /** Human-facing title. Defaults to the class name. */
  title?: string
  /** Which field is the id, by name or position. `null` for no id. */
  id?: string | number | null
  /** Which fields make up a title. */
  titles?: string | string[]
  /** Which fields to show in a listing. */
  list?: string | string[]
  /** Unique indexes. */
  unique?: string | string[] | globalThis.Record<string, string[]> | false
  /** Regular indexes. */
  index?: string | string[] | globalThis.Record<string, string[]>
  /** Default sort order. */
  order?: string | string[]
  /** Default chunk size. */
  chunk?: number

  /** Everything knowable about this model without an instance. */
  thy(target?: ModelIdentity): ModelIdentity

  /** The definition of this model, as the source wants it. */
  define(...args: any[]): any

  /** A model that will retrieve exactly one record. */
  one<T extends abstract new (...args: any[]) => any>(this: T, ...args: any[]): InstanceType<T>

  /** A model that will retrieve any number of records. */
  many<T extends abstract new (...args: any[]) => any>(this: T, ...args: any[]): Listed<InstanceType<T>>

  /** A model set up to insert many records without reading their ids back. */
  bulk<T extends abstract new (...args: any[]) => any>(this: T, size?: number): Listed<InstanceType<T>>
}

/**
 * A base class with these fields, typed. Extend it instead of `Model` and every field
 * is checked at the point you touch it. Pass a base to share configuration, the way a
 * `Base` class shares a source across models.
 */
export function fields<F extends globalThis.Record<string, FieldSpec>>(
  spec: F,
  base: ModelClass | TypedClass<any> = Model as unknown as ModelClass
): TypedClass<F> {
  class Fielded extends (base as any) {
    static fields = spec
  }

  return Fielded as unknown as TypedClass<F>
}
