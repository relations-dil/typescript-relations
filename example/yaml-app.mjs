// Run: node example/yaml-app.mjs   (after `npm run build`)
//
// An app loaded from YAML, with no model code at all. The only dependency here is a
// YAML parser - relations itself has none, and takes plain objects.

import { readFile } from 'node:fs/promises'
import { MockSource, modelsFrom, definitionsOf } from '../dist/index.js'

// A tiny YAML subset parser would go here in real life; use `yaml` or `js-yaml`:
//   import { parse } from 'yaml'
// For a dependency-free demo we inline the same structure the YAML file describes.
const app = JSON.parse(
  JSON.stringify({
    models: {
      unit: {
        source: 'example',
        name: 'unit',
        title: 'Unit',
        id: 'id',
        unique: { name: ['name'] },
        index: {},
        fields: [
          { kind: 'int', name: 'id', store: 'id', auto: true },
          { kind: 'str', name: 'name', store: 'name', none: false }
        ]
      },
      test: {
        source: 'example',
        name: 'test',
        title: 'Test',
        id: 'id',
        unique: { 'unit_id-name': ['unit_id', 'name'] },
        index: {},
        fields: [
          { kind: 'int', name: 'id', store: 'id', auto: true },
          { kind: 'int', name: 'unit_id', store: 'unit_id' },
          { kind: 'str', name: 'name', store: 'name', none: false }
        ]
      }
    },
    relations: [{ kind: 'OneToMany', parent: 'unit', child: 'test' }]
  })
)

new MockSource('example')

const { unit: Unit, test: Test } = modelsFrom(app.models, { relations: app.relations })

const unit = new Unit('yep')
unit.test.add('one').add('two')
await unit.create()

const found = await Unit.one({ name: 'yep' }).retrieve()
console.log('unit:', found.export())

const tests = await Test.many({ unit__name: 'yep' }).retrieve()
console.log('tests:', tests.export())

// And back out to data again.
console.log('definitions:', JSON.stringify(definitionsOf([Unit, Test]), null, 2).slice(0, 200), '...')
