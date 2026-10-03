/**
 * Models: what you actually write, and the only thing that knows about relations.
 */

import * as overscore from './overscore.js'
import { FieldError, ModelError } from './errors.js'
import { Field, type FieldOptions } from './field.js'
import { Record } from './record.js'
import { source as registered } from './registry.js'
import { compare as order, underscore } from './util.js'
import { bool, builtin, dict, float, int, list, set, str, type FieldKind, type Kind } from './kinds.js'
import type { ManyToMany, OneTo } from './relation.js'

/** Marks a constructor call as coming from relations itself rather than a caller. */
const INTERNAL = Symbol('relations.internal')

/** Identity attributes that go into a definition under their underscored name. */
const DEFINE = ['id', 'unique', 'index']

/** Uppercase attributes that never go into a definition. */
const UNDEFINE = [
  'ID',
  'TITLES',
  'LIST',
  'UNIQUE',
  'INDEX',
  'ORDER',
  'CHUNK',
  'PARENTS',
  'CHILDREN',
  'SISTERS',
  'BROTHERS'
]

/** Uppercase attributes relations sets itself, so extras can be spotted. */
const KNOWN = new Set([...UNDEFINE, 'SOURCE', 'TITLE', 'NAME', 'TIE'])

/** What a model is currently doing. */
export type ModelAction = 'create' | 'retrieve' | 'update'

/** Whether a model holds one record or many. */
export type ModelMode = 'one' | 'many'

/** What a model is to whatever reached it. */
export type ModelRole = 'model' | 'parent' | 'child'

/** Everything accepted as a field declaration in `static fields`. */
export type FieldSpec =
  | Kind
  | Field
  | Set<any>
  | any[]
  | (() => any)
  | ({ kind: FieldKind } & FieldOptions)

/** Options relations passes to itself when building related or loaded models. */
interface Internals {
  read?: globalThis.Record<string, any>
  child?: globalThis.Record<string, any>
  parent?: globalThis.Record<string, any>
  sibling?: globalThis.Record<string, any>
  action?: ModelAction
  mode?: ModelMode
  chunk?: number
  bulk?: boolean
  size?: number
  related?: globalThis.Record<string, any>
  args?: any[]
}

/** Positional and named values, teased apart from a variadic call. */
interface Split {
  positional: any[]
  named: globalThis.Record<string, any>
}

function plain(value: unknown): value is globalThis.Record<string, any> {
  return overscore.isDict(value)
}

/** A trailing plain object is named values; everything before it is positional. */
function split(args: any[]): Split {
  const values = [...args]
  let named: globalThis.Record<string, any> = {}

  if (values.length && plain(values[values.length - 1])) {
    named = { ...(values.pop() as globalThis.Record<string, any>) }
  }

  return { positional: values, named }
}

/** Options a caller may pass alongside field values, the way Python passes kwargs. */
const OPTIONS: globalThis.Record<string, keyof Internals> = {
  _read: 'read',
  _child: 'child',
  _parent: 'parent',
  _sibling: 'sibling',
  _action: 'action',
  _mode: 'mode',
  _chunk: 'chunk',
  _bulk: 'bulk',
  _size: 'size',
  _related: 'related'
}

/** Pull relations' own options out of named values, leaving the field values behind. */
function options(named: globalThis.Record<string, any>, into: Internals): void {
  for (const [key, option] of Object.entries(OPTIONS)) {
    if (key in named) {
      ;(into as any)[option] = named[key]
      delete named[key]
    }
  }
}

