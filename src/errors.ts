/**
 * Error classes. Each one carries the thing that went wrong, not just a message,
 * so callers can branch on the field or model involved.
 */

/** Something invalid about a field's definition, value, or criteria. */
export class FieldError extends Error {
  field: any

  constructor(field: any, message: string) {
    super(message)
    this.name = 'FieldError'
    this.field = field
  }
}

/** Something invalid about a record - usually an unknown field name. */
export class RecordError extends Error {
  record: any

  constructor(record: any, message: string) {
    super(message)
    this.name = 'RecordError'
    this.record = record
  }
}

/** Something invalid about a model, its identity, or the action being attempted. */
export class ModelError extends Error {
  /** The model the error is about. */
  model: any
  /** The message on its own, without the model name in front. */
  detail: string

  constructor(model: any, message: string) {
    super(`${model?.NAME ?? 'model'}: ${message}`)
    this.name = 'ModelError'
    this.model = model
    this.detail = message
  }
}

/** A unique index was violated. Sources throw this and roll back. */
export class UniqueError extends ModelError {
  constructor(model: any, message: string) {
    super(model, message)
    this.name = 'UniqueError'
  }
}

/** A source can't be registered, usually because its name isn't a dns label. */
export class SourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceError'
  }
}

/** Something went wrong diffing or applying migrations. */
export class MigrationsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationsError'
  }
}
