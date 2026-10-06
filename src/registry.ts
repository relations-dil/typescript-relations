/**
 * The global source registry.
 *
 * A model names its source with a string. Which actual source that string refers to is
 * decided at runtime, by whatever registers itself under that name. That indirection is
 * the whole point of relations: the same model runs against a database in one service
 * and against a REST API in another.
 */

import { SourceError } from './errors.js'

/**
 * A dns label, which is what a source's name has to be so it's safe to use in other names:
 * letters, digits and hyphens, 1 to 63 characters, no leading or trailing hyphen.
 */
export const DNS = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i

/** Anything registered as a source. Kept loose to avoid a circular import. */
export interface Registered {
  name: string
  [member: string]: any
}

/** Every registered source, keyed by name. */
export const SOURCES: Map<string, Registered> = new Map()

/** Register a source under its name, replacing any source already there. The name has to be a dns label. */
export function register(source: Registered): void {
  if (typeof source.name !== 'string' || !DNS.test(source.name)) {
    throw new SourceError(`source ${source.name} is not dns compliant`)
  }

  SOURCES.set(source.name, source)
}

/** The source registered under a name, or `undefined`. */
export function source(name: string | null | undefined): Registered | undefined {
  return name === null || name === undefined ? undefined : SOURCES.get(name)
}

/** Forget a source. Mostly useful between tests. */
export function unregister(name: string): boolean {
  return SOURCES.delete(name)
}

/** Forget every source. Mostly useful between tests. */
export function clear(): void {
  SOURCES.clear()
}
