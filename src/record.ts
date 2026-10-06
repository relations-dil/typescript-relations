/**
 * Records: an ordered set of fields, and the marshalling between them and a source.
 */

import * as overscore from './overscore.js'
import { RecordError } from './errors.js'
import { Field } from './field.js'

/** What a record is currently for. */
export type Action = 'create' | 'retrieve' | 'update' | 'delete'

/** An ordered, name-addressable set of fields. */
export class Record {
  /** Fields in order. */
  _order: Field[] = []
  /** Fields by name. */
  _names: Map<string, Field> = new Map()
  /** What's being done with this record. */
  _action: Action | null = null

  /** Add a field at a specific position. */
  insert(index: number, field: Field): void {
    this._order.splice(index, 0, field)
    this._names.set(field.name as string, field)
  }

  /** Add a field at the end. */
  append(field: Field): void {
    this.insert(this._order.length, field)
  }

  /** Number of fields. */
  get size(): number {
    return this._order.length
  }

  /** Field names, in order. */
  *[Symbol.iterator](): IterableIterator<string> {
    for (const field of this._order) {
      yield field.name as string
    }
  }

  /** Field names, in order. */
  keys(): string[] {
    return this._order.map((field) => field.name as string)
  }

  /** The field itself, by name or position. */
  field(key: string | number): Field | undefined {
    if (typeof key === 'number') {
      return this._order[key < 0 ? this._order.length + key : key]
    }
    return this._names.get(key)
  }

  /** Whether a field exists, by name or position. */
  has(key: string | number): boolean {
    if (typeof key === 'number') {
      return key < this._order.length
    }
    return this._names.has(key)
  }

  /** An independent copy of this record and every field in it. */
  copy(): Record {
    const record = new Record()

    record._action = this._action

    for (const field of this._order) {
      record.append(field.copy())
    }

    return record
  }

  /** A value, by field name, position, or double-underscored path into a field. */
  get(key: string | number): any {
    if (typeof key === 'number') {
      if (key < this._order.length) {
        return this._order[key].value
      }
      throw new RecordError(this, `unknown field '${key}'`)
    }

    const field = this._names.get(key)

    if (field !== undefined) {
      return field.value
    }

    const access = overscore.parse(key)
    const root = this._names.get(String(access[0]))

    if (root !== undefined) {
      return root.access(access.slice(1))
    }

    throw new RecordError(this, `unknown field '${key}'`)
  }

  /** Set a value, by field name, position, or double-underscored path into a field. */
  set(key: string | number, value: any): void {
    if (typeof key === 'number') {
      if (key < this._order.length) {
        this._order[key].value = value
        return
      }
      throw new RecordError(this, `unknown field '${key}'`)
    }

    const field = this._names.get(key)

    if (field !== undefined) {
      field.value = value
      return
    }

    const apply = overscore.parse(key)
    const root = this._names.get(String(apply[0]))

    if (root !== undefined) {
      root.apply(apply.slice(1), value)
      return
    }

    throw new RecordError(this, `unknown field '${key}'`)
  }

  /** Definitions for every field, in order. */
  define(): globalThis.Record<string, any>[] {
    return this._order.map((field) => field.define())
  }

  /** Set a criterion on a field, by name, position, or `name__operator`. */
  filter(criterion: string | number, value: any): void {
    if (typeof criterion === 'number') {
      if (criterion < this._order.length) {
        this._order[criterion].filter(value)
        return
      }
    } else {
      if (criterion.includes('__')) {
        const index = criterion.indexOf('__')
        const name = criterion.slice(0, index)
        const operator = criterion.slice(index + 2)
        const field = this._names.get(name)
        if (field !== undefined) {
          field.filter(value, operator)
          return
        }
      }
      const field = this._names.get(criterion)
      if (field !== undefined) {
        field.filter(value)
        return
      }
    }

    throw new RecordError(this, `unknown criterion '${criterion}'`)
  }

  /** Every field's value, keyed by field name. */
  export(): globalThis.Record<string, any> {
    const values: globalThis.Record<string, any> = {}

    for (const field of this._order) {
      values[field.name as string] = field.export()
    }

    return values
  }

  /** The store name of the field an injected field lives inside. */
  private injected(field: Field): string {
    const root = String(field.inject).split('__')[0]
    return this._names.get(root)?.store as string
  }

  /** Write every field's value for a create. */
  create(values: globalThis.Record<string, any>): globalThis.Record<string, any> {
    const inject: Field[] = []

    for (const field of this._order) {
      if (field.inject) {
        inject.push(field)
      } else {
        field.create(values)
      }
    }

    for (const field of inject) {
      field.create(values[this.injected(field)])
    }

    return values
  }

  /** Whether a stored record satisfies every field's criteria. */
  retrieve(values: globalThis.Record<string, any>): boolean {
    for (const field of this._order) {
      if (field.inject) {
        // An injected field is checked where it's stored, in the field it lives inside.
        const injected = overscore.get(values[this.injected(field)] ?? {}, field.inject.split('__').slice(1).join('__'))

        if (!field.retrieve({ [field.store as string]: injected })) {
          return false
        }
      } else if (!field.retrieve(values)) {
        return false
      }
    }

    return true
  }

  /** Whether a stored record fuzzy-matches on any of the title fields. */
  like(
    values: globalThis.Record<string, any>,
    titles: string[],
    like: any,
    parents: globalThis.Record<string, any[]>
  ): boolean {
    for (const title of titles) {
      const path = overscore.parse(title)
      const field = this._names.get(String(path[0]))
      if (field !== undefined && field.like(values, like, parents, path.slice(1))) {
        return true
      }
    }

    return false
  }

  /** Load every field's value from a stored record. */
  read(values: globalThis.Record<string, any>): void {
    for (const field of this._order) {
      if (field.inject) {
        field.read(values[this.injected(field)] ?? {})
      } else {
        field.read(values)
      }
    }
  }

  /** Write every changed field's value for an update. */
  update(values: globalThis.Record<string, any>): globalThis.Record<string, any> {
    const inject: Field[] = []

    for (const field of this._order) {
      if (field.inject) {
        inject.push(field)
      } else {
        field.update(values)
      }
    }

    for (const field of inject) {
      if (field.delta() || field.refresh) {
        const root = String(field.inject).split('__')[0]
        const store = this._names.get(root)?.store as string
        if (!(store in values)) {
          this._names.get(root)?.write(values)
        }
        field.update(values[store])
      }
    }

    return values
  }

  /** Write every set field's value for a mass update. */
  mass(values: globalThis.Record<string, any>): globalThis.Record<string, any> {
    const inject: Field[] = []

    for (const field of this._order) {
      if (field.inject) {
        inject.push(field)
      } else {
        field.mass(values)
      }
    }

    for (const field of inject) {
      if (field.changed || field.refresh) {
        const root = String(field.inject).split('__')[0]
        const store = this._names.get(root)?.store as string
        if (!(store in values)) {
          this._names.get(root)?.write(values)
        }
        field.mass(values[store])
      }
    }

    return values
  }

  /** Write every set tie field's value for a many-to-many update. */
  tie(values: globalThis.Record<string, any>): globalThis.Record<string, any> {
    for (const field of this._order) {
      field.tie(values)
    }

    return values
  }
}
