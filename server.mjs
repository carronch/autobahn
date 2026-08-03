// Autobahn — vault fork: a kanban board over a directory of markdown files.
// Upstream (github.com/rams-design/autobahn) boards one BACKLOG.md with lanes
// as ## headings. This fork boards LLMVault: each card is a FILE
// (wiki/workblocks/*.md, wiki/projects/*.md) and the lane is the `status:`
// frontmatter field. Dragging a card rewrites only that file's `status:`
// (+ `updated:`) lines — the files stay the single source of truth, and any
// LLM session can move cards by editing frontmatter.
//
//   node server.mjs [wikiDir]    → http://localhost:4780
//
// Optional autobahn.config.json NEXT TO THIS FILE (not in the vault):
//   {
//     "root": "~/Documents/LLMVault/wiki",
//     "boards": [{ "name": "Workblocks", "dir": "workblocks",
//                  "lanes": ["queued", "executing", "waiting", "done"] }],
//     "docs": ["workblocks/README.md"],
//     "port": 4780
//   }
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULTS = {
  root: path.join(process.env.HOME ?? '', 'Documents/LLMVault/wiki'),
  boards: [
    { name: 'Workblocks', dir: 'workblocks', lanes: ['queued', 'executing', 'waiting', 'done'] },
    { name: 'Projects', dir: 'projects', lanes: ['considering', 'active', 'done'] },
  ],
  docs: ['workblocks/README.md'],
  port: 4780,
}
let config = { ...DEFAULTS }
try {
  config = { ...DEFAULTS, ...JSON.parse(await readFile(path.join(HERE, 'autobahn.config.json'), 'utf8')) }
} catch { /* no config file — defaults */ }

const ROOT = path.resolve((process.argv[2] || config.root).replace(/^~/, process.env.HOME ?? '~'))
const PORT = config.port

