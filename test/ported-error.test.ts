/**
 * Ported from python-relations test/test_relations/test_error.py
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  FieldError,
  MigrationsError,
  ModelError,
  MultipleError,
  NotFoundError,
  RecordError,
  RelationsError,
  SourceError,
  UniqueError
} from '../src/index.js'

describe('RelationsError', () => {
  it('test_hierarchy', () => {
    assert.ok(RelationsError.prototype instanceof Error)

    const errors = [
      FieldError,
      ModelError,
      RecordError,
      MigrationsError,
      SourceError,
      UniqueError,
      NotFoundError,
      MultipleError
    ]

    for (const error of errors) {
      assert.ok(error.prototype instanceof RelationsError, error.name)
    }

    // a unique error is a model error too, so what caught one still does

    for (const error of [UniqueError, NotFoundError, MultipleError]) {
      assert.ok(error.prototype instanceof ModelError, error.name)
    }

    // one catch gets all of them

    const raised = [
      new FieldError('unittest', 'oops'),
      new ModelError('unittest', 'oops'),
      new RecordError('unittest', 'oops'),
      new MigrationsError('oops'),
      new SourceError('oops'),
      new UniqueError('unittest', 'oops'),
      new NotFoundError('unittest', 'oops'),
      new MultipleError('unittest', 'oops')
    ]

    for (const error of raised) {
      assert.throws(() => {
        throw error
      }, RelationsError)
    }
  })
})
