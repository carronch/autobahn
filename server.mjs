// Autobahn — a kanban board that lives in your markdown.
// Zero dependencies. Your BACKLOG.md stays the single source of truth:
// this server parses it into lanes, and a drag between lanes rewrites the
// file (the whole ## CARD block moves, byte-for-byte). Commit as usual.
//
//   node server.mjs [dir]        → http://localhost:4780
//
// Optional autobahn.config.json in [dir]:
//   {
//     "backlog": "BACKLOG.md",           // the board file
//     "docs": ["PLAN.md", "NOTES.md"],   // read-only tabs (default: every *.md in dir)
//     "lanes": ["Now", "Next", "Later"], // ## headings that open lanes
//     "prefix": "TASK",                  // id prefix minted by New card
//     "port": 4780
//   }
import { createServer } from 'node:http'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(process.argv[2] || '.')

const DEFAULTS = { backlog: 'BACKLOG.md', docs: null, lanes: ['Now', 'Next', 'Later'], prefix: 'TASK', port: 4780 }
let config = { ...DEFAULTS }
try {
  config = { ...DEFAULTS, ...JSON.parse(await readFile(path.join(ROOT, 'autobahn.config.json'), 'utf8')) }
} catch { /* no config file — defaults */ }

const BACKLOG = path.join(ROOT, config.backlog)
const LANES = config.lanes
const PORT = config.port

// Docs shown as read-only tabs: config list, or every .md in the directory.
async function listDocs() {
  if (Array.isArray(config.docs)) return config.docs
  const entries = await readdir(ROOT).catch(() => [])
  return entries.filter((f) => f.endsWith('.md') && f !== config.backlog).sort().slice(0, 12)
}

// A card id is PREFIX-NUMBER for any A-Z prefix (TASK-12, RAMS-057, ABC-9).
const CARD_ID = /^([A-Z][A-Z0-9]*-\d+) · (.+)$/
const DONE_RE = /\b(SHIPPED|DONE|RETRACTED|RETIRED)\b/
// Statuses written in prose ("done (7/4) — ...", "shipped 3.2") count as
// done when the status LINE starts with the verdict.
const DONE_STATUS_RE = /^(done|shipped|resolved|retracted|retired|sent|superseded)\b/i

