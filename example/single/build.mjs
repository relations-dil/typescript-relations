// Builds the doTRoute app into ONE html file: the library, UIkit, jQuery, doT, doTRoute, the
// templates and the app, all inlined. Open it from disk - no server, no install - and it keeps
// its data in the browser's localStorage.
//
// Run with `make single`. The result is example/single/app.html.

import { readFile, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'

const www = new URL('../dotroute/www/', import.meta.url)
const uikit = new URL('../../node_modules/@unum-pillars/uikit/dist/', import.meta.url)
const out = new URL('./app.html', import.meta.url)

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

const views = ['header', 'footer', 'home', 'form', 'fields', 'list', 'create', 'retrieve', 'update']

const scripts = [
  ['uikit', await text(uikit, 'js/uikit.min.js')],
  ['uikit icons', await text(uikit, 'js/uikit-icons.min.js')],
  ['jquery', await text(www, 'js/jquery.js')],
  ['doT', await text(www, 'js/doT.js')],
  ['doTRoute', await text(www, 'js/doTRoute.js')],
  ['relations-dil', bundle.outputFiles[0].text],
  ['models', await text(www, 'js/models.js')],
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
<script>window.STORAGE_KEY = 'relations-dil-example'</script>
${scripts.map(([name, code]) => `<script>/* ${name} */\n${inline(code)}\n</script>`).join('\n')}
</body>
</html>
`

await writeFile(out, html)

console.log(`${out.pathname.split('/').slice(-3).join('/')}: ${(html.length / 1024).toFixed(0)} kB`)
