/**
 * Field kinds.
 *
 * Python has `int`, `str`, `dict` and friends as first class values you can hand to a
 * field. JavaScript doesn't, so relations exports the same seven names as sentinels:
 *
 * ```ts
 * import { Model, int, str, list } from '@relations-dil/relations'
 *
 * class Unit extends Model {
 *   static source = 'example'
 *   static fields = { id: int, name: str, tags: list }
 * }
 * ```
 *
 * A field can also take a class constructor as its kind, in which case the field needs
 * `attr` to say how to flatten instances into storable values.
 */

import { sorted } from './util.js'
import { isDict } from './overscore.js'

/** One of the seven built-in kinds. */
export interface Kind {
  /** Name used in definitions and migrations. */
  readonly name: 'bool' | 'int' | 'float' | 'str' | 'set' | 'list' | 'dict'
  /** Whether a value is already of this kind. */
  check(value: unknown): boolean
  /** Coerce a value to this kind, throwing when it can't be done. */
  cast(value: unknown): any
  /** A fresh empty value, for the container kinds. */
  empty(): any
}

/** A class usable as a field kind. Such a field must also declare `attr`. */
export type KindClass = abstract new (...args: any[]) => any

/** Anything acceptable as a field's kind. */
export type FieldKind = Kind | KindClass

class CastError extends Error {}

function fail(value: unknown, kind: string): never {
  throw new CastError(`cannot cast ${JSON.stringify(value) ?? String(value)} to ${kind}`)
}

/** Boolean. Casts the strings `false`, `no` and `0` to `false`, everything else by truthiness. */
export const bool = Object.freeze({
  name: 'bool' as const,
  check: (value: unknown) => typeof value === 'boolean',
  cast(value: unknown) {
    if (typeof value === 'string') {
      const lowered = value.toLowerCase()
      if (['false', 'no', '0', ''].includes(lowered)) {
        return false
      }
      return true
    }
    return Boolean(value)
  },
  empty: () => false
}) satisfies Kind

/** Whole number. Truncates toward zero, the way Python's `int()` does. */
export const int = Object.freeze({
  name: 'int' as const,
  check: (value: unknown) => typeof value === 'number' && Number.isInteger(value),
  cast(value: unknown) {
    if (typeof value === 'boolean') {
      return Number(value)
    }
    const number = Number(value)
    if (typeof value === 'object' || value === '' || !Number.isFinite(number)) {
      fail(value, 'int')
    }
    return Math.trunc(number)
  },
  empty: () => 0
}) satisfies Kind

/** Number, whole or not. */
export const float = Object.freeze({
  name: 'float' as const,
  check: (value: unknown) => typeof value === 'number' && Number.isFinite(value),
  cast(value: unknown) {
    if (typeof value === 'boolean') {
      return Number(value)
    }
    const number = Number(value)
    if (typeof value === 'object' || value === '' || !Number.isFinite(number)) {
      fail(value, 'float')
    }
    return number
  },
  empty: () => 0
}) satisfies Kind

/** String. */
export const str = Object.freeze({
  name: 'str' as const,
  check: (value: unknown) => typeof value === 'string',
  cast(value: unknown) {
    if (value === null || value === undefined) {
      fail(value, 'str')
    }
    if (typeof value === 'object') {
      return JSON.stringify(value)
    }
    return String(value)
  },
  empty: () => ''
}) satisfies Kind

/** A `Set`. Exports as a sorted array (or in `options` order when options are set). */
export const set = Object.freeze({
  name: 'set' as const,
  check: (value: unknown) => value instanceof Set,
  cast(value: unknown) {
    if (value instanceof Set) {
      return value
    }
    if (Array.isArray(value)) {
      return new Set(value)
    }
    if (typeof value === 'string') {
      return new Set([value])
    }
    if (value && typeof (value as any)[Symbol.iterator] === 'function') {
      return new Set(value as Iterable<unknown>)
    }
    return fail(value, 'set')
  },
  empty: () => new Set()
}) satisfies Kind

/** An array. */
export const list = Object.freeze({
  name: 'list' as const,
  check: (value: unknown) => Array.isArray(value),
  cast(value: unknown) {
    if (Array.isArray(value)) {
      return value
    }
    if (value instanceof Set) {
      return sorted(value)
    }
    if (value && typeof value === 'object' && typeof (value as any)[Symbol.iterator] === 'function') {
      return [...(value as Iterable<unknown>)]
    }
    return fail(value, 'list')
  },
  empty: () => []
}) satisfies Kind

/** A plain object. */
export const dict = Object.freeze({
  name: 'dict' as const,
  check: (value: unknown) => isDict(value),
  cast(value: unknown) {
    if (isDict(value)) {
      return value
    }
    if (value instanceof Map) {
      return Object.fromEntries(value)
    }
    return fail(value, 'dict')
  },
  empty: () => ({})
}) satisfies Kind

/** All built-in kinds, keyed by name. */
export const KINDS: Record<string, Kind> = Object.freeze({ bool, int, float, str, set, list, dict })

/** The kinds that hold a single scalar value, with no interior path to reach into. */
export const SCALARS: Kind[] = [bool, int, float, str]

/** The kinds that hold other values. */
export const CONTAINERS: Kind[] = [set, list, dict]

/** Whether `kind` is one of the seven built-ins rather than a class. */
export function builtin(kind: FieldKind): kind is Kind {
  return typeof kind === 'object' && kind !== null && 'check' in kind && 'cast' in kind
}

/** The name of a kind, whether built-in or a class. */
export function kindName(kind: FieldKind): string {
  return builtin(kind) ? kind.name : kind.name || 'object'
}

/** Whether `kind` is a scalar built-in. */
export function scalar(kind: FieldKind): boolean {
  return builtin(kind) && SCALARS.includes(kind)
}

/** Whether `kind` is a container built-in. */
export function container(kind: FieldKind): boolean {
  return builtin(kind) && CONTAINERS.includes(kind)
}

/** Look a built-in kind up by name, for reading back definitions. */
export function kindOf(name: string): Kind | undefined {
  return KINDS[name]
}
