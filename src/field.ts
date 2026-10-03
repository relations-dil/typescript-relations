/**
 * Fields: the typed, validating, filterable units a record is made of.
 */

import * as overscore from './overscore.js'
import { FieldError } from './errors.js'
import { clone, compare, equal, sorted } from './util.js'
import {
  builtin,
  container,
  kindName,
  scalar,
  set as setKind,
  str as strKind,
  type FieldKind,
  type Kind
} from './kinds.js'

/** How values map onto a class kind's properties, or a function that writes them. */
export type Attr = string | string[] | Record<string, string> | ((values: Record<string, any>, value: any) => void)

/** How a stored value maps back onto a class kind's constructor. */
export type Init = string | string[] | Record<string, string> | ((value: any) => any)

/** How a value is checked beyond its kind: a regular expression or a predicate. */
export type Validation = string | RegExp | ((value: any) => boolean)

/** Everything you can say about a field beyond its kind. */
export interface FieldOptions {
  /** Name in the model. Set for you from the key in `static fields`. */
  name?: string
  /** Name used when reading and writing to the source. Defaults to `name`. Set `false` to never store. */
  store?: string | false
  /** Whether this field carries a many-to-many tie. Managed by relations. */
  tied?: boolean
  /** How to flatten a class-kind value into storable values. Required for class kinds. */
  attr?: Attr
  /** How to build a class-kind value back from stored values. Defaults to `attr`. */
  init?: Init
  /** Which attributes make up this field's titles. Defaults to `attr`. */
  titles?: string | string[]
  /** Interior values to pull out into their own stored columns, keyed by path. */
  extract?: string | string[] | Record<string, Kind>
  /** Store this field inside another list or dict field, at the given path. */
  inject?: string
  /** Default value, or a function returning one. */
  default?: any
  /** Whether null is allowed. Inferred when not set. */
  none?: boolean
  /** The complete set of allowed values. */
  options?: any[]
  /** A regular expression or predicate the value must satisfy. */
  validation?: Validation
  /** Length of the value, for sources that need it. */
  length?: number
  /** How to format the value, one entry per title. */
  format?: any
  /** Whether the field can't be written by the caller. */
  readonly?: boolean
  /** Whether the source generates this value (an auto increment id, say). */
  auto?: boolean
  /** Whether to reset to the default on update when untouched. */
  refresh?: boolean
  /** Anything else a source wants to hang off the field. */
  [option: string]: any
}

/** Which comparison operators exist, and whether each takes multiple values. */
export const OPERATORS: Record<string, boolean> = Object.freeze({
  null: false,
  eq: false,
  gt: false,
  gte: false,
  lt: false,
  lte: false,
  like: false,
  start: false,
  end: false,
  in: true,
  has: true,
  any: true,
  all: true
})

/**
 * Names a field can't have, because the model already uses them. Use `store` when the
 * source column really is called one of these.
 */
export const RESERVED: string[] = [
  'action',
  'add',
  'append',
  'bulk',
  'catch',
  'constructor',
  'count',
  'create',
  'define',
  'delete',
  'export',
  'filter',
  'finally',
  'insert',
  'keys',
  'like',
  'limit',
  'many',
  'match',
  'models',
  'one',
  'overflow',
  'prepare',
  'query',
  'queue',
  'read',
  'retrieve',
  'satisfy',
  'set',
  'size',
  'sort',
  'then',
  'thy',
  'titles',
  'toJSON',
  'update',
  'write'
]

/** Attributes that can appear in a definition, in the order they're emitted. */
const DEFINABLE = [
  'name',
  'store',
  'none',
  'default',
  'options',
  'validation',
  'length',
  'format',
  'readonly',
  'auto',
  'refresh',
  'inject',
  'tied',
  'extract'
]

function membership(collection: any, item: any): boolean {
  if (collection instanceof Set) {
    return collection.has(item)
  }
  if (Array.isArray(collection)) {
    return collection.some((each) => equal(each, item))
  }
  if (typeof collection === 'string') {
    return collection.includes(String(item))
  }
  if (collection && typeof collection === 'object') {
    return Object.prototype.hasOwnProperty.call(collection, String(item))
  }
  return false
}

function count(collection: any): number {
  if (collection instanceof Set) {
    return collection.size
  }
  if (Array.isArray(collection) || typeof collection === 'string') {
    return collection.length
  }
  return Object.keys(collection).length
}

function mapping(value: string | string[] | Record<string, string> | undefined | null): Record<string, string> | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    return { [value]: value }
  }
  if (Array.isArray(value)) {
    return Object.fromEntries(value.map((each) => [each, each]))
  }
  return value
}

