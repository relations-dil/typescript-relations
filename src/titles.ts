/**
 * Titles: the human-readable label for a record, assembled from its title fields and,
 * where a title field points at a parent, from that parent's titles too.
 */

import * as overscore from './overscore.js'
import type { Model } from './model.js'

/** Titles for a set of records, keyed by id, with the ids kept in retrieval order. */
export class Titles {
  /** Name of the id field the titles are keyed by. */
  id: string
  /** Fields that make up a title. */
  fields: string[]

  /** Ids, in order. */
  ids: any[] = []
  /** Title values, keyed by id. */
  titles: Map<any, any[]> = new Map()
  /** Format instructions, one per title value. */
  format: any[] = []
  /** Parent titles, for title fields that point at another model. */
  parents: globalThis.Record<string, Titles> = {}

  private constructor(model: Model) {
    this.id = model._id as string
    this.fields = model._titles
  }

  /**
   * Build titles for a model. Async because a title field pointing at a parent has to
   * fetch that parent's titles first.
   */
  static async build(model: Model): Promise<Titles> {
    const titles = new Titles(model)

    for (const field of titles.fields) {
      const relation = model._ancestor(field)

      if (relation !== null) {
        const parent: Titles = await (relation.Parent as any)
          .many({ [`${relation.parentId}__in`]: (model as any)[field] })
          .titles()
        titles.parents[field] = parent
        titles.format.push(...parent.format)
      } else {
        const own = model._fields.field(field)
        if (own && own.format !== null) {
          titles.format.push(...own.format)
        } else {
          titles.format.push(null)
        }
      }
    }

    return titles
  }

  /** How many titles there are. */
  get size(): number {
    return this.ids.length
  }

  /** Whether there's a title for an id. */
  has(id: any): boolean {
    return this.ids.includes(id)
  }

  /** The title values for an id. */
  get(id: any): any[] | undefined {
    return this.titles.get(id)
  }

  /** Set the title values for an id. */
  set(id: any, value: any[]): void {
    if (!this.ids.includes(id)) {
      this.ids.push(id)
    }

    this.titles.set(id, value)
  }

  /** Forget an id. */
  delete(id: any): void {
    const at = this.ids.indexOf(id)

    if (at !== -1) {
      this.ids.splice(at, 1)
    }

    this.titles.delete(id)
  }

  /** Ids, in order. */
  *[Symbol.iterator](): IterableIterator<any> {
    yield* this.ids
  }

  /** Add a record's title. */
  add(model: Model): void {
    const title: any[] = []

    for (const name of this.fields) {
      if (name in this.parents) {
        const parent = this.parents[name]
        const key = (model as any)[name]

        if (parent.has(key)) {
          title.push(...(parent.get(key) as any[]))
        } else {
          title.push(...parent.format.map(() => null))
        }
      } else {
        const path = overscore.parse(name)
        const field = String(path.shift())
        title.push(...((model._record?.field(field)?.title(path) as any[]) ?? []))
      }
    }

    this.set((model as any)[this.id], title)
  }

  /** Plain object form, for serialising. */
  toJSON(): globalThis.Record<string, any> {
    return {
      id: this.id,
      fields: this.fields,
      ids: this.ids,
      titles: Object.fromEntries(this.titles),
      format: this.format
    }
  }
}