function parseBacklog(md) {
  const lines = md.split('\n')
  const heads = []
  lines.forEach((l, i) => { if (/^## /.test(l)) heads.push({ i, text: l.slice(3).trim() }) })
  const spanEnd = (idx) => (idx + 1 < heads.length ? heads[idx + 1].i : lines.length)

  let lane = null
  const items = []
  const pinned = [] // non-card ## blocks inside the FIRST lane render as pinned notes
  heads.forEach((h, idx) => {
    if (LANES.includes(h.text)) { lane = h.text; return }
    const m = h.text.match(CARD_ID)
    const body = lines.slice(h.i + 1, spanEnd(idx)).join('\n')
    const field = (name) => (body.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*([^\\n]+)`)) || [])[1]?.replace(/\*/g, '').trim() ?? null
    const status = field('Status')
    if (m) {
      items.push({
        id: m[1], title: m[2], lane, status,
        done: DONE_RE.test(h.text) || DONE_RE.test(status ?? '') || DONE_STATUS_RE.test(status ?? ''),
        blocked: /^blocked/i.test(status ?? ''),
        line: h.i + 1,
        body: body.trim(),
        size: field('Size'),
        tags: field('Tags'),
      })
    } else if (lane === LANES[0]) {
      pinned.push({ title: h.text, body: body.trim() })
    }
  })
  return { items, pinned }
}

// Move the whole `## CARD` block: before `beforeId` when given (the
// within-lane reorder), otherwise to the END of the target lane.
async function moveItem(id, toLane, beforeId) {
  if (!LANES.includes(toLane)) throw new Error('bad lane')
  if (beforeId === id) return
  const md = await readFile(BACKLOG, 'utf8')
  const lines = md.split('\n')
  const heads = []
  lines.forEach((l, i) => { if (/^## /.test(l)) heads.push({ i, text: l.slice(3).trim() }) })
  const idx = heads.findIndex((h) => h.text.startsWith(id + ' ·'))
  if (idx === -1) throw new Error('item not found')
  const start = heads[idx].i
  const end = idx + 1 < heads.length ? heads[idx + 1].i : lines.length
  const block = lines.slice(start, end)
  const rest = [...lines.slice(0, start), ...lines.slice(end)]
  const rheads = []
  rest.forEach((l, i) => { if (/^## /.test(l)) rheads.push({ i, text: l.slice(3).trim() }) })
  let insertAt
  if (beforeId) {
    const target = rheads.find((h) => h.text.startsWith(beforeId + ' ·'))
    if (!target) throw new Error('drop target not found')
    insertAt = target.i
  } else {
    const laneIdx = rheads.findIndex((h) => h.text === toLane)
    if (laneIdx === -1) throw new Error('lane not found')
    const nextLane = rheads.slice(laneIdx + 1).find((h) => LANES.includes(h.text))
    insertAt = nextLane ? nextLane.i : rest.length
  }
  const out = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)]
  await writeFile(BACKLOG, out.join('\n'))
}

// Mint the next PREFIX number and append a template card to a lane.
async function newCard(title, lane) {
  if (!LANES.includes(lane)) throw new Error('bad lane')
  if (!title || !title.trim()) throw new Error('title required')
  const md = await readFile(BACKLOG, 'utf8')
  let max = 0
  for (const m of md.matchAll(new RegExp(`^## ${config.prefix}-(\\d+)`, 'gm'))) max = Math.max(max, Number(m[1]))
  const id = `${config.prefix}-${String(max + 1).padStart(3, '0')}`
  const today = new Date().toISOString().slice(0, 10)
  const block = `## ${id} · ${title.trim()}
- **Status:** open (carded ${today} via Autobahn)
- **Size:** tbd
- **Why:** tbd
- **Spec:** tbd
- **Done means:** tbd

`
  const lines = md.split('\n')
  const heads = []
  lines.forEach((l, i) => { if (/^## /.test(l)) heads.push({ i, text: l.slice(3).trim() }) })
  const laneIdx = heads.findIndex((h) => h.text === lane)
  if (laneIdx === -1) throw new Error('lane not found')
  const nextLane = heads.slice(laneIdx + 1).find((h) => LANES.includes(h.text))
  const insertAt = nextLane ? nextLane.i : lines.length
  const out = [...lines.slice(0, insertAt), ...block.split('\n'), ...lines.slice(insertAt)]
  await writeFile(BACKLOG, out.join('\n'))
  return id
}

const gitDirty = () => new Promise((res) => {
  execFile('git', ['-C', ROOT, 'status', '--porcelain'], (e, out) => res(e ? '' : out.trim()))
})

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    if (url.pathname === '/') {
      return send(res, 200, await readFile(new URL('./index.html', import.meta.url), 'utf8'), 'text/html')
    }
    if (url.pathname === '/api/board') {
      const md = await readFile(BACKLOG, 'utf8')
      return send(res, 200, {
        ...parseBacklog(md),
        docs: await listDocs(),
        lanes: LANES,
        backlog: config.backlog,
        root: path.basename(ROOT),
        dirty: await gitDirty(),
      })
    }
    if (url.pathname === '/api/doc') {
      const name = url.searchParams.get('name')
      const docs = await listDocs()
      if (!docs.includes(name) && name !== config.backlog) return send(res, 400, { error: 'unknown doc' })
      return send(res, 200, await readFile(path.join(ROOT, name), 'utf8'), 'text/plain; charset=utf-8')
    }
    if (url.pathname === '/api/move' && req.method === 'POST') {
      let body = ''
      for await (const c of req) body += c
      const { id, toLane, beforeId } = JSON.parse(body)
      await moveItem(id, toLane, beforeId)
      return send(res, 200, { ok: true })
    }
    if (url.pathname === '/api/new' && req.method === 'POST') {
      let body = ''
      for await (const c of req) body += c
      const { title, lane } = JSON.parse(body)
      const id = await newCard(title, lane || LANES[1] || LANES[0])
      return send(res, 200, { ok: true, id })
    }
    send(res, 404, { error: 'not found' })
  } catch (e) {
    send(res, 500, { error: String(e.message || e) })
  }
}).listen(PORT, () => console.log(`Autobahn → http://localhost:${PORT}  (board: ${BACKLOG})`))
