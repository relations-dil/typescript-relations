# relations-dil

**A data interface layer that doesn't care what's underneath it.**

Define your models once. Point them at a source at runtime. The same model description
drives a database in one service and a REST API in the next — because the shape of your
data doesn't change just because you changed where you put it.

A TypeScript port (usable from plain JavaScript) of [python-relations](https://github.com/relations-dil/python-relations).

```bash
npm install @relations-dil/relations
```

---

## Contents

- [The idea](#the-idea)
- [Quick start](#quick-start)
- [Async: what changed from Python, and why](#async-what-changed-from-python-and-why)
- [TypeScript](#typescript)
- [Fields](#fields)
- [Querying](#querying)
- [Relations](#relations)
- [Titles](#titles)
- [Migrations](#migrations)
- [Models from data (YAML, JSON, anywhere)](#models-from-data-yaml-json-anywhere)
- [Writing your own source](#writing-your-own-source)
- [Reserved names](#reserved-names)
- [Differences from python-relations](#differences-from-python-relations)
- [API reference](#api-reference)

---

## The idea

Most ORMs bind a model to a backend. Relations doesn't. A model here is a description of
structure — fields, kinds, indexes, how it relates to other models — and nothing else.
Where that structure lives is decided at runtime by whichever source registered itself
under the model's `source` name.

That matters when you're building a service out of microservices. The service that owns
the data talks to a database. Everything else talks to that service's API. Both use the
*same model file*. You describe your data once, and you stop writing CRUD endpoints and
CRUD clients that say the same thing in three different dialects.

This package is the base layer: the abstract classes, plus a complete in-memory source so
you can run the whole thing today without picking a backend.

---

## Quick start

```ts
import { Model, MockSource, OneToMany, int, str } from '@relations-dil/relations'

// A base to share the source across your models.
class Base extends Model {
  static source = 'example'
}

class Unit extends Base {
  static fields = { id: int, name: str }
}

class Test extends Base {
  static fields = { id: int, unit_id: int, name: str }
}

// Relations are declared outside the models, so a model stays a plain description
// of its own shape.
new OneToMany(Unit, Test)

// This makes "example" an in-memory store. Swap this line to change backends.
new MockSource('example')

// Create a Unit named "yep".
await new Unit('yep').create()

// Retrieve it and read its id.
const yep = await Unit.one({ name: 'yep' }).retrieve()
yep.id // 1

// Create two more. The first non-auto field is filled positionally.
await new Unit([['people'], ['stuff']]).create()

// Retrieve one, change it, save it. update() resolves to the number of records changed.
const stuff = await Unit.one({ name: 'stuff' }).retrieve()
stuff.name = 'things'
await stuff.update() // 1

// Add a child through the relation.
const unit = await Unit.one(2).retrieve()
unit.test.add('moar')
await unit.update()

// Find tests whose parent unit is named "things", with an id above 0.
const tests = await Test.many({ unit__name: 'things', id__gt: 0 }).retrieve()
tests[0].name // 'moar'
```

Field values are ordinary properties. `unit.name`, `unit.name = 'x'`, `units[0].name` all
work — a `Proxy` maps them onto the record underneath.

---

## Async: what changed from Python, and why

Python's relations is synchronous. JavaScript can't be: the runtime is single-threaded, so
anything that talks to a database, a socket, or a file hands back a `Promise` instead of
blocking. That has exactly one consequence for this library, and it's worth understanding
because everything else follows from it.

**Six methods touch the source. They are async. Everything else is not.**

| Async — awaits the source | Sync — builds criteria in memory |
| ------------------------- | -------------------------------- |
| `create()`                | `one()` `many()` `bulk()`        |
| `retrieve()`              | `filter()` `sort()` `limit()`    |
| `count()`                 | `set()` `add()`                  |
| `update()`                | `export()` `query()`             |
| `delete()`                | field get and set                |
| `titles()`                | `define()` `thy()`               |

So you chain synchronously and `await` once, at the end:

```ts
const units = await Unit.many({ name__like: 'thing' }).sort('-name').limit(10).retrieve()
```

**The one thing this costs.** Python does a lazy retrieve on attribute access —
`Unit.one(name="yep").id` quietly runs the query when you touch `.id`. JavaScript cannot:
a property getter is synchronous, and there is no `await` available inside one. So
retrieval is explicit here, at exactly one point:

```ts
// Python
Unit.one(name="yep").id

// JavaScript
const unit = await Unit.one({ name: 'yep' }).retrieve()
unit.id
```

Reading a field off a model that hasn't been retrieved throws a clear error rather than
returning nothing:

```
ModelError: unit: not retrieved yet - await model.retrieve() before reading values
```

The same applies to reaching a parent from a child, which is also a query:

```ts
const test = await Test.one({ name: 'moar' }).retrieve()
const unit = await test.unit.retrieve()
unit.name
```

**Doing things at the same time.** Independent queries should not wait on each other:

```ts
// Sequential — two round trips, one after the other
const a = await Unit.one({ id: 1 }).retrieve()
const b = await Unit.one({ id: 2 }).retrieve()

// Concurrent — both in flight at once
const [a, b] = await Promise.all([
  Unit.one({ id: 1 }).retrieve(),
  Unit.one({ id: 2 }).retrieve()
])
```

**Errors.** `await` throws, so ordinary `try`/`catch` works:

```ts
try {
  await new Unit('yep').create()
} catch (error) {
  if (error instanceof UniqueError) {
    // the source rolled back
  }
}
```

---

## TypeScript

Field access goes through a `Proxy`, which the type system can't see into on its own.
`fields()` closes that gap — declare the fields once and the base class knows their types:

```ts
import { fields, int, str, list } from '@relations-dil/relations'

class Unit extends fields({ id: int, name: str, tags: list }) {
  static source = 'example'
}

const unit = await Unit.one({ name: 'yep' }).retrieve()

unit.name.toUpperCase()  // string — checked
unit.nmae                // error: property does not exist
unit.name = 5            // error: not a string
```

In many mode, every field reads back as an array, and indexing gives you one model:

```ts
const units = await Unit.many().retrieve()

units.name     // string[]
units[0].name  // string
```

Pass a base class as the second argument to share configuration:

```ts
class Base extends Model {
  static source = 'example'
}

class Unit extends fields({ id: int, name: str }, Base) {}
```

Relations are declared separately from the model, so add them with `declare` when you want
them typed. `declare` is erased at compile time and costs nothing at runtime:

```ts
class Unit extends fields({ id: int, name: str }, Base) {
  declare test: Test
}

class Test extends fields({ id: int, unit_id: int, name: str }, Base) {
  declare unit: Unit
}

new OneToMany(Unit, Test)
```

**You don't have to use any of this.** Plain `static fields = { ... }` on a `Model` works
identically at runtime; you just get `any` for field access. The package ships `.d.ts`
files either way, so JavaScript users get autocomplete on the library API.

---

## Fields

Python has `int`, `str` and `dict` as first-class values you can hand to a field.
JavaScript doesn't, so relations exports the same seven names as sentinels:

| Kind    | Holds                 | Notes                                                            |
| ------- | --------------------- | ---------------------------------------------------------------- |
| `bool`  | `true` / `false`      | Casts the strings `"false"`, `"no"`, `"0"`, `""` to `false`       |
| `int`   | whole number          | Truncates toward zero, like Python's `int()`                      |
| `float` | number                |                                                                   |
| `str`   | string                |                                                                   |
| `set`   | `Set`                 | Never null; exports as a sorted array, or in `options` order      |
| `list`  | array                 | Never null; defaults to `[]`                                      |
| `dict`  | plain object          | Never null; defaults to `{}`                                      |

### Declaring them

```ts
class Thing extends Model {
  static source = 'example'
  static fields = {
    id: int,                                  // a kind
    name: str,
    status: ['open', 'closed'],               // options, first is the default
    tags: new Set(['red', 'green', 'blue']),  // a set field with options
    created: () => Date.now(),                // a function is a default factory
    note: { kind: str, none: true, length: 40 }  // the full form
  }
}
```

### Field options

| Option       | What it does                                                                 |
| ------------ | ---------------------------------------------------------------------------- |
| `store`      | Name in the source. Defaults to the field name. `false` means never stored.   |
| `none`       | Whether null is allowed. Inferred when not set.                               |
| `default`    | A value, or a function returning one.                                         |
| `options`    | The complete set of allowed values.                                           |
| `validation` | A regular expression, a pattern string, or a predicate.                       |
| `length`     | Length of the value, for sources that care.                                   |
| `readonly`   | Whether the caller may write it.                                              |
| `auto`       | Whether the source generates it — an auto-increment id, say.                  |
| `refresh`    | Reset to the default on update when untouched. Good for `updated_at`.         |
| `inject`     | Store this value inside another `list` or `dict` field, at a path.            |
| `extract`    | Pull interior values out into their own stored columns, so they can be indexed.|
| `attr`       | How to flatten a class-kind value. Required when `kind` is a class.           |
| `init`       | How to rebuild a class-kind value. Defaults to `attr`.                        |
| `titles`     | Which attributes of a class kind make up its title. Defaults to `attr`.       |

### Class kinds

A field can hold instances of your own class, as long as you say how to flatten it:

```ts
class Point {
  constructor(values) {
    this.x = values.x
    this.y = values.y
  }
}

class Place extends Model {
  static source = 'example'
  static fields = {
    id: int,
    name: str,
    at: { kind: Point, attr: ['x', 'y'] }
  }
}

const place = new Place({ name: 'home', at: { x: 1, y: 2 } })
place.at instanceof Point  // true
// stored as { x: 1, y: 2 }
```

### inject and extract

`inject` writes a field *into* another field, so a handful of loose values can share one
JSON column. `extract` copies a value *out* of a container into its own stored key, so a
backend can index it.

```ts
static fields = {
  id: int,
  meta: { kind: dict, extract: ['owner__name'] },   // stored also as meta__owner__name
  flag: { kind: bool, inject: 'meta__flags__0' }     // stored inside meta
}
```

A relation can do the injecting for you, so a shared model can take on an optional parent
without being edited or getting a column of its own. Name the dict field to store it in:

```ts
new OneToMany(Unum, Entity, { childInject: 'what' })
// adds entity.unum_id, stored at what.relations.unum.id; entity.unum is null when there isn't one
```

The key is named `<model>_<id>`, or `<parent source>_<model>_<id>` when the parent lives in a
different source, which has to be a dns label (letters, digits and hyphens).

---

## Querying

`one()` expects exactly one record and throws if it finds none or several. `many()` takes
whatever it finds. Pass `false` to `retrieve()` to get `null` instead of an error:

```ts
await Unit.one({ name: 'yep' }).retrieve()        // throws if missing
await Unit.one({ name: 'yep' }).retrieve(false)   // null if missing
await Unit.many({ name__like: 'ye' }).retrieve()
await Unit.many().count()
```

### Operators

Criteria are `field__operator`. No operator means `eq`. Prefix any operator with `not_` to
invert it.

| Operator | Meaning                          | Multiple values |
| -------- | -------------------------------- | --------------- |
| `eq`     | equal                            |                 |
| `null`   | is or isn't null                 |                 |
| `gt`     | greater than                     |                 |
| `gte`    | greater than or equal            |                 |
| `lt`     | less than                        |                 |
| `lte`    | less than or equal               |                 |
| `like`   | contains, case-insensitive       |                 |
| `start`  | starts with, case-insensitive    |                 |
| `end`    | ends with, case-insensitive      |                 |
| `in`     | is one of                        | ✓               |
| `has`    | contains all of                  | ✓               |
| `any`    | contains at least one of         | ✓               |
| `all`    | contains exactly these           | ✓               |

```ts
await Unit.many({ id__gt: 3, name__not_like: 'test', status__in: ['open', 'held'] }).retrieve()
```

### Reaching inside containers

The same double-underscore notation reaches into `list` and `dict` fields, and into class
kinds through their `attr` mapping:

```ts
await Thing.many({ meta__owner__name: 'gaf' }).retrieve()
await Thing.many({ tags__0: 'red' }).retrieve()
await Thing.many({ meta__count__gte: 5 }).retrieve()
```

Extra underscores change how a place is read — this is the
[overscore](#overscore) notation, exported separately if you want it:

| Underscores | Following | Meaning              | Example    | Equivalent    |
| ----------- | --------- | -------------------- | ---------- | ------------- |
| 2           | word      | key                  | `a__b`     | `['a']['b']`  |
| 2           | number    | index                | `a__1`     | `['a'][1]`    |
| 3           | number    | negative index       | `a___2`    | `['a'][-2]`   |
| 4           | number    | numeric key          | `a____3`   | `['a']['3']`  |
| 5           | number    | negative numeric key | `a_____4`  | `['a']['-4']` |

### Fuzzy matching

`like` as a criterion name searches every title field at once, following parent relations:

```ts
await Unit.many({ like: 'thing' }).retrieve()
```

### Sorting and limiting

```ts
await Unit.many().sort('-name', '+id').retrieve()
await Unit.many().limit(10).retrieve()
await Unit.many().limit({ page: 3, perPage: 25 }).retrieve()

const page = await Unit.many().limit(10).retrieve()
page.overflow  // true when the limit was reached, so there may be more
```

### Mass updates and deletes

Set values on a `many()` and every matching record gets them:

```ts
await Unit.many({ status: 'open' }).set({ status: 'closed' }).update()  // number changed
await Unit.many({ status: 'closed' }).delete()                          // number removed
```

### Bulk inserts

For loading a lot of records without reading their ids back:

```ts
const bulk = Unit.bulk(1000)

for (const row of rows) {
  await bulk.queue(row.name)  // flushes to the source every 1000
}

await bulk.create()  // whatever's left
```

---

## Relations

Relations are declared outside the models. That's deliberate: a model stays a plain
description of its own shape, so it can be reused in a service that doesn't know the
other side exists.

```ts
new OneToMany(Unit, Test)              // unit.test (many), test.unit (one)
new OneToOne(Test, Case)               // test.case (one), case.test (one)
new ManyToMany(Sister, Brother, Tie)   // sister.brother, brother.sister, through Tie
```

The joining field is found by convention — `unit_id` on the child — and every part of it
can be spelled out instead:

```ts
new OneToMany(Unit, Test, {
  parentChildAttr: 'checks',   // what the parent calls its children
  childParentAttr: 'owner',    // what the child calls its parent
  parentId: 'uuid',            // the field on the parent being pointed at
  childParentRef: 'owner_uuid' // the field on the child doing the pointing
})
```

### Working through them

```ts
// Create children with the parent, in one go.
const unit = new Unit('a')
unit.test.add('one').add('two')
await unit.create()

// Add to an existing parent.
const found = await Unit.one({ name: 'a' }).retrieve()
found.test.add('three')
await found.update()

// Filter by the other side. Relations does the intermediate query for you.
await Test.many({ unit__name: 'a' }).retrieve()   // tests whose unit is named a
await Unit.many({ test__name: 'one' }).retrieve() // units having a test named one
```

> **Note.** `relation.add()` on a relation you haven't read starts a fresh set to create,
> rather than quietly querying the source. When you want the existing records loaded
> alongside the new ones, `await parent.child.retrieve()` first.

### Many to many

Both sides carry a `list` field of the other side's ids, and the tie is a real model, so
it migrates like anything else:

```ts
class Sister extends Base { static fields = { id: int, name: str, brother_id: list } }
class Brother extends Base { static fields = { id: int, name: str, sister_id: list } }

class Tie extends Base {
  static fields = { sister_id: int, brother_id: int }
  static id = null
  static unique = { sister_brother: ['sister_id', 'brother_id'] }
}

new ManyToMany(Sister, Brother, Tie)

await new Brother({ name: 'tom', sister_id: [1, 2] }).create()

await Brother.many({ sister_id__all: [1, 2] }).retrieve()  // tied to both
await Brother.many({ sister_id__any: [2] }).retrieve()     // tied to either
await Sister.many({ brother__name: 'tom' }).retrieve()     // by the sibling's fields
```

---

## Titles

A title is the human-readable label for a record, assembled from its title fields — and,
where a title field points at a parent, from that parent's title too.

```ts
const titles = await Unit.many().titles()

titles.ids      // [1, 2] — in retrieval order
titles.get(1)   // ['yep']
titles.fields   // ['name']
titles.format   // formatting instructions, one per value
```

Which fields make up a title is inferred (the leading `int` and `str` fields), or you can
say so:

```ts
class Item extends Base {
  static fields = { id: int, owner_id: int, name: str }
  static titles = ['owner_id', 'name']  // owner_id resolves through the relation
}
```

---

## Migrations

Definitions are backend-neutral JSON. A source converts them into whatever it needs — DDL
for a database, nothing at all for an API — so one migration history drives every backend
your models are used with.

```ts
import { Migrations, models } from '@relations-dil/relations'
import * as schema from './models.js'

const migrations = new Migrations('ddl')

// Snapshot the models. Writes ddl/definition.json, and a timestamped migration
// alongside the previous snapshot. Resolves to whether anything changed.
await migrations.generate(models(schema))

// Convert into a source's own form, under ddl/<source>/<kind>/
await migrations.convert('example')

// Apply everything not yet applied.
await migrations.apply('example')
```

### Renames

A removed field and an added field can be the same field under a new name, and nothing in
the definitions can tell you which. Python prompts on stdin. This takes a function, so the
same code works in a script, a test, or a CLI you write yourself:

```ts
const migrations = new Migrations('ddl', {
  renamer: (what, added, removed) => {
    // what: "people fields", "models", "unit unique indexes", ...
    // return { <removed name>: <added name> } for each rename
    return removed.includes('nickname') && added.includes('handle')
      ? { nickname: 'handle' }
      : {}
  }
})
```

The default treats nothing as a rename, so unattended runs never block.

---

## Models from data (YAML, JSON, anywhere)

`identity.define()` turns a model class into a plain object. `modelsFrom()` turns it back
into working model classes. The round trip means a set of models can be written as data,
saved, shipped, and loaded somewhere that has never seen the code:

```yaml
# app.yaml
models:
  unit:
    source: example
    name: unit
    id: id
    unique: {name: [name]}
    fields:
      - {kind: int, name: id,   store: id,   auto: true}
      - {kind: str, name: name, store: name, none: false}
  test:
    source: example
    name: test
    id: id
    unique: {name: [name]}
    fields:
      - {kind: int, name: id,      store: id, auto: true}
      - {kind: int, name: unit_id, store: unit_id}
      - {kind: str, name: name,    store: name, none: false}

relations:
  - {kind: OneToMany, parent: unit, child: test}
```

```ts
import { modelsFrom, MockSource } from '@relations-dil/relations'
import { parse } from 'yaml'   // any YAML parser; relations has no opinion and no dependency

const app = parse(await readFile('app.yaml', 'utf8'))

new MockSource('example')

const { unit: Unit, test: Test } = modelsFrom(app.models, { relations: app.relations })

await new Unit('yep').create()
const found = await Unit.one({ name: 'yep' }).retrieve()
```

And back the other way:

```ts
import { definitionsOf } from '@relations-dil/relations'
import { stringify } from 'yaml'

await writeFile('app.yaml', stringify({ models: definitionsOf([Unit, Test]) }))
```

The data your models hold is already plain too — `model.export()` and `JSON.stringify(model)`
give you objects keyed by field name, so an app *and* its data can both be a file you save
and load.

---

## Writing your own source

Subclass `Source`, name it, and models pointing at that name will use it. Registration
happens in the constructor.

```ts
import { Source } from '@relations-dil/relations'

class PostgresSource extends Source {
  static KIND = 'postgresql'

  constructor(name, options) {
    super(name, options)
    this.pool = options.pool
  }

  // Called once per model, to prepare its fields for this backend.
  init(model) {
    super.init(model)
  }

  async create(model) {
    await super.create(model)   // checks bulk/tie constraints

    for (const creating of model._each('create')) {
      const values = creating._record.create({})
      const { rows } = await this.pool.query(/* ... */, Object.values(values))
      if (model._id) creating[model._id] = rows[0][model._id]
      creating._action = 'update'
      creating._record._action = 'update'
    }

    model._action = 'update'
    return model
  }

  async retrieve(model, verify = true) {
    await super.retrieve(model, verify)  // resolves many-to-many criteria
    // ...
  }

  async count(model) { await super.count(model); /* ... */ }
  async update(model) { /* ... */ }
  async delete(model) { /* ... */ }
  async titles(model) { await super.titles(model); /* ... */ }
}

new PostgresSource('example', { pool })
```

The base class does the parts that are the same everywhere: resolving many-to-many
criteria into plain id filters (`Source.collateTies`), reading and writing tie records
(`Source.retrieveTies`, `Source.createTies`, `Source.deleteTies`), and walking records and
fields for definitions and migrations. `MockSource` in `src/mock.ts` is a complete,
readable implementation — about 500 lines — and is the best reference.

---

## Reserved names

A field can't be named the same as something a model already answers to, because both
would be reached as `model.<name>`. If your column really is called one of these, use
`store`:

```ts
static fields = {
  id: int,
  count: { kind: int, store: 'count', name: 'total' }  // ...or just name it something else
}
```

The reserved list is exported as `RESERVED`:

`action`, `add`, `append`, `bulk`, `catch`, `constructor`, `count`, `create`, `define`,
`delete`, `export`, `filter`, `finally`, `insert`, `keys`, `like`, `limit`, `many`,
`match`, `models`, `one`, `overflow`, `prepare`, `query`, `queue`, `read`, `retrieve`,
`satisfy`, `set`, `size`, `sort`, `then`, `thy`, `titles`, `toJSON`, `update`, `write`

Field names also can't contain `__` (that's the path separator) or start with `_`.

---

## Differences from python-relations

The port is verified against the Python test suite — 340 tests, ported assertion by
assertion. Where behaviour differs, it's for a reason:

| | Python | Here | Why |
| --- | --- | --- | --- |
| **Retrieval** | Lazy, on attribute access | Explicit `await …retrieve()` | A JS property getter can't await |
| **CRUD** | Synchronous | `async` | JS I/O is non-blocking, always |
| **Class config** | `SOURCE`, `NAME`, `TITLE`, `ID`… | `static source`, `store`, `title`, `id`… | `static name` collides with `Function.name`; `store` matches the field vocabulary |
| **Source methods** | `create_field`, `has_ties` | `createField`, `hasTies` | camelCase |
| **Migration renames** | Prompts on stdin | A `renamer` function | Works unattended, and in tests |
| **`add()` on an unread relation** | Retrieves first | Starts a fresh set | The retrieve would have to be awaited |
| **`bool` casting** | `bool("false")` is `true` | `"false"`, `"no"`, `"0"`, `""` are `false` | Sane for HTTP params; Python's is a wart |
| **`int` default of `false`** | Allowed (`bool` subclasses `int`) | Rejected | JS has no such relationship |
| **`error.message`** | Bare text; name added by `__str__` | Name included; bare text on `.detail` | `assert.throws` and stack traces read `.message` |
| **Sorting on several keys** | Only the first key was used | All keys, in order | Python bug |
| **`titles` as a field name** | Allowed (typo in the reserved list) | Reserved | It's a real method |

The double-underscore criteria notation, the field options, the relation conventions, the
definition and migration JSON format, and the `overscore` path notation are all identical,
so definitions written by either implementation are readable by the other.

---

## API reference

### Models

| | |
| --- | --- |
| `class X extends Model` | Declare a model. `static source`, `static fields`, and the config statics below. |
| `fields(spec, base?)` | A typed base class. See [TypeScript](#typescript). |
| `X.thy()` | Everything knowable about the model without an instance. |
| `X.define()` | The model's definition, as its source wants it. |
| `X.one(...)` / `X.many(...)` / `X.bulk(size?)` | Start a query. |
| `new X(...)` | Start a create. A trailing plain object is named values; anything before it is positional. An array of arrays or objects creates many. |

Config statics: `source`, `store`, `title`, `id`, `titles`, `list`, `unique`, `index`,
`order`, `chunk`.

Instance: `filter()`, `sort()`, `limit()`, `set()`, `add()`, `queue()`, `export()`,
`toJSON()`, `keys()`, `size`, `models`, `overflow`, `query()`, and the six async methods
`create()`, `retrieve()`, `count()`, `update()`, `delete()`, `titles()`.

### Kinds

`bool`, `int`, `float`, `str`, `set`, `list`, `dict` — plus any class, with `attr`.

### Relations

`OneToMany`, `OneToOne`, `ManyToMany`, and the `Relation` base.

### Sources

`Source` (subclass this), `MockSource` (in-memory, complete), `LocalSource` (the same, kept in the
browser's `localStorage`), `RestSource` (a relations-restx API as the backend), `register()`, `source()`, `unregister()`, `clear()`, `SOURCES`.

#### LocalSource

For pages that need to remember things with no server: it behaves like any other source, but the
data survives a reload.

```ts
import { LocalSource } from '@relations-dil/relations/local'

new LocalSource('example', { key: 'my-app' })
```

It loads once when it's made and saves after every write that succeeds, as plain JSON under `key`
(default `relations:<name>`). Pass `storage` to use something other than `localStorage`. Two tabs
open on the same key don't see each other's changes; whichever saves last wins, and `reset()`
forgets everything. If what's in storage isn't valid JSON it refuses to start, rather than
overwrite it.

#### RestSource

For models whose data lives behind a [relations-restx](https://github.com/relations-dil/python-relations-restx)
API: swap `MockSource` or `LocalSource` for it at runtime and the same models read and write the
remote service. It's a port of python-relations-rest, and it runs in the browser or in Node.

```ts
import { RestSource } from '@relations-dil/relations/rest'

new RestSource('example', { url: 'https://api.example.com' })

const unit = await Unit.one({ name: 'yep' }).retrieve()   // POST https://api.example.com/unit
```

Options:

- `url` (required): where the API lives. `''` is fine for the same origin.
- `fetch`: anything shaped like `fetch`. Defaults to `globalThis.fetch`, so pass one in on older
  Node or to stand in for the network in tests.
- `headers`: sent on every request, e.g. `{ Authorization: 'Bearer ...' }`. Requests have a JSON
  body and `Content-Type: application/json`; a header of your own wins.
- `credentials`: passed through to fetch, e.g. `'include'` to send cookies cross-origin.
- `request`: anything else to hand fetch on every request, like `mode` or `cache`.

A model's `SINGULAR`, `PLURAL` and `ENDPOINT` (defaulting to its name, the name plus `s`, and its
name) say how it's addressed, just as in the Python client. The endpoint is `/<ENDPOINT>`, and by
id `/<ENDPOINT>/<id>`.

Reads are sent as `POST /<endpoint>` with a `{"filter": ...}` body, not GET. Browsers can't send a
body with a GET, and relations-restx treats a POST that carries a `filter` exactly like a GET, so
`filter`, `sort`, `limit` and `count` all work. Creates are `POST {plural: [...]}`, updates by id
are `PATCH /<endpoint>/<id>` with `{singular: {...}}`, mass updates are `PATCH /<endpoint>` with
`{filter, plural: {...}}`, and deletes are `DELETE /<endpoint>` with `{filter}`.

A response of 400 or more throws a `ModelError` carrying the API's `message` (or `API Error`). An
`overflow` in a response is carried onto the model. Sets go over as sorted lists. Like the Python
client, it never asks the API for more than the model's `limit()`, but restx always applies one
itself (the server model's `CHUNK`, 100 unless set), so a retrieve with no `limit()` returns at most
that many and sets `overflow` when it got that many.

### Migrations and data

`Migrations`, `models(module)`, `modelFrom()`, `modelsFrom()`, `definitionsOf()`.

### Errors

`FieldError`, `RecordError`, `ModelError`, `UniqueError`, `MigrationsError`,
`OverscoreError`. All carry the thing that went wrong, not just a message.

### overscore

The double-underscore path notation, usable on its own:

```ts
import * as overscore from '@relations-dil/relations/overscore'

overscore.get(data, 'things__a__b__0____1')
overscore.set(data, 'things__a__b__0____1', 'yep')
overscore.has(data, 'things__a')
overscore.parse('a__0___1')    // ['a', 0, -1]
overscore.compile(['a', 0, -1]) // 'a__0___1'
```

---

## Development

```bash
npm install
npm run build      # compile to dist/
npm test           # compile and run the full suite
npm run typecheck  # types only, no output
```

No runtime dependencies.

## License

MIT