// --- frontmatter: parse the `---` block into flat key/value attrs ------------
function fm(src) {
  if (!src.startsWith('---\n')) return { attrs: {}, body: src }
  const end = src.indexOf('\n---', 3)
  if (end === -1) return { attrs: {}, body: src }
  const attrs = {}
  for (const line of src.slice(4, end).split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (m) attrs[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').trim()
  }
  return { attrs, body: src.slice(src.indexOf('\n', end + 1) + 1) }
}

// Rewrite ONLY the status/updated lines of a file's frontmatter, byte-for-byte
// elsewhere. Files without frontmatter get a minimal one prepended.
function withStatus(src, status) {
  const today = new Date().toISOString().slice(0, 10)
  if (!src.startsWith('---\n')) return `---\nstatus: ${status}\nupdated: ${today}\n---\n${src}`
  const end = src.indexOf('\n---', 3)
  let head = src.slice(4, end + 1)
  const rest = src.slice(end + 1)
  head = /^status:/m.test(head) ? head.replace(/^status:.*$/m, `status: ${status}`) : head + `status: ${status}\n`
  head = /^updated:/m.test(head) ? head.replace(/^updated:.*$/m, `updated: ${today}`) : head + `updated: ${today}\n`
  return '---\n' + head + rest
}

const boardByName = (name) => config.boards.find((b) => b.name === name)
const SAFE_ID = /^[\w][\w.À-ſ-]*$/ // filename slug, no slashes or dots-walk

async function loadBoard(b) {
  const dir = path.join(ROOT, b.dir)
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md') && f !== 'README.md')
  const items = []
  for (const f of files) {
    const { attrs, body } = fm(await readFile(path.join(dir, f), 'utf8'))
    if (/^readme$/i.test(attrs.type ?? attrs.kind ?? '')) continue
    const id = f.slice(0, -3)
    const status = (attrs.status ?? '').trim()
    items.push({
      id,
      title: attrs.title || (body.match(/^# (.+)$/m) || [])[1] || id,
      lane: b.lanes.includes(status) ? status : b.lanes[0],
      unmapped: status && !b.lanes.includes(status) ? status : null,
      note: attrs.status_note || null,
      date: (id.match(/^\d{4}-\d{2}-\d{2}/) || [])[0] || attrs.created || attrs.date || null,
      updated: attrs.updated || null,
      tags: (attrs.tags || '').replace(/^\[|\]$/g, '').split(',')[0].trim() || null,
      priority: (attrs.priority || '').trim().toLowerCase() || null,
      body: body.trim(),
    })
  }
  // Date-slugged dirs (workblocks) read newest-first; the rest alphabetically.
  const dated = items.length && items.every((i) => /^\d{4}-/.test(i.id))
  items.sort((a, z) => (dated ? z.id.localeCompare(a.id) : a.id.localeCompare(z.id)))
  return items
}

async function moveItem(b, id, toLane) {
  if (!b.lanes.includes(toLane)) throw new Error('bad lane')
  if (!SAFE_ID.test(id)) throw new Error('bad id')
  const p = path.join(ROOT, b.dir, id + '.md')
  await writeFile(p, withStatus(await readFile(p, 'utf8'), toLane))
}

async function newCard(b, title, lane) {
  if (!b.lanes.includes(lane)) throw new Error('bad lane')
  if (!title || !title.trim()) throw new Error('title required')
  const today = new Date().toISOString().slice(0, 10)
  const slug = title.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'sin-titulo'
  const existing = await readdir(path.join(ROOT, b.dir))
  let id = b.dir === 'workblocks' ? `${today}-${slug}` : slug
  for (let n = 2; existing.includes(id + '.md'); n++) id = id.replace(/(-\d+)?$/, `-${n}`)
  const kind = b.dir.replace(/s$/, '')
  const q = /[:#'"—]/.test(title) ? `"${title.trim().replace(/"/g, '\\"')}"` : title.trim()
  const md = `---
type: ${kind}
title: ${q}
created: ${today}
updated: ${today}
status: ${lane}
---

# ${title.trim()}

_(carded ${today} vía Autobahn — completá el plan)_

## Known unknowns

- [ ] _(qué falta decidir, qué solo se descubre ejecutando, y quién lo resuelve)_
`
  await writeFile(path.join(ROOT, b.dir, id + '.md'), md, { flag: 'wx' })
  return id
}

// Open Terminal.app with an interactive `claude` session on one card's file.
// The card id is SAFE_ID-validated and the file must exist, so the only
// dynamic text reaching the shell goes through single-quote escaping.
async function talkAbout(b, id) {
  if (!SAFE_ID.test(id)) throw new Error('bad id')
  const rel = path.join(path.basename(ROOT), b.dir, id + '.md')
  await readFile(path.join(ROOT, b.dir, id + '.md')) // existence check
  const vault = path.dirname(ROOT)
  const prompt = `Read ${rel} and help me resolve that workblock: review the plan and its current state, tell me what's missing or blocked, and let's execute the next steps together.`
  const shq = (s) => `'` + s.replace(/'/g, `'"'"'`) + `'`
  const shellCmd = `cd ${shq(vault)} && claude ${shq(prompt)}`
  const asq = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  await new Promise((resolve, reject) =>
    execFile('osascript',
      ['-e', `tell application "Terminal" to activate`,
       '-e', `tell application "Terminal" to do script "${asq(shellCmd)}"`],
      (err) => (err ? reject(err) : resolve()))
  )
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    if (url.pathname === '/') {
      return send(res, 200, await readFile(path.join(HERE, 'index.html'), 'utf8'), 'text/html')
    }
    if (url.pathname === '/api/board') {
      const b = boardByName(url.searchParams.get('board')) || config.boards[0]
      return send(res, 200, {
        board: b.name,
        boards: config.boards.map((x) => x.name),
        lanes: b.lanes,
        items: await loadBoard(b),
        docs: config.docs ?? [],
        root: path.basename(ROOT) + '/' + b.dir,
      })
    }
    if (url.pathname === '/api/doc') {
      const name = url.searchParams.get('name')
      if (!(config.docs ?? []).includes(name)) return send(res, 400, { error: 'unknown doc' })
      return send(res, 200, await readFile(path.join(ROOT, name), 'utf8'), 'text/plain; charset=utf-8')
    }
    if (url.pathname === '/api/move' && req.method === 'POST') {
      let body = ''
      for await (const c of req) body += c
      const { board, id, toLane } = JSON.parse(body)
      const b = boardByName(board)
      if (!b) throw new Error('bad board')
      await moveItem(b, id, toLane)
      return send(res, 200, { ok: true })
    }
    if (url.pathname === '/api/claude' && req.method === 'POST') {
      let body = ''
      for await (const c of req) body += c
      const { board, id } = JSON.parse(body)
      const b = boardByName(board)
      if (!b) throw new Error('bad board')
      await talkAbout(b, id)
      return send(res, 200, { ok: true })
    }
    if (url.pathname === '/api/new' && req.method === 'POST') {
      let body = ''
      for await (const c of req) body += c
      const { board, title, lane } = JSON.parse(body)
      const b = boardByName(board)
      if (!b) throw new Error('bad board')
      const id = await newCard(b, title, lane || b.lanes[0])
      return send(res, 200, { ok: true, id })
    }
    send(res, 404, { error: 'not found' })
  } catch (e) {
    send(res, 500, { error: String(e.message || e) })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Autobahn → http://localhost:${PORT}  (root: ${ROOT})`))
