// The example app's models: described once, with no idea where they're stored. Where the data
// lives is app.js's business, and the source is named for the app (static source below).
//
// A models file registers a function that gets the Relations library and returns the app's
// models by name. The function gives each app its own scope, so two apps can both have a Unit.

Models.add('example', ({ Model, OneToMany, int, str }) => {

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

  return { unit: Unit, test: Test }

})
