/**
 * Relations between models.
 *
 * Relations are declared outside the models, not inside them, so a model stays a plain
 * description of its own shape and can be reused in a service that doesn't know about
 * the other side.
 *
 * ```ts
 * new OneToMany(Unit, Test)          // unit.test, test.unit
 * new OneToOne(Unit, Detail)         // unit.detail, detail.unit
 * new ManyToMany(Sister, Brother, Tie)
 * ```
 */

import { ModelError } from './errors.js'
import { Field } from './field.js'
import { dict } from './kinds.js'
import type { ModelClass, ModelIdentity } from './model.js'
import { DNS } from './registry.js'

/** Base for every relation, holding the convention used to find the joining field. */
export class Relation {
  /** Whether the two sides can share an id field name. */
  static SAME: boolean | null = null

  /**
   * Work out which field on `relative` points at `model`, by convention:
   * `<model>_id`, then `<model>_<model id field>`, then the model's own id field name.
   */
  static relativeField(model: ModelIdentity, relative: ModelIdentity, same: boolean | null): string {
    // The standard convention: unit_id on the test.
    const standard = `${model.NAME}_id`

    if (relative._fields.has(standard)) {
      return standard
    }

    // The id field isn't called id: unit_uuid on the test.
    const modelId = model._fieldName(model._id as string)
    const simple = `${model.NAME}_${modelId}`

    if (relative._fields.has(simple)) {
      return simple
    }

    // Both sides use the same name for the field: unit_id on both.
    if (relative._fields.has(modelId) && (same || modelId !== relative._fieldName(relative._id as string))) {
      return modelId
    }

    throw new ModelError(model, `cannot determine field for ${model.NAME} in ${relative.NAME}`)
  }
}

/** What you can spell out about a one-to-* relation instead of letting it be inferred. */
export interface OneToOptions {
  /** Attribute on the parent that reaches the children. Defaults to the child's name. */
  parentChildAttr?: string
  /** Attribute on the child that reaches the parent. Defaults to the parent's name. */
  childParentAttr?: string
  /** Field on the parent the child points at. Defaults to the parent's id. */
  parentId?: string | number
  /** Field on the child that points at the parent. Inferred by convention. */
  childParentRef?: string | number
  /**
   * A dict field on the child to store the parent id in, so the child needs no field of its own
   * for it. The relation adds that field, at `<childInject>__relations__<parent>__<id>`.
   */
  childInject?: string
}

/** One parent record to one or many child records. */
export class OneTo extends Relation {
  /** Whether the child side holds one record or many. */
  static MODE: 'one' | 'many' = 'many'

  /** The model with one record. */
  Parent: ModelClass
  /** Field on the parent the child points at. */
  parentId: string
  /** Attribute on the parent that reaches the children. */
  parentChildAttr: string

  /** The model with the other record or records. */
  Child: ModelClass
  /** Field on the child that points at the parent. */
  childParentRef: string
  /** Attribute on the child that reaches the parent. */
  childParentAttr: string
  /** The dict field in the child the parent id is stored in, if it's not a field of its own. */
  childInject: string | null

  /** Whether the child side holds one record or many. */
  MODE: 'one' | 'many'

  constructor(Parent: ModelClass, Child: ModelClass, options: OneToOptions = {}) {
    super()

    const kind = this.constructor as typeof OneTo

    this.Parent = Parent
    this.Child = Child
    this.MODE = kind.MODE
    this.childInject = options.childInject ?? null

    const parent = Parent.thy()
    let child = Child.thy()

    this.parentId = parent._fieldName(options.parentId ?? (parent._id as string))
    this.parentChildAttr = options.parentChildAttr ?? (child.NAME as string)

    let childParentRef = options.childParentRef

    // If asked, add the child field for the parent id, stored in a dict field of the child.
    if (this.childInject !== null) {
      const stored = child._fields._names.get(this.childInject)

      if (stored === undefined) {
        throw new ModelError(child, `cannot find field ${this.childInject} in ${child.NAME}`)
      }

      if (stored.kind !== dict) {
        throw new ModelError(child, `field ${this.childInject} not a dict in ${child.NAME}`)
      }

      // Same source is just the model name, else prefix the source of the parent (a dns label).
      let named = parent.NAME as string

      if (parent.SOURCE !== child.SOURCE) {
        if (typeof parent.SOURCE !== 'string' || !DNS.test(parent.SOURCE)) {
          throw new ModelError(parent, `source ${parent.SOURCE} is not dns compliant`)
        }
        named = `${parent.SOURCE.toLowerCase().replace(/-/g, '_')}_${parent.NAME}`
      }

      const ref = childParentRef !== undefined ? String(childParentRef) : `${named}_${this.parentId}`

      if (child._fields.has(ref)) {
        throw new ModelError(child, `field ${ref} already exists in ${child.NAME}`)
      }

      const kindOfParent = (parent._fields._names.get(this.parentId) as Field).kind

      Child.fields = {
        ...Child.fields,
        [ref]: new Field(kindOfParent, {
          inject: `${this.childInject}__relations__${named}__${this.parentId}`,
          none: true
        })
      }

      childParentRef = ref
      child = Child.thy()
    }

    this.childParentAttr = options.childParentAttr ?? (parent.NAME as string)
    this.childParentRef =
      childParentRef !== undefined
        ? child._fieldName(childParentRef)
        : Relation.relativeField(parent, child, kind.SAME)

    this.Parent._child(this)
    this.Child._parent(this)
  }
}

