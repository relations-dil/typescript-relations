// The models. This is the part that would be shared with the service that owns the data:
// described once, with no idea where they're stored.

const { Model, MockSource, OneToMany, int, str } = Relations

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

// Where they're stored is decided here, at runtime. Swap this line to change backends.
new MockSource('example')

// Something to look at on first load.
const seeded = (async () => {
  await new Unit([['people'], ['stuff']]).create()
  await new Test({ unit_id: 2, name: 'moar' }).create()
})()

// Exposed so you can play with them from the console.
Object.assign(window, { Relations, Unit, Test })
