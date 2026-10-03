// Exercises the single-file app's saving rules in jsdom: loading from the data file, the
// newer/older/conflict cases, the Chromium file picker path, the download fallback, the
// leave warning and Cmd-S. Run with `make check-single` after `make single`.
//
// jsdom can't open a real file picker, so the picker is a stand-in; try the real one in Chrome.

import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const html = readFileSync(new URL('./app.html', import.meta.url), 'utf8')
const KEY = 'relations:example'
const META = 'relations-persist:meta'
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const failures = []
const test = async (name, work) => {
  try {
    await work()
    console.log('ok   ', name)
  } catch (error) {
    failures.push(name)
    console.log('FAIL ', name, '\n     ', error.message.split('\n')[0])
  }
}

// A page load. `file` stands in for app.data.js having loaded; `local` is what localStorage had.
const open = async ({ file, local, meta, picker, page = html, confirm = () => { throw new Error('unexpected confirm') } } = {}) => {
  const downloads = []
  const dom = new JSDOM(page, {
    url: 'http://localhost/app.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      if (file) window.RELATIONS_DATA = file
      if (local) window.localStorage.setItem(KEY, local)
      if (meta) window.localStorage.setItem(META, JSON.stringify(meta))
      window.confirm = confirm
      // UIkit's dropdowns want these; jsdom has neither.
      for (const name of ['IntersectionObserver', 'ResizeObserver']) {
        window[name] = class { observe() {} unobserve() {} disconnect() {} }
      }
      window.alert = (message) => { throw new Error(`alert: ${message}`) }
      Object.defineProperty(window, 'isSecureContext', { value: true })
      if (picker) window.showSaveFilePicker = picker
      // jsdom's Blob can't be read back, so keep what it was made from.
      window.Blob = class { constructor(parts) { this.parts = parts } async text() { return this.parts.join('') } }
      window.URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:fake' }
      window.HTMLAnchorElement.prototype.click = function () { downloads.at(-1).name = this.download }
    }
  })
  await wait(1200)
  return { window: dom.window, downloads, dom }
}

const names = (window) => {
  const items = window.localStorage.getItem(KEY)
  return items === null ? [] : JSON.parse(items).data.unit.map(([, record]) => record.name).sort()
}
const chip = (window) => window.document.documentElement.querySelector(':scope > .uk-position-bottom-right').textContent.replace(/\s+/g, ' ').trim()
const parse = (text) => {
  const window = {}
  new Function('window', text)(window)
  return window.RELATIONS_DATA
}
// What localStorage holds for an app is its payload inside a saved file, not the file's wrapper.
const asLocal = (file) => JSON.stringify(file.apps.example)

// The same page with a second app that has a model of the same name, to test routing by app.
const second = html.replace('const APPS = [', `Models.add('second', ({ Model, int, str }) => {
  class Base extends Model { static source = 'second' }
  class Unit extends Base { static fields = { id: int, label: str } }
  return { unit: Unit }
})
const APPS = [
  { name: 'second', title: 'Second', models: '', source: 'local',
    seed: async ({ unit }) => { await new unit([['grams']]).create() } },`)

// A saved file with a unit the demo data doesn't have.
const filed = async () => {
  const first = await open({ picker: undefined })
  first.window.location.hash = '#/example/unit/create'
  await wait(300)
  first.window.document.querySelector('#name').value = 'persisted'
  await first.window.DRApp.current.controller.create_save()
  await wait(400)
  await first.window.Persist.save()
  const text = await first.downloads[0].text()
  first.window.close()
  return parse(text)
}

await test('a first visit has the demo data and unsaved changes', async () => {
  const { window } = await open()
  assert.deepEqual(names(window), ['people', 'stuff'])
  assert.match(chip(window), /Unsaved changes/)
  assert.equal(window.Persist.dirty(), true)
})

await test('without a picker, save downloads data.js and marks everything saved', async () => {
  const { window, downloads } = await open()
  await window.Persist.save()
  assert.equal(downloads.length, 1)
  assert.equal(downloads[0].name, 'data.js')
  const file = parse(await downloads[0].text())
  assert.equal(file.format, 2)
  assert.deepEqual(file.apps.example.data.unit.map(([, r]) => r.name).sort(), ['people', 'stuff'])
  assert.equal(window.Persist.dirty(), false)
  assert.match(chip(window), /Saved/)
})

await test('opening with the data file loads it, and does not re-seed the demo data', async () => {
  const file = await filed()
  const { window } = await open({ file })
  assert.deepEqual(names(window), ['people', 'persisted', 'stuff'])
  assert.match(chip(window), /Saved/)
})

await test('opening loads every app in the file, including ones not running here', async () => {
  const file = await filed()
  file.apps.other = { ids: {}, data: {}, unique: {} }
  const { window } = await open({ file })
  assert.ok(window.localStorage.getItem('relations:other'))
  assert.deepEqual(names(window), ['people', 'persisted', 'stuff'])
})

await test('saving keeps apps that are in the file but not running here', async () => {
  const file = await filed()
  file.apps.other = { ids: { thing: 4 }, data: { thing: [[4, { id: 4 }]] }, unique: {} }
  const { window, downloads } = await open({ file })
  window.localStorage.removeItem('relations:other')
  await window.Persist.save()
  const saved = parse(await downloads[0].text())
  assert.deepEqual(saved.apps.other.ids, { thing: 4 })
  assert.ok(saved.apps.example)
})

