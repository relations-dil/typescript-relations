/**
 * The global source registry.
 *
 * A model names its source with a string. Which actual source that string refers to is
 * decided at runtime, by whatever registers itself under that name. That indirection is
 * the whole point of relations: the same model runs against a database in one service
 * and against a REST API in another.
 */

/** Anything registered as a source. Kept loose to avoid a circular import. */
export interface Registered {
  name: string
  [member: string]: any
}

/** Every registered source, keyed by name. */
export const SOURCES: Map<string, Registered> = new Map()

/** Register a source under its name, replacing any source already there. */
export function register(source: Registered): void {
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