/**
 * A single typed value on a model, with everything needed to validate it, filter on it,
 * and move it in and out of a source.
 */
export class Field {
  /** Extra attributes a source hung off this field. */
  [option: string]: any

  /** Data kind to cast values as, or validate against. */
  kind: FieldKind

  /** Name used in models. */
  private _name: string | null = null
  /** Name used when reading and writing. `false` means never stored. */
  store: string | false | null = null
  /** Whether this field is used for a many-to-many tie. */
  tied: boolean | null = null

  /** Attributes to store, for class kinds. */
  attr: Record<string, string> | ((values: Record<string, any>, value: any) => void) | null = null
  /** Attributes to construct with, for class kinds. */
  init: Record<string, string> | ((value: any) => any) | null = null
  /** Attributes that make up the titles. */
  titles: string[] | null = null

  /** Interior values to pull out into their own stored columns. */
  extract: Record<string, Kind> | null = null
  /** Path in another field to store this value at. */
  inject: string | null = null

  /** Default value, or a factory for one. */
  default: any = null
  /** Whether null is allowed. */
  none: boolean = true
  /** What `none` was before it got inferred. */
  _none: boolean | null = null
  /** The complete set of allowed values. */
  options: any[] | null = null
  /** A regular expression or predicate. */
  validation: Validation | null = null
  /** Length of the value. */
  length: number | null = null
  /** Formatting instructions, one per title. */
  format: any[] | null = null
  /** Whether the caller may write this field. */
  readonly: boolean | null = null
  /** Whether the source generates the value. */
  auto: boolean | null = null
  /** Whether to reset to the default on an untouched update. */
  refresh: boolean | null = null

  /** Current value. */
  private _value: any = null
  /** Value as last read from or written to the source, in exported form. */
  original: any = null
  /** Criteria to search by, keyed by criterion. */
  criteria: Record<string, any> | null = null
  /** Whether the value has been set since the record was built. */
  changed: boolean | null = null

  constructor(kind: FieldKind, options?: FieldOptions | boolean | null) {
    this.kind = kind

    // A lone boolean means `none`, unless the field itself is boolean.
    if (typeof options === 'boolean' && kind !== undefined) {
      options = { none: options }
    }

    const settings: FieldOptions = (options as FieldOptions) ?? {}

    for (const [option, value] of Object.entries(settings)) {
      if (value !== undefined) {
        ;(this as any)[option] = value
      }
    }

    // Remember what was asked for, before inference - relations uses it for unique indexes.
    this._none = settings.none === undefined ? null : settings.none

    // Containers are never null and default to empty, so they're always usable.
    if (container(this.kind)) {
      this.none = false
      if (this.default === null) {
        this.default = () => (this.kind as Kind).empty()
      }
    } else if (settings.none === undefined) {
      // With no default, options, or validation there's nothing to be wrong about.
      this.none = this.default === null && this.options === null && this.validation === null
    }

    if (this.default !== null && typeof this.default !== 'function') {
      if (!this.check(this.default)) {
        throw new FieldError(this, `${JSON.stringify(this.default)} default not ${kindName(this.kind)} for ${this.name}`)
      }
    }

    if (this.options !== null && this.kind !== setKind) {
      for (const option of this.options) {
        if (!this.check(option)) {
          throw new FieldError(this, `${JSON.stringify(option)} option not ${kindName(this.kind)} for ${this.name}`)
        }
      }
    }

    if (
      this.validation !== null &&
      typeof this.validation !== 'string' &&
      !(this.validation instanceof RegExp) &&
      typeof this.validation !== 'function'
    ) {
      throw new FieldError(this, `${String(this.validation)} validation not regex or function for ${this.name}`)
    }

    if (!builtin(this.kind) && settings.attr === undefined) {
      throw new FieldError(this, `${kindName(this.kind)} requires at least attr`)
    }

    // attr stands in for titles and init when those aren't given.
    if (settings.attr !== undefined && settings.titles === undefined) {
      this.titles = settings.attr as any
    }

    if (settings.attr !== undefined && settings.init === undefined) {
      this.init = settings.attr as any
    }

    if (typeof this.attr !== 'function') {
      this.attr = mapping(this.attr as any)
    }

    if (typeof this.init !== 'function') {
      this.init = mapping(this.init as any)
    }

    if (typeof this.titles === 'string') {
      this.titles = [this.titles]
    } else if (this.titles !== null && !Array.isArray(this.titles)) {
      this.titles = Object.keys(this.titles)
    }

    if (this.format === null && this.titles !== null) {
      this.format = this.titles.map(() => null)
    }

    if (this.format !== null && !Array.isArray(this.format)) {
      this.format = [this.format]
    }

    // extract accepts a path, a list of paths, or paths mapped to kinds; str is the default kind.
    if (typeof this.extract === 'string') {
      this.extract = { [this.extract]: strKind }
    } else if (Array.isArray(this.extract)) {
      this.extract = Object.fromEntries((this.extract as string[]).map((each) => [each, strKind]))
    } else if (this.extract !== null && typeof this.extract === 'object') {
      this.extract = Object.fromEntries(
        Object.entries(this.extract).map(([path, kind]) => [path, kind ?? strKind])
      )
    }
  }

