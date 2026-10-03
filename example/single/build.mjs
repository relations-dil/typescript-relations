// Builds the doTRoute app into ONE html file: the library, UIkit, jQuery, doT, doTRoute, the
// templates and the app, all inlined. Open it from disk - no server, no install - and it keeps
// its data in the browser's localStorage.
//
// Run with `make single`. The result is example/single/app.html, which loads every app's data from
// the file next to it, data.js, and writes it back when you save (see persist.js). Pass a name
// (`node build.mjs unum`) to get unum.html instead; the data file is always data.js.

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'

const www = new URL('../dotroute/www/', import.meta.url)
const uikit = new URL('../../node_modules/@unum-pillars/uikit/dist/', import.meta.url)
const name = process.argv[2] ?? 'app'
const out = new URL(`./${name}.html`, import.meta.url)

const text = (base, path) => readFile(new URL(path, base), 'utf8')

// Inlined code can't contain a closing script tag.
const inline = (code) => code.replace(/<\/script/gi, '<\\/script')

// The library, bundled for the page. File access is lazy, so nothing from node is pulled in.
const bundle = await build({
  entryPoints: [new URL('../../src/index.ts', import.meta.url).pathname],
  bundle: true,
  format: 'iife',
  globalName: 'Relations',
  platform: 'browser',
  external: ['node:*'],
  write: false,
  logLevel: 'warning'
})

const views = ['header', 'footer', 'home', 'app', 'form', 'fields', 'list', 'create', 'retrieve', 'update']

// Every app's models file, in name order.
const models = (await readdir(new URL('models/', www))).filter((file) => file.endsWith('.js')).sort()

const scripts = [
  ['uikit', await text(uikit, 'js/uikit.min.js')],
  ['uikit icons', await text(uikit, 'js/uikit-icons.min.js')],
  ['jquery', await text(www, 'js/jquery.js')],
  ['doT', await text(www, 'js/doT.js')],
  ['doTRoute', await text(www, 'js/doTRoute.js')],
  ['relations-dil', bundle.outputFiles[0].text],
  ['persist', await text(www, 'js/persist.js')],
  ['unum', await text(www, 'js/unum.js')],
  ['apps', await text(www, 'app.js')],
  ...(await Promise.all(models.map(async (file) => [`models/${file}`, await text(www, `models/${file}`)]))),
  ['relations', await text(www, 'js/relations.js')],
  ['api', await text(www, 'js/api.js')],
  ['service', await text(www, 'js/service.js')]
]

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>relations-dil</title>
<style>
${await text(uikit, 'css/uikit.min.css')}
${await text(www, 'css/relations.css')}
</style>
</head>
<body>
${(await Promise.all(views.map(async (view) =>
  `<script type="text/x-dot" id="template-${view}">\n${inline(await text(www, `${view}.html`))}</script>`))).join('\n')}
<script src="data.js" onerror="this.remove()"></script>
${scripts.map(([name, code]) => `<script>/* ${name} */\n${inline(code)}\n</script>`).join('\n')}
</body>
</html>
`

await writeFile(out, html)

console.log(`${out.pathname.split('/').slice(-3).join('/')}: ${(html.length / 1024).toFixed(0)} kB`)
