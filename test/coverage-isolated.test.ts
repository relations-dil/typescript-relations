/**
 * `MigrationsRef` starts out as a stub that migrations.ts replaces when it's imported, so
 * its failure mode can only be seen in a process that loads the model module alone. The
 * test runner gives every file its own process, which is what makes that possible.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { MigrationsRef } from '../src/model.js'

describe('MigrationsRef before migrations are loaded', () => {
  it('says so plainly', () => {
    assert.throws(() => MigrationsRef.model({}, {}), /migrations not loaded/)
  })
})
