/**
 * A source that keeps everything in the browser's localStorage.
 *
 * Same behaviour as every other source - unique indexes, auto ids, relations, titles - but the
 * data survives a page reload, with no server and nothing to install. Reach for it for apps that
 * are a single file you open from disk, or any page that just needs to remember things.
 *
 * ```ts
 * import { LocalSource } from '@relations-dil/relations/local'
 *
 * new LocalSource('example', { key: 'my-app' })
 * ```
 *
 * It loads once, when it's made, and saves after every write that succeeds. Two tabs open on the
 * same key don't see each other's changes: whichever saves last wins.
 */

import { MockSource } from './mock.js'
import type { Model } from './model.js'

/** The slice of the Web Storage API that's used, so tests (and other stores) can stand in. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

type Stored = globalThis.Record<string, any>

/** A source whose data lives in localStorage. */
export class LocalSource extends MockSource {
  /** The localStorage key everything is kept under. */
  declare key: string
  /** Where it's kept. Defaults to the page's localStorage. */
  declare storage: StorageLike

  constructor(name: string, options: globalThis.Record<string, any> = {}) {
    super(name, options)

    const storage: StorageLike | undefined = options.storage ?? (globalThis as any).localStorage

    if (storage === undefined) {
      throw new Error(`${name}: no localStorage here - pass options.storage`)
    }

    this.key = options.key ?? `relations:${name}`
    this.storage = storage

    this.restore()
  }

  /** Read what was saved last time, if anything. */
  restore(): void {
    const saved = this.storage.getItem(this.key)

    if (saved === null) {
      return
    }

    let parsed: Stored

    try {
      parsed = JSON.parse(saved)
    } catch {
      // Carrying on would overwrite whatever's there at the next save.
      throw new Error(`${this.name}: ${this.key} in storage isn't valid JSON`)
    }

    this.ids = parsed.ids
    this.data = Object.fromEntries(Object.entries<any[]>(parsed.data).map(([name, rows]) => [name, new Map(rows)]))
    this.unique = Object.fromEntries(
      Object.entries<Stored>(parsed.unique).map(([name, indexes]) => [
        name,
        Object.fromEntries(Object.entries<any[]>(indexes).map(([index, rows]) => [index, new Map(rows)]))
      ])
    )
  }

  /** Write everything out. Maps become lists of [id, value] pairs. */
  save(): void {
    this.storage.setItem(
      this.key,
      JSON.stringify({
        ids: this.ids,
        data: Object.fromEntries(Object.entries(this.data).map(([name, records]) => [name, [...records]])),
        unique: Object.fromEntries(
          Object.entries(this.unique).map(([name, indexes]) => [
            name,
            Object.fromEntries(Object.entries(indexes).map(([index, values]) => [index, [...values]]))
          ])
        )
      })
    )
  }

  /** Forget everything, here and in storage. The models stay registered. */
  reset(): void {
    this.storage.removeItem(this.key)

    this.ids = Object.fromEntries(Object.keys(this.ids).map((name) => [name, 0]))
    this.data = Object.fromEntries(Object.keys(this.data).map((name) => [name, new Map()]))
    this.unique = Object.fromEntries(
      Object.entries(this.unique).map(([name, indexes]) => [
        name,
        Object.fromEntries(Object.keys(indexes).map((index) => [index, new Map()]))
      ])
    )
  }

  async create(model: Model): Promise<Model> {
    const created = await super.create(model)

    this.save()

    return created
  }

  async update(model: Model): Promise<number> {
    const updated = await super.update(model)

    this.save()

    return updated
  }

  async delete(model: Model): Promise<number> {
    const deleted = await super.delete(model)

    this.save()

    return deleted
  }
}

LocalSource.KIND = 'local'