  /** Name used in models. Setting it validates the name and fills in `store`. */
  get name(): string | null {
    return this._name
  }

  set name(value: string | null) {
    if (value !== null) {
      let error: string | null = null

      if (RESERVED.includes(value)) {
        error = 'is reserved'
      } else if (value.includes('__')) {
        error = "cannot contain '__'"
      } else if (value[0] === '_') {
        error = "cannot start with '_'"
      }

      if (error) {
        throw new FieldError(this, `field name '${value}' ${error} - use the store option for this name`)
      }

      if (this.store === null) {
        this.store = value
      }
    }

    this._name = value
  }

  /** Current value. Setting it validates and casts, and marks the field changed. */
  get value(): any {
    return this._value
  }

  set value(value: any) {
    this._value = this.valid(value)
    this.changed = true
  }

  /** Set the value without marking the field changed. */
  load(value: any): void {
    this._value = this.valid(value)
  }

  /** Whether a value is already of this field's kind. */
  private check(value: unknown): boolean {
    return builtin(this.kind) ? this.kind.check(value) : value instanceof (this.kind as any)
  }

  /** An independent copy, used when a model builds a record from its fields. */
  copy(): Field {
    const field = Object.create(Field.prototype) as Field

    for (const [key, value] of Object.entries(this)) {
      ;(field as any)[key] = ['kind', 'attr', 'init', 'validation', 'default'].includes(key.replace(/^_/, ''))
        ? value
        : clone(value)
    }

    field.kind = this.kind
    field.attr = this.attr
    field.init = this.init
    field.validation = this.validation
    field.default = this.default
    field.extract = this.extract

    return field
  }

  /** The definition of this field, for schemas and migrations. */
  define(): Record<string, any> {
    const definition: Record<string, any> = { kind: kindName(this.kind) }

    for (const attr of DEFINABLE) {
      const value = (this as any)[attr]

      if (value === null || value === undefined || typeof value === 'function') {
        continue
      }

      if (attr === 'extract') {
        definition[attr] = Object.fromEntries(
          Object.entries(this.extract as Record<string, Kind>).map(([path, kind]) => [path, kindName(kind)])
        )
      } else if (attr === 'validation' && value instanceof RegExp) {
        definition[attr] = value.source
      } else {
        definition[attr] = clone(value)
      }
    }

    return definition
  }

  /** The valid form of a value, throwing when it can't be made valid. */
  valid(value: any): any {
    // none rules all
    if (value === null || value === undefined) {
      if (!this.none) {
        throw new FieldError(this, `null not allowed for ${this.name}`)
      }
      return null
    }

    if (!this.check(value)) {
      try {
        if (typeof this.init === 'function') {
          value = this.init(value)
        } else if (this.init !== null && overscore.isDict(value)) {
          const built: Record<string, any> = {}
          for (const [init, store] of Object.entries(this.init)) {
            built[init] = overscore.get(value, store)
          }
          value = new (this.kind as any)(built)
        } else if (builtin(this.kind)) {
          value = this.kind.cast(value)
        } else {
          value = new (this.kind as any)(value)
        }
      } catch (error) {
        throw new FieldError(this, `${JSON.stringify(value) ?? String(value)} invalid for ${this.name}: ${(error as Error).message}`)
      }
    }

    if (this.options !== null) {
      if (this.kind === setKind) {
        for (const each of value as Set<any>) {
          if (!membership(this.options, each)) {
            throw new FieldError(this, `${JSON.stringify(each)} not in ${JSON.stringify(this.options)} for ${this.name}`)
          }
        }
      } else if (!membership(this.options, value)) {
        throw new FieldError(this, `${JSON.stringify(value)} not in ${JSON.stringify(this.options)} for ${this.name}`)
      }
    }

    if (this.validation !== null) {
      if (typeof this.validation === 'string' || this.validation instanceof RegExp) {
        const expression =
          this.validation instanceof RegExp ? this.validation : new RegExp(this.validation)
        if (!expression.test(String(value))) {
          throw new FieldError(this, `${JSON.stringify(value)} doesn't match ${String(this.validation)} for ${this.name}`)
        }
      } else if (typeof this.validation === 'function') {
        if (!this.validation(value)) {
          throw new FieldError(this, `${JSON.stringify(value)} invalid for ${this.name}`)
        }
      }
    }

    return value
  }

