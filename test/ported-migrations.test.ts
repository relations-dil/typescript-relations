/**
 * Port of test/test_relations/test_migrations.py to node:test.
 *
 * Translation notes:
 *
 * - Python decides renames by prompting on stdin (`input()`), which the tests patch with
 *   `unittest.mock.patch("builtins.input", ...)`. The TS port takes a `Renamer` function
 *   instead: `(name, adds, removes) => { removed: added }`. Every test that patched
 *   `input` passes an explicit renamer here, and the answers below are what the patched
 *   inputs would have produced. The `calls` recorder stands in for the `mock_print` /
 *   `mock_input` call assertions.
 * - The static diff helpers take the renamer as their first argument
 *   (`Migrations.fields(renamer, model, current, define)`), and instance methods are
 *   async.
 * - `generate` takes an explicit stamp, which replaces freezegun.
 * - Python ran everything in a relative "ddl" directory; this uses a temp directory.
 * - Python's `test_define` expects `"auto": true` on the id, which only happens once a
 *   source has been registered (MockSource.init sets it). Python got that by test-order
 *   accident; here the source is registered in beforeEach.
 */

import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  Migrations,
  MigrationsError,
  MockSource,
  Model,
  clear,
  fields,
  int,
  str,
  type Renamer
} from '../src/index.js'

class People extends fields({ id: int, name: str, gender: ['free', 'male', 'female'] }, Model) {
  static source = 'MigrationsSource'
}

/** What a renamer was asked, standing in for Python's mock_input/mock_print assertions. */
interface Asked {
  name: string
  adds: string[]
  removes: string[]
}

/** A renamer that answers per prompt name, recording what it was asked. */
function renamer(
  answers: globalThis.Record<string, globalThis.Record<string, string>>,
  asked: Asked[]
): Renamer {
  return (name, adds, removes) => {
    asked.push({ name, adds, removes })
    return answers[name] ?? {}
  }
}

const PEOPLE = {
  source: 'MigrationsSource',
  name: 'people',
  title: 'People',
  fields: [
    {
      name: 'id',
      kind: 'int',
      store: 'id',
      none: true,
      auto: true
    },
    {
      name: 'name',
      kind: 'str',
      store: 'name',
      none: false
    },
    {
      name: 'gender',
      kind: 'str',
      store: 'gender',
      options: ['free', 'male', 'female'],
      default: 'free',
      none: false
    }
  ],
  id: 'id',
  unique: {
    name: ['name']
  },
  index: {}
}