function classy(value: (...args: any[]) => unknown): boolean {
  return /^\s*class[\s{]/.test(Function.prototype.toString.call(value))
}

/** The kind that best describes a value, used to type defaults and options. */
function kindOfValue(value: unknown): Kind {
  if (typeof value === 'boolean') {
    return bool
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? int : float
  }
  if (typeof value === 'string') {
    return str
  }
  if (value instanceof Set) {
    return set
  }
  if (Array.isArray(value)) {
    return list
  }
  return dict
}

/** Turn a `static fields` entry into an actual Field. */
export function toField(spec: FieldSpec): Field {
  if (spec instanceof Field) {
    return spec
  }

  if (builtin(spec as any)) {
    return new Field(spec as Kind)
  }

  if (spec instanceof Set) {
    return new Field(set, { options: [...spec].sort() })
  }

  if (Array.isArray(spec)) {
    if (!spec.length) {
      throw new Error('a field declared as an array needs at least one option')
    }
    return new Field(kindOfValue(spec[0]), { default: spec[0], options: spec })
  }

  if (typeof spec === 'function') {
    if (classy(spec)) {
      throw new Error(
        `class kinds need attr - declare the field as { kind: ${spec.name}, attr: [...] }`
      )
    }
    const sample = (spec as () => any)()
    return new Field(kindOfValue(sample), { default: spec })
  }

  if (plain(spec) && 'kind' in spec) {
    return new Field((spec as any).kind, spec as FieldOptions)
  }

  throw new Error(`cannot make a field from ${JSON.stringify(spec)}`)
}

/**
 * What's knowable about a model without having an instance of it: its name, its fields,
 * its indexes, its relations. Sources and migrations work against this.
 */
export class ModelIdentity {
  /** Anything else the model class hung off itself in uppercase. */
  [attribute: string]: any

  /** Name of the source this model lives in. */
  SOURCE: string | null = null

  /** Human-facing title of the model. */
  TITLE: string | null = null
  /** Name of the model in the source. */
  NAME: string | null = null
  /** Whether this model is a many-to-many tie table. */
  TIE: boolean | null = null

  /** Parent relations, keyed by the attribute on this model. */
  PARENTS: globalThis.Record<string, OneTo> = {}
  /** Child relations, keyed by the attribute on this model. */
  CHILDREN: globalThis.Record<string, OneTo> = {}
  /** Sister relations, keyed by the attribute on this model. */
  SISTERS: globalThis.Record<string, ManyToMany> = {}
  /** Brother relations, keyed by the attribute on this model. */
  BROTHERS: globalThis.Record<string, ManyToMany> = {}

  /** Default chunk size for related lookups and bulk creates. */
  CHUNK = 100

  /** The model's fields, in order. Records are built from these. */
  _fields: Record = new Record()
  /** Name of the id field, if there is one. */
  _id: string | null = null
  /** Fields that make up a title. */
  _titles: string[] = []
  /** Fields to show in a listing. */
  _list: string[] = []
  /** Unique indexes, keyed by index name. */
  _unique: globalThis.Record<string, string[]> = {}
  /** Regular indexes, keyed by index name. */
  _index: globalThis.Record<string, string[]> = {}
  /** Default sort order, as signed field names. */
  _order: string[] = []

  /** The name of a field, whether given by name or position. */
  _fieldName(field: string | number): string {
    if (!this._fields.has(field)) {
      throw new ModelError(this, `cannot find field ${field} in ${this.NAME}`)
    }

    if (typeof field === 'string') {
      return field
    }

    return this._fields._order[field].name as string
  }

  /** Turn a sort spec into signed field names, checking each one exists. */
  _ordering(sort: string | string[]): string[] {
    const sorts = typeof sort === 'string' ? [sort] : [...sort]
    const ordering: string[] = []

    for (const each of sorts) {
      const field = ['-', '+'].includes(each[0]) ? each.slice(1) : each

      if (!this._fields.has(field.split('__')[0])) {
        throw new ModelError(this, `unknown sort field ${field}`)
      }

      ordering.push(each === field ? `+${each}` : each)
    }

    return ordering
  }

  /** The parent relation a field points at, if any. */
  _ancestor(field: string): OneTo | null {
    for (const relation of Object.values(this.PARENTS)) {
      if (field === relation.childParentRef) {
        return relation
      }
    }

    return null
  }

  /** The full definition of this model, for schemas and migrations. */
  define(): globalThis.Record<string, any> {
    const definition: globalThis.Record<string, any> = {
      fields: this._fields.define()
    }

    for (const attr of DEFINE) {
      const value = (this as any)[`_${attr}`]
      if (value !== null && value !== undefined) {
        definition[attr] = value
      }
    }

    // Any uppercase attribute that carries meaning lands in the definition, lowercased.
    for (const attr of Object.keys(this)) {
      if (
        attr[0] !== '_' &&
        attr === attr.toUpperCase() &&
        !UNDEFINE.includes(attr) &&
        (this as any)[attr] !== null &&
        (this as any)[attr] !== undefined
      ) {
        definition[attr.toLowerCase()] = (this as any)[attr]
      }
    }

    return definition
  }

  /** How to get from a previous definition of this model to this one. */
  migrate(previous: globalThis.Record<string, any>, definition?: globalThis.Record<string, any>): globalThis.Record<string, any> {
    return MigrationsRef.model(previous, definition ?? this.define())
  }
}

// Set by migrations.ts at import time, so identity.migrate works without a circular import.
export const MigrationsRef: { model: (current: any, define: any) => any } = {
  model: () => {
    throw new Error('migrations not loaded')
  }
}

/** The static shape of a model class. */
export interface ModelClass<M extends Model = Model> {
  new (...args: any[]): M
  source?: string
  fields?: globalThis.Record<string, FieldSpec>
  store?: string
  title?: string
  id?: string | number | null
  titles?: string | string[]
  list?: string | string[]
  unique?: string | string[] | globalThis.Record<string, string[]> | false
  index?: string | string[] | globalThis.Record<string, string[]>
  order?: string | string[]
  chunk?: number
  thy(target?: ModelIdentity): ModelIdentity
  [member: string]: any
}

/**
 * A model. Extend it, declare `static source` and `static fields`, and you have
 * something you can create, retrieve, update and delete against any source.
 *
 * ```ts
 * class Unit extends Model {
 *   static source = 'example'
 *   static fields = { id: int, name: str }
 * }
 *
 * await new Unit('yep').create()
 * const unit = await Unit.one({ name: 'yep' }).retrieve()
 * ```
 */
export class Model extends ModelIdentity {
  /** The single loaded record, in one mode. */
  _record: Record | null = null
  /** The loaded models, in many mode. */
  _models: Model[] | null = null

  /** Loaded parent models, keyed by attribute. */
  _parents: globalThis.Record<string, Model | null> = {}
  /** Loaded child models, keyed by attribute. */
  _children: globalThis.Record<string, Model | null> = {}
  /** Loaded sister models, keyed by attribute. */
  _sisters: globalThis.Record<string, Model | null> = {}
  /** Loaded brother models, keyed by attribute. */
  _brothers: globalThis.Record<string, Model | null> = {}
  /** Pending sibling-attribute criteria, keyed by relation attribute. */
  _ties: globalThis.Record<string, globalThis.Record<string, any>> = {}

  /** What this model is to whatever reached it. */
  _role: ModelRole = 'model'
  /** Whether this model holds one record or many. */
  _mode: ModelMode | null = null
  /** Whether this is a bulk insert. */
  _bulk = false
  /** Chunk size for this model. */
  _chunk = 100
  /** How many to accumulate before a bulk insert flushes. */
  _size = 100
  /** The current fuzzy match. */
  _like: any = null
  /** Sorting to apply on retrieve. */
  _sort: string[] | null = null
  /** How many records to retrieve. */
  _limit: number | null = null
  /** Where to start retrieving from. */
  _offset = 0
  /** What this model is doing. */
  _action: ModelAction = 'create'
  /** Fields set automatically because of a relation. */
  _related: globalThis.Record<string, any> = {}

  /** Whether a limit was reached, so there may be more records than were returned. */
  overflow = false

  constructor(...args: any[]) {
    super()

    const internal: Internals = args[0] === INTERNAL ? { ...(args[1] as Internals) } : {}
    const { positional, named } = split(args[0] === INTERNAL ? internal.args ?? [] : args)

    options(named, internal)

    // Know thyself.
    ;(this.constructor as unknown as ModelClass).thy(this)

    this._parents = {}
    this._children = {}
    this._sisters = {}
    this._brothers = {}
    this._ties = {}
    this._related = {}

    this._role = 'model'
    this._action = internal.action ?? 'create'
    this._chunk = internal.chunk ?? this.CHUNK

    if (internal.read !== undefined) {
      // Built from a record that came back out of a source.
      this._mode = 'one'
      this._action = 'update'
      this._record = this._build('update', { read: internal.read })
    } else if (internal.child !== undefined) {
      // Built as the parent of a model that asked for it.
      this._related = internal.child
      this._role = 'parent'
      this._mode = 'one'
      this._action = 'retrieve'
      this._record = this._build('retrieve', { defaults: false })
      this.filter(...positional, named)
    } else if (internal.parent !== undefined) {
      // Built as the child of a model that asked for it.
      this._related = internal.parent
      this._role = 'child'
      this._mode = internal.mode ?? null
      this._action = Object.values(this._related)[0] !== null ? 'retrieve' : 'create'

      if (this._action === 'retrieve') {
        this._record = this._build('retrieve', { defaults: false })
        this.filter(...positional, named)
      }
    } else if (internal.sibling !== undefined) {
      // Built as the far side of a many-to-many.
      this._mode = 'many'
      this._action = 'retrieve'
      this._record = this._build('retrieve', { defaults: false })
      this.filter(...positional, { ...internal.sibling, ...named })
    } else if (this._action === 'retrieve') {
      this._mode = internal.mode ?? null
      this._record = this._build('retrieve', { defaults: false })
      this.filter(...positional, named)
    } else {
      this._bulk = internal.bulk ?? false
      this._size = internal.size ?? this._chunk
      this._mode = internal.mode ?? (this._bulk || (positional.length && Array.isArray(positional[0])) ? 'many' : 'one')
      this._related = internal.related ?? {}

      if (this._mode === 'many') {
        this._models = []

        if (positional.length) {
          for (const each of positional[0] as any[]) {
            this._models.push(
              construct(this.constructor as unknown as ModelClass, {
                action: 'create',
                related: this._related,
                args: Array.isArray(each) ? each : [each]
              })
            )
          }
        }
      } else {
        this._record = this._build('create', { positional, named })
      }
    }

    return wrap(this)
  }

  // ------------------------------------------------------------------ identity

  /**
   * Work out everything knowable about this model class. Called for you on every
   * instance; call it directly when you need a model's shape without an instance.
   */
  static thy(target?: ModelIdentity): ModelIdentity {
    const cls = this as unknown as ModelClass
    const self = target ?? new ModelIdentity()

    self.TITLE = cls.title ?? cls.name
    self.NAME = cls.store ?? underscore(self.TITLE as string)

    // Build the fields.
    const fields = new Record()

    for (const [name, spec] of Object.entries(cls.fields ?? {})) {
      const field = toField(spec)
      field.name = name
      fields.append(field)
    }

    self._fields = fields

    // Which field is the id.
    const id = cls.id === undefined ? 0 : cls.id
    self._id = id === null ? null : self._fieldName(id)

    // Which fields make up a title.
    let titles = cls.titles

    if (!titles) {
      const found: string[] = []
      for (const field of self._fields._order) {
        if (self._id === field.name) {
          continue
        }
        if (field.kind === int || field.kind === str) {
          found.push(field.name as string)
          if (field.kind === str && field._none === null) {
            field.none = false
          }
        }
        if (field.kind === str) {
          break
        }
      }
      titles = found
    }

    self._titles = typeof titles === 'string' ? [titles] : [...titles]

    for (const field of self._titles) {
      if (!self._fields.has(field.split('__')[0])) {
        throw new ModelError(self, `cannot find field ${field} from titles`)
      }
    }

    // Which fields to list.
    if (cls.list) {
      self._list = typeof cls.list === 'string' ? [cls.list] : [...cls.list]
    } else {
      self._list = [...self._titles]
      if (self._id && !self._list.includes(self._id)) {
        self._list.unshift(self._id)
      }
    }

    for (const field of self._list) {
      if (!self._fields.has(field.split('__')[0])) {
        throw new ModelError(self, `cannot find field ${field} from list`)
      }
    }

    // Unique indexes: unset means the titles, explicitly empty means none.
    let unique = cls.unique

    if (unique === undefined) {
      unique = self._titles
    } else if (!unique || (Array.isArray(unique) && !unique.length)) {
      unique = {}
    }

    if (typeof unique === 'string') {
      unique = [unique]
    }

    if (Array.isArray(unique)) {
      unique = unique.length ? { [unique.join('-')]: unique } : {}
    }

    self._unique = unique as globalThis.Record<string, string[]>

    for (const [name, group] of Object.entries(self._unique)) {
      for (const field of group) {
        if (!self._fields.has(field.split('__')[0])) {
          throw new ModelError(self, `cannot find field ${field} from unique ${name}`)
        }
      }
    }

    // Regular indexes.
    let index = cls.index ?? {}

    if (typeof index === 'string') {
      index = [index]
    }

    if (Array.isArray(index)) {
      index = index.length ? { [index.join('-')]: index } : {}
    }

    self._index = index as globalThis.Record<string, string[]>

    for (const [name, group] of Object.entries(self._index)) {
      for (const field of group) {
        if (!self._fields.has(field.split('__')[0])) {
          throw new ModelError(self, `cannot find field ${field} from index ${name}`)
        }
      }
    }

    // Injected fields have to point at a list or dict field that exists.
    for (const field of self._fields._order) {
      if (!field.inject) {
        continue
      }
      const root = field.inject.split('__')[0]
      const into = self._fields.field(root)
      if (into === undefined) {
        throw new FieldError(field, `cannot find field ${root} from inject ${field.inject}`)
      }
      if (into.kind !== list && into.kind !== dict) {
        throw new FieldError(field, `field ${root} not list or dict from inject ${field.inject}`)
      }
    }

    // Default sort order.
    if (cls.order) {
      self._order = self._ordering(cls.order)
    } else if (cls.order === undefined && Object.keys(self._unique).length === 1) {
      self._order = self._ordering(Object.values(self._unique)[0])
    } else {
      self._order = []
    }

    self.CHUNK = cls.chunk ?? 100

    // Relations, registered on the class by the Relation constructors.
    self.PARENTS = cls.PARENTS ?? {}
    self.CHILDREN = cls.CHILDREN ?? {}
    self.SISTERS = cls.SISTERS ?? {}
    self.BROTHERS = cls.BROTHERS ?? {}
    self.TIE = cls.TIE ?? null

    // Anything else the class declared in uppercase travels with the identity.
    for (let level = cls; level && level !== Function.prototype; level = Object.getPrototypeOf(level)) {
      for (const attr of Object.getOwnPropertyNames(level)) {
        if (attr === attr.toUpperCase() && /^[A-Z]/.test(attr) && !KNOWN.has(attr) && !(attr in self)) {
          self[attr] = (cls as any)[attr]
        }
      }
    }

    for (const relation of Object.values(self.SISTERS)) {
      const field = self._fields.field(relation.brotherSisterRef) as Field
      field.store = false
      field.tied = true
    }

    for (const relation of Object.values(self.BROTHERS)) {
      const field = self._fields.field(relation.sisterBrotherRef) as Field
      field.store = false
      field.tied = true
    }

    // Let the source have its say.
    self.SOURCE = cls.source ?? null

    registered(self.SOURCE)?.init(self)

    return self
  }

  /** Register a parent relation on this class. */
  static _parent(relation: OneTo): void {
    const cls = this as any
    if (!Object.prototype.hasOwnProperty.call(cls, 'PARENTS')) {
      cls.PARENTS = { ...(cls.PARENTS ?? {}) }
    }
    cls.PARENTS[relation.childParentAttr] = relation
  }

  /** Register a child relation on this class. */
  static _child(relation: OneTo): void {
    const cls = this as any
    if (!Object.prototype.hasOwnProperty.call(cls, 'CHILDREN')) {
      cls.CHILDREN = { ...(cls.CHILDREN ?? {}) }
    }
    cls.CHILDREN[relation.parentChildAttr] = relation
  }

  /** Register a sister relation on this class. */
  static _sister(relation: ManyToMany): void {
    const cls = this as any
    if (!Object.prototype.hasOwnProperty.call(cls, 'SISTERS')) {
      cls.SISTERS = { ...(cls.SISTERS ?? {}) }
    }
    cls.SISTERS[relation.brotherSisterAttr] = relation
  }

  /** Register a brother relation on this class. */
  static _brother(relation: ManyToMany): void {
    const cls = this as any
    if (!Object.prototype.hasOwnProperty.call(cls, 'BROTHERS')) {
      cls.BROTHERS = { ...(cls.BROTHERS ?? {}) }
    }
    cls.BROTHERS[relation.sisterBrotherAttr] = relation
  }

  // ------------------------------------------------------------------ internals

  /** Whether a name is one of this model's relation attributes. */
  _isRelation(name: string): boolean {
    return name in this.PARENTS || name in this.CHILDREN || name in this.SISTERS || name in this.BROTHERS
  }

  /** The related model behind a relation attribute. */
  _relate(name: string): Model | null {
    if (this._bulk) {
      throw new ModelError(this, 'cannot access relatives in bulk mode')
    }

    if (name in this.PARENTS) {
      const relation = this.PARENTS[name]

      if (!this._parents[name]) {
        this._parents[name] =
          this._action === 'retrieve'
            ? (relation.Parent as any).many().limit(this._chunk)
            : construct(relation.Parent as any, {
                child: { [relation.parentId]: this._item(relation.childParentRef) }
              })
      }

      return this._parents[name]
    }

    if (name in this.CHILDREN) {
      const relation = this.CHILDREN[name]

      if (!this._children[name]) {
        this._children[name] =
          this._action === 'retrieve'
            ? (relation.Child as any).many().limit(this._chunk)
            : construct(relation.Child as any, {
                parent: { [relation.childParentRef]: (this._record as Record).get(relation.parentId) },
                mode: relation.MODE
              })
      }

      return this._children[name]
    }

    if (name in this.SISTERS) {
      const relation = this.SISTERS[name]

      if (!this._sisters[name]) {
        this._sisters[name] = construct(relation.Sister as any, {
          sibling: { [`${relation.sisterId}__in`]: (this._record as Record).get(relation.brotherSisterRef) }
        })
      }

      return this._sisters[name]
    }

    if (name in this.BROTHERS) {
      const relation = this.BROTHERS[name]

      if (!this._brothers[name]) {
        this._brothers[name] = construct(relation.Brother as any, {
          sibling: { [`${relation.brotherId}__in`]: (this._record as Record).get(relation.sisterBrotherRef) }
        })
      }

      return this._brothers[name]
    }

    return null
  }

  /** Hold on to a sibling-attribute filter until the source can resolve it. */
  _tie(name: string, remainder: string, value: any): void {
    this._ties[name] = this._ties[name] ?? {}
    this._ties[name][remainder] = value
  }

  /**
   * Fold criteria gathered on related models into this model's own criteria. Retrieving
   * the relatives is what makes this async: `Test.many({unit__name: 'x'})` has to find
   * the matching units before it can filter tests by their ids.
   */
  async _collate(): Promise<void> {
    for (const [attr, relation] of Object.entries(this.PARENTS)) {
      const parent = this._parents[attr]
      if (parent) {
        await parent._ensure()
        ;(this._record as Record).filter(`${relation.childParentRef}__in`, parent._item(relation.parentId))
        this.overflow = this.overflow || parent.overflow
        delete this._parents[attr]
      }
    }

    for (const [attr, relation] of Object.entries(this.CHILDREN)) {
      const child = this._children[attr]
      if (child) {
        await child._ensure()
        ;(this._record as Record).filter(`${relation.parentId}__in`, child._item(relation.childParentRef))
        this.overflow = this.overflow || child.overflow
        delete this._children[attr]
      }
    }
  }

  /** Keep relations honest when the field they hang off changes. */
  _propagate(field: string | number, value: any): void {
    const name = this._fieldName(field)

    if (name in this._related) {
      this._related[name] = value
    }

    for (const [attr, relation] of Object.entries(this.PARENTS)) {
      if (name === relation.childParentRef) {
        this._parents[attr] = null
      }
    }

    // Only push into children that already exist. Reaching for one that doesn't would
    // mean a retrieve, and a property assignment can't wait on the source.
    for (const [attr, relation] of Object.entries(this.CHILDREN)) {
      const child = this._children[attr]

      if (name !== relation.parentId || !child) {
        continue
      }

      child._related[relation.childParentRef] = value

      for (const model of child._models ?? []) {
        model._setItem(relation.childParentRef, value)
      }

      child._record?.set(relation.childParentRef, value)
    }

    for (const [attr, relation] of Object.entries(this.SISTERS)) {
      if (name === relation.brotherSisterRef) {
        this._sisters[attr] = null
      }
    }

    for (const [attr, relation] of Object.entries(this.BROTHERS)) {
      if (name === relation.sisterBrotherRef) {
        this._brothers[attr] = null
      }
    }
  }

  /** Fill a record in from positional and named values. */
  _input(record: Record, positional: any[], named: globalThis.Record<string, any>): void {
    let index = 0

    for (const value of positional) {
      while (
        index < record._order.length &&
        (record._order[index].auto || (record._order[index].name as string) in this._related)
      ) {
        index += 1
      }
      record.set(index, value)
      index += 1
    }

    for (const [name, value] of Object.entries(named)) {
      record.set(name, value)
    }
  }

  /** Build a fresh record for an action. */
  _build(
    action: 'create' | 'retrieve' | 'update',
    options: {
      defaults?: boolean
      read?: globalThis.Record<string, any>
      positional?: any[]
      named?: globalThis.Record<string, any>
    } = {}
  ): Record {
    const record = this._fields.copy()
    record._action = action

    if (options.defaults ?? true) {
      for (const field of record._order) {
        if (field.default !== null) {
          field.value = typeof field.default === 'function' ? field.default() : field.default
        }
      }
    }

    if (options.read !== undefined) {
      record.read(options.read)
    }

    for (const [field, value] of Object.entries(this._related)) {
      record.set(field, value)
    }

    this._input(record, options.positional ?? [], options.named ?? {})

    return record
  }

  /**
   * Guard synchronous access. A model that still has to hit the source can't fill
   * itself in from a property getter, so say so plainly instead of returning nothing.
   */
  _ensureSync(): void {
    if (this._action === 'retrieve') {
      throw new ModelError(
        this,
        'not retrieved yet - await model.retrieve() before reading values'
      )
    }
  }

  /** Retrieve if this model still needs to, then carry on. */
  async _ensure(): Promise<void> {
    if (this._action === 'retrieve') {
      if ((this._record as Record)._action === 'update') {
        throw new ModelError(this, 'need to update')
      }
      await this.retrieve()
    }
  }

  /** Every model this one stands for: itself in one mode, its models in many. */
  _each(action?: ModelAction): Model[] {
    if (this._record && (action === undefined || this._action === action)) {
      return [this._proxy as Model]
    }

    if (this._models) {
      return this._models.filter((model) => action === undefined || model._action === action)
    }

    return []
  }

  /** Read a value the way `model[key]` does. */
  _item(key: string | number): any {
    // A path is a relation walk only when it doesn't start at one of our own fields.
    if (typeof key === 'string' && key.includes('__') && !this._fields.has(key.split('__')[0])) {
      return this._path(key)
    }

    this._ensureSync()

    if (this._role === 'child' && this._mode === 'one') {
      if (this._models?.length) {
        return this._models[0]._item(key)
      }
      throw new ModelError(this, 'no record')
    }

    if (this._mode === 'one') {
      if (typeof key === 'string' && this._isRelation(key)) {
        return this._relate(key)
      }
      return (this._record as Record).get(key)
    }

    if (this._models === null) {
      throw new ModelError(this, 'no records')
    }

    if (typeof key === 'number') {
      return this._models[key < 0 ? this._models.length + key : key]
    }

    return this._models.map((model) => model._item(key))
  }

  /** Write a value the way `model[key] = value` does. */
  _setItem(key: string | number, value: any): void {
    this._ensureSync()

    if (this._role === 'child' && this._mode === 'one') {
      if (this._models?.length) {
        this._models[0]._setItem(key, value)
        return
      }
      throw new ModelError(this, 'no record')
    }

    if (this._mode === 'one') {
      ;(this._record as Record).set(key, value)
      if (typeof key !== 'string' || !key.includes('__')) {
        this._propagate(key, value)
      }
      return
    }

    if (typeof key === 'number') {
      throw new ModelError(this, 'no override')
    }

    if (!this._models?.length) {
      throw new ModelError(this, 'no records')
    }

    for (const model of this._models) {
      model._setItem(key, value)
    }
  }

  /** Whether a field is reachable right now, the way `key in model` asks in Python. */
  _contains(key: string | number): boolean {
    this._ensureSync()

    if (this._role === 'child' && this._mode === 'one') {
      return this._models?.length ? this._models[0]._contains(key) : false
    }

    if (this._mode === 'one') {
      return (this._record as Record).has(key)
    }

    return this._models?.length ? this._fields.has(key) : false
  }

  /** Walk a double-underscored path that starts at a relation. */
  _path(name: string): any {
    let current: any = this._proxy as Model

    for (const place of overscore.parse(name)) {
      current = current instanceof Model ? current._item(place) : overscore.get(current, [place])
    }

    return current
  }

  /** The proxy wrapping this model, so internals hand back the same object callers hold. */
  _proxy: Model | null = null

  // ------------------------------------------------------------------ building queries

  /** Add criteria. Positional values match fields in order, named ones by `field__operator`. */
  filter(...args: any[]): this {
    const { positional, named } = split(args)

    for (const [field, value] of Object.entries(this._related)) {
      ;(this._record as Record).filter(field, value)
    }

    positional.forEach((value, index) => {
      ;(this._record as Record).filter(index, value)
    })

    for (const [name, value] of Object.entries(named)) {
      if (name === 'like') {
        this._like = value
        continue
      }

      const index = name.indexOf('__')
      const head = index === -1 ? name : name.slice(0, index)
      const rest = index === -1 ? null : name.slice(index + 2)

      if (rest !== null && (head in this.SISTERS || head in this.BROTHERS)) {
        this._tie(head, rest, value)
        continue
      }

      const relation = rest !== null && this._isRelation(head) ? this._relate(head) : null

      if (relation !== null) {
        relation.filter({ [rest as string]: value })
      } else {
        ;(this._record as Record).filter(name, value)
      }
    }

    return this
  }

  /** A model set up to insert many records without reading their ids back. */
  static bulk<M extends Model>(this: ModelClass<M>, size?: number): M {
    return construct(this, {
      action: 'create',
      mode: 'many',
      bulk: true,
      size: size ?? this.chunk ?? 100
    }) as M
  }

  /** A model that will retrieve exactly one record. */
  static one<M extends Model>(this: ModelClass<M>, ...args: any[]): M {
    return construct(this, { action: 'retrieve', mode: 'one', args }) as M
  }

  /** A model that will retrieve any number of records. */
  static many<M extends Model>(this: ModelClass<M>, ...args: any[]): M {
    return construct(this, { action: 'retrieve', mode: 'many', args }) as M
  }

  /** Sort: on a retrieve it's added to the query, otherwise the loaded models are sorted. */
  sort(...args: string[]): this {
    if (this._mode === 'one') {
      throw new ModelError(this, 'cannot sort one')
    }

    if (!args.length) {
      return this
    }

    const sorting = this._ordering(args)

    if (this._action === 'retrieve') {
      this._sort = this._sort ?? []
      this._sort.push(...sorting)
    } else {
      const models = [...(this._models ?? [])]

      models.sort((first, second) => {
        for (const sort of sorting) {
          const field = sort.slice(1)
          const cmp = order(first._item(field), second._item(field))
          if (cmp !== 0) {
            return sort[0] === '+' ? cmp : -cmp
          }
        }
        return 0
      })

      this._models = models
    }

    return this
  }

  /** How many records to retrieve, and where to start. */
  limit(limit?: number | { limit?: number; start?: number; page?: number; perPage?: number }): this {
    if (this._action !== 'retrieve') {
      throw new ModelError(this, 'can only limit retrieve')
    }

    const options = typeof limit === 'object' && limit !== null ? limit : { limit }
    const size = options.perPage ?? options.limit ?? this.CHUNK

    this._limit = size
    this._offset = options.page !== undefined ? (options.page - 1) * size : options.start ?? 0

    return this
  }

  /** Set values on the loaded record, or stage a mass update across many. */
  set(...args: any[]): this {
    const { positional, named } = split(args)

    if (this._action === 'retrieve') {
      if (this._mode === 'one') {
        throw new ModelError(this, 'not retrieved yet - await model.retrieve() before setting values')
      }
      ;(this._record as Record)._action = 'update'
    }

    for (const model of this._each()) {
      this._input(model._record as Record, positional, named)
    }

    return this
  }

  /**
   * Add a record. In many mode you can add as many as you like.
   *
   * On a relation that hasn't been read yet, adding starts a fresh set to create rather
   * than quietly going to the source - `await model.relation.retrieve()` first when you
   * want the existing records loaded alongside the new ones.
   */
  add(...args: any[]): this {
    if (this._action === 'retrieve') {
      if (this._role !== 'child') {
        throw new ModelError(this, 'not retrieved yet - await model.retrieve() before adding')
      }

      this._action = 'create'
      this._record = null
      this._models = this._models ?? []
    }

    const { positional, named } = split(args)
    const count = named._count ?? 1

    delete named._count

    if (this._role === 'child' && this._mode === 'one') {
      if (this._models?.length || count > 1) {
        throw new ModelError(this, 'only one allowed')
      }

      this._models = [
        construct(this.constructor as unknown as ModelClass, {
          action: 'create',
          related: this._related,
          args: [...positional, named]
        })
      ]
    } else if (this._mode === 'one') {
      throw new ModelError(this, 'only one allowed')
    } else {
      this._models = this._models ?? []

      for (let each = 0; each < count; each++) {
        this._models.push(
          construct(this.constructor as unknown as ModelClass, {
            action: 'create',
            related: this._related,
            args: [...positional, named]
          })
        )
      }
    }

    return this
  }

  /** Add a record, flushing to the source when a bulk model fills up. */
  async queue(...args: any[]): Promise<this> {
    this.add(...args)

    if (this._bulk && (this._models as Model[]).length >= this._size) {
      await this.create()
    }

    return this
  }

  // ------------------------------------------------------------------ values

  /** Number of records in many mode, or fields in one mode. */
  get size(): number {
    if (this._role === 'child' && this._mode === 'one') {
      return this._models?.length ? this._models[0].size : 0
    }

    if (this._mode === 'one') {
      return (this._record as Record).size
    }

    return this._models?.length ?? 0
  }

  /** The loaded models, in many mode. */
  get models(): Model[] {
    return this._models ?? []
  }

  /** Models in many mode, field names in one mode. */
  *[Symbol.iterator](): IterableIterator<any> {
    this._ensureSync()

    if (this._role === 'child' && this._mode === 'one') {
      yield* this._models?.length ? this._models[0] : []
      return
    }

    if (this._mode === 'one') {
      yield* this._record as Record
      return
    }

    yield* this._models ?? []
  }

  /** Field names of the loaded record. */
  keys(): string[] {
    this._ensureSync()

    if (this._mode === 'many') {
      throw new ModelError(this, 'no keys with many')
    }

    if (this._role === 'child') {
      return this._models?.length ? this._models[0].keys() : []
    }

    return (this._record as Record).keys()
  }

  /** Every value, keyed by field name - or an array of those in many mode. */
  export(): any {
    this._ensureSync()

    if (this._record) {
      return this._record.export()
    }

    if (this._models) {
      return this._models.map((model) => model.export())
    }

    return []
  }

  /** So `JSON.stringify(model)` does what you'd hope. */
  toJSON(): any {
    return this.export()
  }

  // ------------------------------------------------------------------ the source

  /** The definition of this model, for schemas and migrations. */
  static define(...args: any[]): any {
    const cls = this as unknown as ModelClass
    return need(cls.source, cls).define(cls.thy().define(), ...args)
  }

  /** Write this model's records to the source. */
  async create(...args: any[]): Promise<this> {
    if (!['create', 'update'].includes(this._action)) {
      throw new ModelError(this, `cannot create during ${this._action}`)
    }

    await need(this.SOURCE, this).create(this._proxy as Model, ...args)

    return this
  }

  /** How many records match. */
  async count(...args: any[]): Promise<number> {
    if (!['update', 'retrieve'].includes(this._action)) {
      throw new ModelError(this, `cannot count during ${this._action}`)
    }

    return need(this.SOURCE, this).count(this._proxy as Model, ...args)
  }

  /**
   * Read this model's records out of the source. Pass `false` to get `null` instead of
   * an error when a one-mode retrieve finds nothing.
   */
  async retrieve(verify = true, ...args: any[]): Promise<this | null> {
    if (this._action !== 'retrieve') {
      throw new ModelError(this, `cannot retrieve during ${this._action}`)
    }

    const retrieved = await need(this.SOURCE, this).retrieve(this._proxy as Model, verify, ...args)

    return retrieved === null ? null : this
  }

  /** Titles for the matching records, keyed by id. */
  async titles(...args: any[]): Promise<any> {
    if (!['update', 'retrieve'].includes(this._action)) {
      throw new ModelError(this, `cannot titles during ${this._action}`)
    }

    return need(this.SOURCE, this).titles(this._proxy as Model, ...args)
  }

  /** Write changes back to the source. Resolves to how many records changed. */
  async update(...args: any[]): Promise<number> {
    if (!['update', 'retrieve'].includes(this._action)) {
      throw new ModelError(this, `cannot update during ${this._action}`)
    }

    return need(this.SOURCE, this).update(this._proxy as Model, ...args)
  }

  /** Remove records from the source. Resolves to how many were removed. */
  async delete(...args: any[]): Promise<number> {
    if (!['update', 'retrieve'].includes(this._action)) {
      throw new ModelError(this, `cannot delete during ${this._action}`)
    }

    if (this._action === 'retrieve' && this._mode === 'one') {
      await this.retrieve()
    }

    return need(this.SOURCE, this).delete(this._proxy as Model, ...args)
  }

  /** The query a source would run for an action, without running it. */
  query(action?: 'create' | 'retrieve' | 'count' | 'titles' | 'update' | 'delete', ...args: any[]): any {
    const source = need(this.SOURCE, this)
    const model = this._proxy as Model

    if (this._action === 'create') {
      return source.createQuery(model, ...args)?.bind(model)
    }

    if (this._action === 'retrieve' && action === 'count') {
      return source.countQuery(model, ...args)?.bind(model)
    }

    if (this._action === 'retrieve' && action === 'titles') {
      return source.titlesQuery(model, ...args)?.bind(model)
    }

    if (action === 'update' || (action === undefined && this._action === 'update')) {
      return source.updateQuery(model, ...args)?.bind(model)
    }

    if (action === 'delete') {
      return source.deleteQuery(model, ...args)?.bind(model)
    }

    return source.retrieveQuery(model, ...args)?.bind(model)
  }
}

/** The source a model needs, or a clear error about why it isn't there. */
function need(name: string | null | undefined, model: any): any {
  const found = registered(name)

  if (found === undefined) {
    throw new ModelError(model, `no source registered as '${name}' - construct one before using this model`)
  }

  return found
}

/** Build a model the way relations does internally, bypassing the public constructor. */
export function construct<M extends Model>(cls: ModelClass<M>, internal: Internals): M {
  return new cls(INTERNAL, internal)
}

/**
 * Wrap a model so field names and relation attributes work as ordinary properties.
 * `unit.name`, `unit.name = 'x'`, `unit.test[0].name`, `units[2]` all land here.
 */
function wrap(model: Model): Model {
  const proxy: Model = new Proxy(model, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver)
      }

      const name = prop as string

      if (/^-?\d+$/.test(name) && target._mode === 'many') {
        return target._item(parseInt(name, 10))
      }

      if (name.startsWith('_') || name !== name.toLowerCase() || Reflect.has(target, prop)) {
        return Reflect.get(target, prop, receiver)
      }

      if (target._isRelation(name)) {
        target._ensureSync()
        if (target._mode !== 'one') {
          throw new ModelError(target, `cannot access '${name}' in many mode`)
        }
        return target._relate(name)
      }

      if (target._fields.has(name.split('__')[0])) {
        return target._item(name)
      }

      if (name.includes('__')) {
        return target._path(name)
      }

      return Reflect.get(target, prop, receiver)
    },

    set(target, prop, value, receiver) {
      if (typeof prop === 'symbol') {
        return Reflect.set(target, prop, value, receiver)
      }

      const name = prop as string

      if (/^-?\d+$/.test(name) && target._mode === 'many') {
        target._setItem(parseInt(name, 10), value)
        return true
      }

      if (
        !name.startsWith('_') &&
        name === name.toLowerCase() &&
        !Reflect.has(target, prop) &&
        target._fields.has(name.split('__')[0])
      ) {
        target._setItem(name, value)
        return true
      }

      return Reflect.set(target, prop, value, receiver)
    },

    has(target, prop) {
      if (typeof prop === 'string' && !prop.startsWith('_') && target._fields.has(prop.split('__')[0])) {
        return target._contains(prop)
      }
      return Reflect.has(target, prop)
    }
  })

  model._proxy = proxy

  return proxy
}