  /** Add a criterion to this field's criteria. */
  filter(value: any, criterion: string = 'eq'): void {
    const path = overscore.parse(criterion)
    const last = path[path.length - 1]

    let operator: string

    if (typeof last !== 'string' || !(last.replace(/^not_/, '') in OPERATORS)) {
      operator = 'eq'
      criterion = `${criterion}__eq`
    } else {
      operator = String(path.pop())
      if (operator.startsWith('not_')) {
        operator = operator.slice(4)
      }
    }

    if (path.length && scalar(this.kind)) {
      throw new FieldError(this, `no path ${JSON.stringify(path)} with kind ${kindName(this.kind)}`)
    }

    if (this.criteria === null) {
      this.criteria = {}
    }

    if ((value === null || value === undefined) && operator === 'eq') {
      value = true
      operator = 'null'
      criterion = `${criterion.slice(0, -2)}null`
    }

    if (OPERATORS[operator]) {
      if (!(criterion in this.criteria)) {
        this.criteria[criterion] = []
      }

      const values = value instanceof Set ? [...value] : Array.isArray(value) ? value : [value]

      if (path.length || this.kind === setKind || kindName(this.kind) === 'list') {
        this.criteria[criterion].push(...values)
      } else {
        this.criteria[criterion].push(...values.map((item) => this.valid(item)))
      }
    } else if (operator === 'null') {
      this.criteria[criterion] = !(
        value === 'false' ||
        value === 'no' ||
        value === '0' ||
        value === 0 ||
        !value
      )
    } else if (path.length) {
      this.criteria[criterion] = value
    } else {
      this.criteria[criterion] = this.valid(value)
    }
  }

  /** The storable form of this field's value. */
  export(): any {
    if (this.kind === setKind) {
      const value: Set<any> = this._value ?? new Set()
      if (this.options !== null) {
        return this.options.filter((option) => value.has(option))
      }
      return sorted(value)
    }

    if (this._value === null || this._value === undefined || this.attr === null) {
      return clone(this._value ?? null)
    }

    const values: Record<string, any> = {}

    if (typeof this.attr === 'function') {
      this.attr(values, this._value)
    } else {
      for (const [attr, store] of Object.entries(this.attr)) {
        const found = (this._value as any)[attr]
        overscore.set(values, store, typeof found === 'function' ? found.call(this._value) : found)
      }
    }

    return values
  }

  /** Store a value at a path inside this field. */
  apply(path: overscore.Path, value: any): void {
    if (scalar(this.kind)) {
      throw new FieldError(this, `no apply for ${kindName(this.kind)}`)
    }

    let values = this.export()

    if (values === null || values === undefined) {
      values = container(this.kind) && kindName(this.kind) !== 'dict' ? [] : {}
    }

    overscore.set(values, path, value)
    this.value = values
  }

  /** Read the value at a path inside this field. */
  access(path: overscore.Path): any {
    if (scalar(this.kind)) {
      throw new FieldError(this, `no access for ${kindName(this.kind)}`)
    }

    return overscore.get(this.export(), path)
  }

  /** Whether the value differs from what was last read or written. */
  delta(): boolean {
    return !equal(this.export(), this.original)
  }

  /** Write this field's value into a values object for storage. */
  write(values: Record<string, any>): void {
    const value = this.export()

    if (this.inject) {
      overscore.set(values, this.inject.split('__').slice(1).join('__'), value)
    } else if (this.store) {
      values[this.store] = value
    }
  }

  /** Write this field's value for a create. */
  create(values: Record<string, any>): void {
    if (!this.auto) {
      this.write(values)
      this.original = this.export()
    }
  }

