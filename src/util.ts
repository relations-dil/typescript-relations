/**
 * Small internal helpers. Nothing here is part of the public contract.
 */

import { isDict } from './overscore.js'

/** Structural deep clone of plain data (objects, arrays, Sets, Dates, primitives). */
export function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(clone) as unknown as T
  }
  if (value instanceof Set) {
    return new Set([...value].map(clone)) as unknown as T
  }
  if (value instanceof Map) {
    return new Map([...value].map(([key, item]) => [clone(key), clone(item)])) as unknown as T
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T
  }
  if (isDict(value)) {
    const copy: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      copy[key] = clone((value as Record<string, unknown>)[key])
    }
    return copy as unknown as T
  }
  return value
}

/** Structural equality for exported values. Key order is ignored, array order is not. */
export function equal(first: unknown, second: unknown): boolean {
  if (first === second) {
    return true
  }
  if (first === null || second === null || first === undefined || second === undefined) {
    return first == null && second == null
  }
  if (typeof first !== 'object' || typeof second !== 'object') {
    return false
  }
  if (Array.isArray(first) || Array.isArray(second)) {
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
      return false
    }
    return first.every((item, index) => equal(item, second[index]))
  }
  if (first instanceof Set || second instanceof Set) {
    if (!(first instanceof Set) || !(second instanceof Set) || first.size !== second.size) {
      return false
    }
    return [...first].every((item) => second.has(item))
  }
  const firstKeys = Object.keys(first as object)
  const secondKeys = Object.keys(second as object)
  if (firstKeys.length !== secondKeys.length) {
    return false
  }
  return firstKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(second, key) &&
      equal((first as Record<string, unknown>)[key], (second as Record<string, unknown>)[key])
  )
}

/** Stable JSON, used for unique index keys. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Set) {
      return sorted([...item])
    }
    if (isDict(item)) {
      const ordered: Record<string, unknown> = {}
      for (const key of Object.keys(item).sort()) {
        ordered[key] = (item as Record<string, unknown>)[key]
      }
      return ordered
    }
    return item
  })
}

/** Natural ascending sort: numbers numerically, everything else by string. */
export function sorted<T>(values: Iterable<T>): T[] {
  return [...values].sort(compare)
}

/** Three-way comparison used for sorting and ordering. */
export function compare(first: any, second: any): number {
  if (first === second) {
    return 0
  }
  if (first === null || first === undefined) {
    return -1
  }
  if (second === null || second === undefined) {
    return 1
  }
  if (typeof first === 'number' && typeof second === 'number') {
    return first - second
  }
  if (typeof first === 'boolean' && typeof second === 'boolean') {
    return Number(first) - Number(second)
  }
  const firstText = String(first)
  const secondText = String(second)
  return firstText < secondText ? -1 : firstText > secondText ? 1 : 0
}

/** Turn CamelCase into under_scored. */
export function underscore(name: string): string {
  const parts: string[] = []
  let previous = true

  for (const letter of name) {
    const lowered = letter.toLowerCase()
    if (!previous && lowered !== letter) {
      parts.push('_')
    }
    parts.push(lowered)
    previous = lowered !== letter
  }

  return parts.join('')
}
