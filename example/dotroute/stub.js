// Stands in for node:fs/promises and node:path in the browser bundle. Only Migrations and
// MockSource's file loading use them, and neither makes sense in a page.
const unavailable = (name) => () => {
  throw new Error(`${name} is not available in the browser`)
}

export const readdir = unavailable('readdir')
export const readFile = unavailable('readFile')
export const mkdir = unavailable('mkdir')
export const rename = unavailable('rename')
export const writeFile = unavailable('writeFile')
export const join = (...parts) => parts.join('/')