  /** Whether a stored record satisfies this field's criteria. */
  retrieve(values: Record<string, any>): boolean {
    for (const [criterion, satisfy] of Object.entries(this.criteria ?? {})) {
      let value = this.store === false ? null : values[this.store as string] ?? null

      if (builtin(this.kind)) {
        value = this.valid(value)
      } else if (!value) {
        value = value || {}
      }

      const path = overscore.parse(criterion)
      const pieces = String(path.pop()).split('_')
      const operator = pieces[pieces.length - 1]
      const invert = pieces.length > 1

      value = path.length ? overscore.get(this.kind === setKind ? sorted(value) : value, path) : value

      let condition = false

      if (operator === 'null') {
        condition = satisfy === (value === null || value === undefined)
      } else if (value === null || value === undefined) {
        condition = false
      } else if (operator === 'in') {
        condition = membership(satisfy, value)
      } else if (operator === 'eq') {
        condition = equal(value, satisfy)
      } else if (operator === 'gt') {
        condition = compare(value, satisfy) > 0
      } else if (operator === 'gte') {
        condition = compare(value, satisfy) >= 0
      } else if (operator === 'lt') {
        condition = compare(value, satisfy) < 0
      } else if (operator === 'lte') {
        condition = compare(value, satisfy) <= 0
      } else if (operator === 'like') {
        condition = String(value).toLowerCase().includes(String(satisfy).toLowerCase())
      } else if (operator === 'start') {
        condition = String(value).toLowerCase().startsWith(String(satisfy).toLowerCase())
      } else if (operator === 'end') {
        condition = String(value).toLowerCase().endsWith(String(satisfy).toLowerCase())
      } else if (operator === 'has') {
        condition = (satisfy as any[]).every((item) => membership(value, item))
      } else if (operator === 'any') {
        condition = (satisfy as any[]).some((item) => membership(value, item))
      } else if (operator === 'all') {
        condition =
          (satisfy as any[]).every((item) => membership(value, item)) && count(value) === new Set(satisfy).size
      }

      if (invert) {
        condition = !condition
      }

      if (!condition) {
        return false
      }
    }

    return true
  }

  /** Whether a stored record matches a fuzzy `like`, or is one of a parent's matches. */
  like(values: Record<string, any>, like: any, parents: Record<string, any[]>, path?: overscore.Path): boolean {
    const at = path === undefined ? undefined : typeof path === 'string' ? overscore.parse(path) : path
    let value = this.store === false ? null : values[this.store as string] ?? null

    if (this.titles !== null && at === undefined) {
      if (!value) {
        return false
      }
      for (const store of this.titles) {
        const needle = String(like).toLowerCase()
        if (needle.length && String(overscore.get(value, store) ?? value[store]).toLowerCase().includes(needle)) {
          return true
        }
      }
      return false
    }

    if (at && at.length) {
      value = overscore.get(value, at)
    } else {
      value = this.valid(value)
    }

    if (this.store !== false && this.store !== null && this.store in parents) {
      return membership(parents[this.store], value)
    }

    return String(value).toLowerCase().includes(String(like).toLowerCase())
  }

  /** Load this field's value from a stored record. */
  read(values: Record<string, any>): void {
    if (this.inject) {
      this.load(overscore.get(values, this.inject.split('__').slice(1).join('__')))
    } else if (this.store) {
      this.load(values[this.store] ?? null)
    }

    this.original = this.export()
    this.changed = null
  }

  /** The title values for this field, optionally at a path. */
  title(path?: overscore.Path): any[] {
    if (scalar(this.kind)) {
      return [this._value]
    }

    const at = path === undefined ? [] : typeof path === 'string' ? overscore.parse(path) : path

    if (container(this.kind)) {
      return [at.length ? overscore.get(this.export(), at) : this.export()]
    }

    const values = this.export()

    if (at.length) {
      return [overscore.get(values, at)]
    }

    return (this.titles ?? []).map((title) => overscore.get(values, title))
  }

  /** Write this field's value for an update, if it changed. */
  update(values: Record<string, any>): void {
    if (this.refresh && !this.delta()) {
      this.value = typeof this.default === 'function' ? this.default() : this.default
    }

    if (this.delta()) {
      this.write(values)
      this.original = this.export()
    }
  }

  /** Write this field's value for a mass update, if it was set. */
  mass(values: Record<string, any>): void {
    if (this.refresh && !this.changed) {
      this.value = typeof this.default === 'function' ? this.default() : this.default
    }

    if (this.changed) {
      if (this.inject) {
        throw new FieldError(this, 'no mass update with inject')
      }

      this.write(values)
    }
  }

  /** Write this field's value for a many-to-many tie update, if it was set. */
  tie(values: Record<string, any>): void {
    if (!this.tied) {
      return
    }

    if (this.changed) {
      values[this.name as string] = this.export()
    }
  }
}
