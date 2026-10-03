/**
 * Double underscore access notation.
 *
 * Port of the Python `overscore` library. Lets you retrieve (and store) values in
 * multi-dimensional data using a single string, so the access path survives being
 * passed as a function argument, a URL parameter, or a filter key.
 *
 * ```ts
 * import * as overscore from '@relations-dil/relations/overscore'
 *
 * const data = { things: { a: { b: [{ '1': 'yep' }] } } }
 *
 * overscore.get(data, 'things__a__b__0____1')  // 'yep'
 * ```
 *
 * All places are separated by double underscores. Extra underscores say how to read
 * the place that follows:
 *
 * | Underscores | Following | Meaning              | Example  | Equivalent     |
 * | ----------- | --------- | -------------------- | -------- | -------------- |
 * | 2           | word      | key                  | `a__b`   | `['a']['b']`   |
 * | 2           | number    | index                | `a__1`   | `['a'][1]`     |
 * | 3           | number    | negative index       | `a___2`  | `['a'][-2]`    |
 * | 4           | number    | numerical key        | `a____3` | `['a']['3']`   |
 * | 5           | number    | negative numeric key | `a_____4`| `['a']['-4']`  |
 */

export class OverscoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OverscoreError'
  }
}

/** A single step in a path: a string key or a numeric (possibly negative) index. */
export type Place = string | number

/** A resolved path, or the double-underscored string form of one. */
export type Path = Place[] | string

const NUMBER = /^\d+$/
const WORD = /^[\w-]+$/

function isDigit(letter: string): boolean {
  return letter >= '0' && letter <= '9'
}

/**
 * Parse double-underscored text into a list of keys and indexes.
 *
 * ```ts
 * parse('a-b__0___1____2_____3')  // ['a-b', 0, -1, '2', '-3']
 * ```
 */
export function parse(text: string): Place[] {
  let count = 0
  let place: string[] = []
  const places: string[] = []

  let state: 'place' | 'placing' = 'place'

  for (const letter of text) {
    if (state === 'place') {
      place.push(letter)
      if (letter !== '_') {
        state = 'placing'
      }
    } else {
      count = letter === '_' ? count + 1 : 0

      if (count === 2 && letter === '_') {
        places.push(place.slice(0, -1).join(''))
        place = []
        count = 0
        state = 'place'
      } else {
        place.push(letter)
      }
    }
  }

  if (place.length) {
    places.push(place.join(''))
  }

  const path: Place[] = []

  for (const found of places) {
    if (isDigit(found[0])) {
      path.push(parseInt(found, 10))
    } else if (found[0] === '_' && found[1] !== undefined && isDigit(found[1]) && found.slice(0, 2) !== '__') {
      path.push(-parseInt(found.slice(1), 10))
    } else if (found.slice(0, 2) === '__' && found[2] !== undefined && isDigit(found[2]) && found.slice(0, 3) !== '___') {
      path.push(found.slice(2))
    } else if (found.slice(0, 3) === '___' && found[3] !== undefined && isDigit(found[3])) {
      path.push(String(-parseInt(found.slice(3), 10)))
    } else {
      path.push(found)
    }
  }

  return path
}

/**
 * Compile a list of keys and indexes back into double-underscored text.
 *
 * ```ts
 * compile(['a-b', 0, -1, '2', '-3'])  // 'a-b__0___1____2_____3'
 * ```
 */
export function compile(path: Place[]): string {
  const places: string[] = []

  for (const place of path) {
    if (typeof place === 'number' && Number.isInteger(place) && place > -1) {
      places.push(String(place))
    } else if (typeof place === 'number' && Number.isInteger(place)) {
      places.push(`_${Math.abs(place)}`)
    } else if (typeof place === 'string' && place.length && place[0] === '-' && NUMBER.test(place.slice(1))) {
      places.push(`___${place.slice(1)}`)
    } else if (typeof place === 'string' && NUMBER.test(place)) {
      places.push(`__${place}`)
    } else if (typeof place === 'string' && WORD.test(place)) {
      places.push(place)
    } else {
      throw new OverscoreError(`cannot compile ${String(place)}`)
    }
  }

  return places.join('__')
}

/** True when `data` is a plain object (the JS stand-in for a Python dict). */
export function isDict(data: unknown): data is Record<string, unknown> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return false
  }
  const proto = Object.getPrototypeOf(data)
  return proto === Object.prototype || proto === null
}

function resolve(path: Path): Place[] {
  return typeof path === 'string' ? parse(path) : path
}

/** Whether `path` exists in `data`. */
export function has(data: unknown, path: Path): boolean {
  let current = data

  for (const place of resolve(path)) {
    if (typeof place === 'number') {
      if (
        !Array.isArray(current) ||
        (place >= 0 && current.length < place + 1) ||
        (place < 0 && current.length < Math.abs(place))
      ) {
        return false
      }
      current = current.at(place)
    } else {
      if (!isDict(current) || !Object.prototype.hasOwnProperty.call(current, place)) {
        return false
      }
      current = current[place]
    }
  }

  return true
}

/** The value in `data` at `path`, or `null` when it isn't there. */
export function get(data: unknown, path: Path): any {
  let current = data

  for (const place of resolve(path)) {
    if (typeof place === 'number') {
      if (
        !Array.isArray(current) ||
        (place >= 0 && current.length < place + 1) ||
        (place < 0 && current.length < Math.abs(place))
      ) {
        return null
      }
      current = current.at(place)
    } else {
      if (!isDict(current) || !Object.prototype.hasOwnProperty.call(current, place)) {
        return null
      }
      current = current[place]
    }
  }

  return current === undefined ? null : current
}

/**
 * Store `value` in `data` at `path`, creating the objects and arrays along the way.
 *
 * ```ts
 * const data = {}
 * set(data, 'things__a__b___2____1', 'yep')
 * // { things: { a: { b: [{ '1': 'yep' }, null] } } }
 * ```
 */
export function set(data: unknown, path: Path, value: unknown): void {
  const places = resolve(path)
  let current: any = data

  for (let index = 0; index < places.length; index++) {
    const place = places[index]
    const last = index === places.length - 1
    const fallback = last ? value : typeof places[index + 1] === 'string' ? {} : []

    if (isDict(current)) {
      if (typeof place === 'number') {
        throw new OverscoreError(`index ${place} invalid for object ${JSON.stringify(current)}`)
      }
      if (!Object.prototype.hasOwnProperty.call(current, place)) {
        current[place] = fallback
      }
    } else if (Array.isArray(current)) {
      if (typeof place === 'string') {
        throw new OverscoreError(`key ${place} invalid for array ${JSON.stringify(current)}`)
      }
      while ((place >= 0 && current.length < place + 1) || (place < 0 && current.length < Math.abs(place))) {
        current.push(null)
      }
      const at = place < 0 ? current.length + place : place
      if (current[at] === null || current[at] === undefined) {
        current[at] = fallback
      }
    } else {
      throw new OverscoreError(`cannot set ${String(place)} on ${JSON.stringify(current)}`)
    }

    const at = Array.isArray(current) && typeof place === 'number' && place < 0 ? current.length + place : place

    const holder = current as any

    if (!last) {
      current = holder[at as any]
    } else {
      holder[at as any] = value
    }
  }
}