describe('Migrations (ported)', () => {
  let root: string
  let ddl: string
  let source: MockSource

  beforeEach(async () => {
    clear()
    root = await mkdtemp(join(tmpdir(), 'relations-migrations-'))
    ddl = join(root, 'ddl')
    await mkdir(ddl, { recursive: true })
    source = new MockSource('MigrationsSource')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('takes a directory', () => {
    let migrations = new Migrations()
    assert.equal(migrations.directory, 'ddl')

    migrations = new Migrations('dll')
    assert.equal(migrations.directory, 'dll')
  })

  it('reads the current definition', async () => {
    const migrations = new Migrations(ddl)

    assert.deepEqual(await migrations.current(), {})

    await writeFile(join(ddl, 'definition.json'), JSON.stringify({ a: 1 }))

    assert.deepEqual(await migrations.current(), { a: 1 })
  })

  it('defines models', () => {
    assert.deepEqual(Migrations.define([People as any]), { people: PEOPLE })
  })

  it('works out renames', () => {
    const asked: Asked[] = []

    // Nothing added or removed: the renamer is never asked (Python never prompts).
    assert.deepEqual(Migrations.rename(renamer({}, asked), 'unit', [], []), {})
    assert.deepEqual(asked, [])

    const removes = ['people', 'stuff']
    const adds = ['things']

    const renames = Migrations.rename(
      renamer({ test: { people: 'things' } }, asked),
      'test',
      adds,
      removes
    )

    assert.deepEqual(removes, ['stuff'])
    assert.deepEqual(adds, [])
    assert.deepEqual(renames, { people: 'things' })

    assert.deepEqual(asked, [{ name: 'test', adds: ['things'], removes: ['people', 'stuff'] }])
  })

  it('looks up a field', () => {
    const found = [
      {
        name: 'id',
        kind: 'int',
        store: 'id',
        none: true
      },
      {
        name: 'name',
        kind: 'str',
        store: 'name',
        none: false
      },
      {
        name: 'gender',
        kind: 'str',
        store: 'gender',
        options: ['free', 'male', 'female'],
        default: 'free',
        none: false
      }
    ]

    assert.deepEqual(Migrations.lookup('gender', found), {
      name: 'gender',
      kind: 'str',
      store: 'gender',
      options: ['free', 'male', 'female'],
      default: 'free',
      none: false
    })

    assert.equal(Migrations.lookup('nope', found), null)
  })

  it('diffs a field', () => {
    const current = {
      name: 'gender',
      kind: 'str',
      store: 'genders',
      options: ['male', 'female'],
      default: 'free',
      none: false
    }

    const define = {
      name: 'gender',
      kind: 'str',
      store: 'gender',
      options: ['free', 'male', 'female'],
      default: 'free',
      none: false
    }

    assert.deepEqual(Migrations.field(current, define), {
      store: 'gender',
      options: ['free', 'male', 'female']
    })
  })

  it('diffs fields', () => {
    const asked: Asked[] = []

    // Python answered '' for id (no rename) then '2' for genders, picking gender.
    const rename = renamer({ 'test fields': { genders: 'gender' } }, asked)

    const current = [
      {
        name: 'id',
        kind: 'int',
        store: 'id',
        none: true
      },
      {
        name: 'genders',
        kind: 'str',
        store: 'genders',
        options: ['male', 'female'],
        default: 'free',
        none: false
      }
    ]

    const define = [
      {
        name: 'name',
        kind: 'str',
        store: 'name',
        none: false
      },
      {
        name: 'gender',
        kind: 'str',
        store: 'gender',
        options: ['free', 'male', 'female'],
        default: 'free',
        none: false
      }
    ]

    assert.deepEqual(Migrations.fields(rename, 'test', current, define), {
      add: [
        {
          name: 'name',
          kind: 'str',
          store: 'name',
          none: false
        }
      ],
      remove: ['id'],
      change: {
        genders: {
          name: 'gender',
          store: 'gender',
          options: ['free', 'male', 'female']
        }
      }
    })

    assert.deepEqual(asked, [
      { name: 'test fields', adds: ['name', 'gender'], removes: ['id', 'genders'] }
    ])
  })

  it('diffs indexes', () => {
    const asked: Asked[] = []

    // Python answered '2' for people (things) then '' for stuff.
    const rename = renamer({ 'test indexes': { people: 'things' } }, asked)

    const current = {
      people: [1],
      stuff: [2]
    }

    const define = {
      things: [1],
      moar: [2]
    }

    assert.deepEqual(Migrations.indexes(rename, 'test', 'indexes', current as any, define as any), {
      add: {
        moar: [2]
      },
      remove: ['stuff'],
      rename: {
        people: 'things'
      }
    })

    assert.deepEqual(asked, [
      { name: 'test indexes', adds: ['moar', 'things'], removes: ['people', 'stuff'] }
    ])
  })

  it('refuses a rename that changes the fields', () => {
    const rename = renamer({ 'test indexes': { people: 'things' } }, [])

    assert.throws(
      () =>
        Migrations.indexes(rename, 'test', 'indexes', { people: [1] } as any, { things: [2] } as any),
      (error: unknown) => {
        assert.ok(error instanceof MigrationsError, `expected MigrationsError, got ${String(error)}`)
        assert.match(
          (error as Error).message,
          /test indexes people and things must have same fields to rename/
        )
        return true
      }
    )
  })

  it('diffs a model', () => {
    const asked: Asked[] = []

    // Python answered '', '2' (fields), '', '1' (unique), '2', '' (indexes).
    const rename = renamer(
      {
        'people/persons fields': { genders: 'gender' },
        'people/persons unique indexes': { stuff: 'moar' },
        'people/persons indexes': { people: 'things' }
      },
      asked
    )

    const current = {
      name: 'people',
      title: 'People',
      id: 'id',
      fields: [
        {
          name: 'id',
          kind: 'int',
          store: 'id',
          none: true
        },
        {
          name: 'genders',
          kind: 'str',
          store: 'genders',
          options: ['male', 'female'],
          default: 'free',
          none: false
        }
      ],
      unique: {
        people: [1],
        stuff: [2]
      },
      index: {
        people: [3],
        stuff: [4]
      }
    }

    const define = {
      name: 'persons',
      title: 'Persons',
      id: 'idd',
      extra: 'info',
      fields: [
        {
          name: 'name',
          kind: 'str',
          store: 'name',
          none: false
        },
        {
          name: 'gender',
          kind: 'str',
          store: 'gender',
          options: ['free', 'male', 'female'],
          default: 'free',
          none: false
        }
      ],
      unique: {
        things: [1],
        moar: [2]
      },
      index: {
        things: [3],
        moar: [4]
      }
    }

    assert.deepEqual(Migrations.model(current, define, rename), {
      name: 'persons',
      title: 'Persons',
      id: 'idd',
      extra: 'info',
      fields: {
        add: [
          {
            name: 'name',
            kind: 'str',
            store: 'name',
            none: false
          }
        ],
        remove: ['id'],
        change: {
          genders: {
            name: 'gender',
            store: 'gender',
            options: ['free', 'male', 'female']
          }
        }
      },
      unique: {
        add: {
          things: [1]
        },
        remove: ['people'],
        rename: {
          stuff: 'moar'
        }
      },
      index: {
        add: {
          moar: [4]
        },
        remove: ['stuff'],
        rename: {
          people: 'things'
        }
      }
    })

    assert.deepEqual(asked, [
      { name: 'people/persons fields', adds: ['name', 'gender'], removes: ['id', 'genders'] },
      {
        name: 'people/persons unique indexes',
        adds: ['moar', 'things'],
        removes: ['people', 'stuff']
      },
      { name: 'people/persons indexes', adds: ['moar', 'things'], removes: ['people', 'stuff'] }
    ])
  })

  it('diffs models', () => {
    const asked: Asked[] = []

    // Python answered '1' for people (persons) then '' for stuff.
    const rename = renamer({ models: { people: 'persons' } }, asked)

    const current = {
      people: {
        name: 'people',
        title: 'People',
        id: 'id',
        fields: [],
        unique: {},
        index: {}
      },
      stuff: {
        name: 'stuff',
        title: 'Stuff',
        id: 'id',
        fields: [],
        unique: {},
        index: {}
      }
    }

    const define = {
      persons: {
        name: 'persons',
        title: 'Persons',
        id: 'idd',
        fields: [],
        unique: {},
        index: {}
      },
      things: {
        name: 'things',
        title: 'Things',
        id: 'id',
        fields: [],
        unique: {},
        index: {}
      }
    }

    assert.deepEqual(Migrations.models(current, define, rename), {
      add: {
        things: {
          name: 'things',
          title: 'Things',
          id: 'id',
          fields: [],
          unique: {},
          index: {}
        }
      },
      remove: {
        stuff: {
          name: 'stuff',
          title: 'Stuff',
          id: 'id',
          fields: [],
          unique: {},
          index: {}
        }
      },
      change: {
        people: {
          definition: {
            name: 'people',
            title: 'People',
            id: 'id',
            fields: [],
            unique: {},
            index: {}
          },
          migration: {
            name: 'persons',
            title: 'Persons',
            id: 'idd'
          }
        }
      }
    })

    assert.deepEqual(asked, [
      { name: 'models', adds: ['persons', 'things'], removes: ['people', 'stuff'] }
    ])
  })

  it('generates definitions and migrations', async () => {
    const stamp = '2021-07-08-11-12-13-000000'
    const migrations = new Migrations(ddl)

    assert.equal(await migrations.generate([People as any], stamp), true)

    const current = JSON.parse(await readFile(join(ddl, 'definition.json'), 'utf8'))

    assert.deepEqual(current, { people: PEOPLE })

    assert.equal(await migrations.generate([People as any], stamp), false)

    current.people.fields[2].store = 'genders'

    await writeFile(join(ddl, 'definition.json'), JSON.stringify(current))

    assert.equal(await migrations.generate([People as any], stamp), true)

    const previous = {
      ...PEOPLE,
      fields: [
        PEOPLE.fields[0],
        PEOPLE.fields[1],
        { ...PEOPLE.fields[2], store: 'genders' }
      ]
    }

    assert.deepEqual(JSON.parse(await readFile(join(ddl, `definition-${stamp}.json`), 'utf8')), {
      people: previous
    })

    assert.deepEqual(JSON.parse(await readFile(join(ddl, `migration-${stamp}.json`), 'utf8')), {
      change: {
        people: {
          definition: previous,
          migration: {
            fields: {
              change: {
                gender: {
                  store: 'gender'
                }
              }
            }
          }
        }
      }
    })

    assert.deepEqual(JSON.parse(await readFile(join(ddl, 'definition.json'), 'utf8')), {
      people: PEOPLE
    })
  })

  it('converts definitions and migrations for a source', async () => {
    await writeFile(
      join(ddl, 'definition.json'),
      JSON.stringify({ people: (People as any).thy().define() })
    )

    await writeFile(
      join(ddl, 'migration-1234.json'),
      JSON.stringify({
        change: {
          migs: {
            definition: {
              source: 'MigrationsSource',
              name: 'migs',
              fields: [
                {
                  name: 'fie',
                  store: 'fie',
                  kind: 'int'
                },
                {
                  name: 'foe',
                  store: 'foe',
                  kind: 'int'
                }
              ]
            },
            migration: {
              source: 'MigrationsSource',
              name: 'mig',
              fields: {
                add: [
                  {
                    name: 'fee',
                    store: 'fee',
                    kind: 'int'
                  }
                ],
                remove: ['fie'],
                change: {
                  foe: {
                    name: 'fum',
                    kind: 'float'
                  }
                }
              }
            }
          }
        }
      })
    )

    const migrations = new Migrations(ddl)

    await migrations.convert('MigrationsSource')

    assert.deepEqual(
      JSON.parse(
        await readFile(join(ddl, 'MigrationsSource', 'mock', 'definition.json'), 'utf8')
      ),
      [{ ACTION: 'add', ...PEOPLE }]
    )

    assert.deepEqual(
      JSON.parse(
        await readFile(join(ddl, 'MigrationsSource', 'mock', 'migration-1234.json'), 'utf8')
      ),
      [
        {
          ACTION: 'change',
          DEFINITION: {
            source: 'MigrationsSource',
            name: 'migs',
            fields: [
              {
                name: 'fie',
                store: 'fie',
                kind: 'int'
              },
              {
                name: 'foe',
                store: 'foe',
                kind: 'int'
              }
            ]
          },
          MIGRATION: {
            source: 'MigrationsSource',
            name: 'mig',
            fields: [
              {
                ACTION: 'add',
                name: 'fee',
                store: 'fee',
                kind: 'int'
              },
              {
                ACTION: 'remove',
                name: 'fie',
                store: 'fie',
                kind: 'int'
              },
              {
                ACTION: 'change',
                DEFINITION: {
                  name: 'foe',
                  store: 'foe',
                  kind: 'int'
                },
                MIGRATION: {
                  name: 'fum',
                  kind: 'float'
                }
              }
            ]
          }
        }
      ]
    )
  })

  it('lists the migration pairs for a source', async () => {
    const path = join(ddl, source.name, String(source.KIND))

    await mkdir(path, { recursive: true })

    for (const file of [
      'definition.json',
      'definition-2012-07-07.json',
      'migration-2012-07-07.json',
      'definition-2012-07-08.json',
      'migration-2012-07-08.json'
    ]) {
      await writeFile(join(path, file), '')
    }

    const migrations = new Migrations(ddl)

    assert.deepEqual(await migrations.list('MigrationsSource'), {
      '2012-07-07': {
        definition: 'definition-2012-07-07.json',
        migration: 'migration-2012-07-07.json'
      },
      '2012-07-08': {
        definition: 'definition-2012-07-08.json',
        migration: 'migration-2012-07-08.json'
      }
    })
  })

  it('loads a converted file into a source', async () => {
    source.ids = {}
    source.data = {}

    const definition = [
      {
        ACTION: 'add',
        source: 'MigrationsSource',
        name: 'people',
        title: 'People',
        fields: [
          {
            name: 'id',
            kind: 'int',
            store: 'id',
            none: true,
            auto: true
          },
          {
            name: 'name',
            kind: 'str',
            store: 'name',
            none: false
          }
        ],
        id: 'id',
        unique: {
          name: ['name']
        },
        index: {}
      }
    ]

    const path = join(ddl, 'MigrationsSource', 'mock')

    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'definition.json'), JSON.stringify(definition))

    const migrations = new Migrations(ddl)

    await migrations.load('MigrationsSource', 'definition.json')

    assert.deepEqual(source.ids, { people: 0 })
    assert.deepEqual(source.data, { people: new Map() })
  })

  it('applies a source', async () => {
    source.ids = {}
    source.data = {}
    source.migrations = []

    const definition = [
      {
        ACTION: 'add',
        source: 'MigrationsSource',
        name: 'people',
        title: 'People',
        fields: [
          {
            name: 'id',
            kind: 'int',
            store: 'id',
            none: true,
            auto: true
          },
          {
            name: 'name',
            kind: 'str',
            store: 'name',
            none: false
          }
        ],
        id: 'id',
        unique: {
          name: ['name']
        },
        index: {}
      }
    ]

    const path = join(ddl, 'MigrationsSource', 'mock')

    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'definition.json'), JSON.stringify(definition))
    await writeFile(
      join(path, 'migration-2021-07-07-11-12-13-000000.json'),
      JSON.stringify(definition)
    )

    const migrations = new Migrations(ddl)

    assert.equal(await migrations.apply('MigrationsSource'), true)

    assert.deepEqual(source.ids, { people: 0 })
    assert.deepEqual(source.data, { people: new Map() })
    assert.deepEqual(source.migrations, ['2021-07-07-11-12-13-000000'])

    assert.equal(await migrations.apply('MigrationsSource'), false)
  })
})