await test('a newer file replaces older, unchanged browser data', async () => {
  const file = await filed()
  const old = structuredClone(file)
  old.revision = 1
  old.apps.example.data.unit = old.apps.example.data.unit.filter(([, r]) => r.name !== 'persisted')
  const { window } = await open({ file, local: asLocal(old), meta: { revision: 1, savedRevision: 1 } })
  assert.deepEqual(names(window), ['people', 'persisted', 'stuff'])
})

await test('browser changes the file lacks are kept, and still unsaved', async () => {
  const file = await filed()
  const ahead = structuredClone(file)
  ahead.revision = file.revision + 3
  ahead.apps.example.data.unit.push([99, { id: 99, name: 'browser only', tags: [] }])
  const { window } = await open({ file, local: asLocal(ahead), meta: { revision: ahead.revision, savedRevision: file.revision } })
  assert.ok(names(window).includes('browser only'))
  assert.equal(window.Persist.dirty(), true)
})

await test('a file older than the last save leaves the browser data and shows it as unsaved', async () => {
  const file = await filed()
  const { window } = await open({ file, local: asLocal(file), meta: { revision: file.revision + 5, savedRevision: file.revision + 5 } })
  assert.equal(window.Persist.dirty(), true)
})

for (const [answer, expected] of [[true, 'from the file'], [false, 'from the browser']]) {
  await test(`when both changed, it asks, and OK=${answer} uses the version ${expected}`, async () => {
    const file = await filed()
    const local = structuredClone(file)
    local.apps.example.data.unit.push([99, { id: 99, name: 'browser only', tags: [] }])
    let asked = 0
    const { window } = await open({
      file: { ...file, revision: file.revision + 2 },
      local: asLocal(local),
      meta: { revision: file.revision + 1, savedRevision: file.revision },
      confirm: () => { asked++; return answer }
    })
    assert.equal(asked, 1)
    assert.equal(names(window).includes('browser only'), !answer)
  })
}

await test('with a file picker, the first save asks for the file and later saves reuse it', async () => {
  const writes = []
  let picked = 0
  const handle = {
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    createWritable: async () => ({ write: async (text) => writes.push(text), close: async () => {} })
  }
  const { window } = await open({ picker: async (options) => { picked++; assert.equal(options.suggestedName, 'data.js'); return handle } })
  await window.Persist.save()
  await window.Persist.save()
  assert.equal(picked, 1)
  assert.equal(writes.length, 2)
  assert.ok(parse(writes[0]).apps.example)
  assert.equal(window.Persist.dirty(), false)
})

await test('closing the picker is not an error and saves nothing', async () => {
  const { window } = await open({ picker: async () => { const error = new Error('closed'); error.name = 'AbortError'; throw error } })
  assert.equal(await window.Persist.save(), false)
  assert.equal(window.Persist.dirty(), true)
})

await test('leaving warns only while there are unsaved changes', async () => {
  const { window } = await open()
  const leaving = () => {
    const event = new window.Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  assert.equal(leaving(), true)
  await window.Persist.save()
  assert.equal(leaving(), false)
})

await test('Cmd-S saves', async () => {
  const { window, downloads } = await open()
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true }))
  await wait(300)
  assert.equal(downloads.length, 1)
})

const rows = (window) => [...window.document.querySelectorAll('tbody tr')].map((row) => row.textContent.replace(/\s+/g, ' ').trim())
const page = (window) => window.document.body.textContent.replace(/\s+/g, ' ').trim()
const go = async (window, hash) => { window.location.hash = hash; await wait(500) }

await test('two apps can each have a model called unit, addressed as /<app>/<model>', async () => {
  const { window } = await open({ page: second })
  await go(window, '#/example/unit')
  assert.deepEqual(rows(window), ['1 people', '2 stuff'])
  await go(window, '#/second/unit')
  assert.deepEqual(rows(window), ['1 grams'])
  assert.ok(window.DRApp.routes.example_unit_list && window.DRApp.routes.second_unit_list)
})

await test('each app has its own data and its own storage key', async () => {
  const { window } = await open({ page: second })
  await go(window, '#/second/unit/create')
  window.document.querySelector('#label').value = 'litres'
  await window.DRApp.current.controller.create_save()
  await wait(400)
  assert.equal(window.location.hash, '#/second/unit/2')
  await go(window, '#/example/unit')
  assert.deepEqual(rows(window), ['1 people', '2 stuff'])
  assert.ok(window.localStorage.getItem('relations:example') && window.localStorage.getItem('relations:second'))
})

await test('the nav lists each app and an app page lists its models', async () => {
  const { window } = await open({ page: second })
  await go(window, '#/')
  const nav = window.document.querySelector('.uk-navbar-nav').textContent.replace(/\s+/g, ' ')
  assert.match(nav, /Example/)
  assert.match(nav, /Second/)
  await go(window, '#/second')
  assert.match(page(window), /Second Unit/)
})

await test('saving puts every app in data.js', async () => {
  const { window, downloads } = await open({ page: second })
  await window.Persist.save()
  const saved = parse(await downloads[0].text())
  assert.deepEqual(Object.keys(saved.apps).sort(), ['example', 'second'])
})

console.log(failures.length ? `\n${failures.length} failed` : '\nall passed')
process.exit(failures.length ? 1 : 0)