/** One parent record to many child records. */
export class OneToMany extends OneTo {
  static MODE = 'many' as const
  static SAME = false
}

/** One parent record to one child record. */
export class OneToOne extends OneTo {
  static MODE = 'one' as const
  static SAME = true
}

/** What you can spell out about a many-to-many relation instead of letting it be inferred. */
export interface ManyToManyOptions {
  /** Attribute on the sister that reaches the brothers. Defaults to the brother's name. */
  sisterBrotherAttr?: string
  /** Attribute on the brother that reaches the sisters. Defaults to the sister's name. */
  brotherSisterAttr?: string
  /** Field on the sister listing brother ids. Inferred by convention. */
  sisterBrotherRef?: string | number
  /** Field on the brother listing sister ids. Inferred by convention. */
  brotherSisterRef?: string | number
  /** Field on the sister the tie points at. Defaults to the sister's id. */
  sisterId?: string | number
  /** Field on the brother the tie points at. Defaults to the brother's id. */
  brotherId?: string | number
  /** Field on the tie pointing at the sister. Inferred by convention. */
  tieSisterRef?: string | number
  /** Field on the tie pointing at the brother. Inferred by convention. */
  tieBrotherRef?: string | number
}

/**
 * Many records on each side, joined through a tie model. The tie is a real model, so it
 * lives in the same source and migrates like anything else.
 */
export class ManyToMany extends Relation {
  /** The model with fewer records, by convention. */
  Sister: ModelClass
  /** Field on the sister the tie points at. */
  sisterId: string
  /** Field on the sister listing brother ids. */
  sisterBrotherRef: string
  /** Attribute on the sister that reaches the brothers. */
  sisterBrotherAttr: string

  /** The model with more records, by convention. */
  Brother: ModelClass
  /** Field on the brother the tie points at. */
  brotherId: string
  /** Field on the brother listing sister ids. */
  brotherSisterRef: string
  /** Attribute on the brother that reaches the sisters. */
  brotherSisterAttr: string

  /** The joining model. */
  Tie: ModelClass
  /** Field on the tie pointing at the sister. */
  tieSisterRef: string
  /** Field on the tie pointing at the brother. */
  tieBrotherRef: string

  constructor(Sister: ModelClass, Brother: ModelClass, Tie: ModelClass, options: ManyToManyOptions = {}) {
    super()

    this.Sister = Sister
    this.Brother = Brother
    this.Tie = Tie

    if (Tie.TIE === undefined || Tie.TIE === null) {
      Tie.TIE = true
    }

    const sister = Sister.thy()
    const brother = Brother.thy()
    const tie = Tie.thy()

    this.sisterId = sister._fieldName(options.sisterId ?? (sister._id as string))
    this.sisterBrotherRef =
      options.sisterBrotherRef !== undefined
        ? sister._fieldName(options.sisterBrotherRef)
        : Relation.relativeField(brother, sister, null)
    this.sisterBrotherAttr = options.sisterBrotherAttr ?? (brother.NAME as string)

    this.brotherId = brother._fieldName(options.brotherId ?? (brother._id as string))
    this.brotherSisterRef =
      options.brotherSisterRef !== undefined
        ? brother._fieldName(options.brotherSisterRef)
        : Relation.relativeField(sister, brother, null)
    this.brotherSisterAttr = options.brotherSisterAttr ?? (sister.NAME as string)

    this.tieSisterRef = tie._fieldName(
      options.tieSisterRef ?? Relation.relativeField(sister, tie, null)
    )
    this.tieBrotherRef = tie._fieldName(
      options.tieBrotherRef ?? Relation.relativeField(brother, tie, null)
    )

    this.Sister._brother(this)
    this.Brother._sister(this)
  }
}
