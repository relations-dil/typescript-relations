// The models. This is the part that would be shared with the service that owns the data:
// described once, with no idea where they're stored.

const { Model, MockSource, LocalSource, OneToMany, int, str } = Relations

class Base extends Model {
  static source = 'example'
}

class Unit extends Base {
  static fields = { id: int, name: str }
}

class Test extends Base {
  static fields = { id: int, unit_id: int, name: str }
}

new OneToMany(Unit, Test)

// Where they're stored is decided here, at runtime. In memory by default, gone on reload; a page
// that sets STORAGE_KEY first keeps them in localStorage under that key instead.
if (typeof STORAGE_KEY === 'string') {
  new LocalSource('example', { key: STORAGE_KEY })
} else {
  new MockSource('example')
}

// Something to look at the first time, and only the first time.
const seeded = (async () => {
  if (await Unit.many().count()) {
    return
  }
  await new Unit([['people'], ['stuff']]).create()
  await new Test({ unit_id: 2, name: 'moar' }).create()
})()

// Exposed so you can play with them from the console.
Object.assign(window, { Relations, Unit, Test })
