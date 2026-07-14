# Autobahn

A kanban board that lives in your markdown. Zero dependencies, one file of
server, one file of UI. Your `BACKLOG.md` stays the single source of truth —
Autobahn renders it as lanes, and dragging a card rewrites the file,
byte-for-byte. Commit as usual.

Built at [Rams](https://www.rams.ai) to run our own backlog; shared because
it turned out to be the whole tool.

## Why

Markdown backlogs are great for working with agents and humans in the same
file: greppable, diffable, reviewable, no lock-in. What they lack is a
glanceable board. Autobahn is that board — nothing more. There is no
database, no accounts, no sync. If you delete Autobahn tomorrow, your
backlog loses nothing.

## Quickstart

```
git clone https://github.com/rams-design/autobahn
cd autobahn
node server.mjs example     # → http://localhost:4780
```

Then point it at your own project:

```
node server.mjs ~/code/my-project
```

It looks for `BACKLOG.md` in that directory (see [FORMAT.md](FORMAT.md) for
the card grammar — or copy `example/BACKLOG.md` as a starter). Every other
`.md` file in the directory shows up as a read-only rendered tab.

Requires Node 18+. No install step, no dependencies.

## What it does

- **Lanes** — `## Now`, `## Next`, `## Later` headings in the backlog open
  lanes; every `## PREFIX-N · Title` block under them is a card.
- **Drag to move** — between lanes, or onto a card to insert before it.
  Both splice the card's markdown block into its new position and write the
  file back.
- **Shipped is derived** — cards whose Status starts with done / shipped /
  resolved / retired (or whose title says so) collect in a Shipped column
  automatically. No archiving ritual.
- **New card** — mints the next id (`TASK-007`) and appends a template card.
- **Card lightbox** — click any card for its full rendered body.
- **Pinned notes** — non-card `##` blocks inside the first lane render as
  pinned notes above the board (sprint goals, standing reminders).
- **Docs tabs** — the rest of your project's markdown, rendered read-only.
- **Dirty flag** — shows when the directory has uncommitted git changes.

## Configuration

Optional `autobahn.config.json` next to your backlog:

```json
{
  "backlog": "BACKLOG.md",
  "docs": ["PLAN.md", "NOTES.md"],
  "lanes": ["Now", "Next", "Later"],
  "prefix": "TASK",
  "port": 4780
}
```

Everything is optional. Without `docs`, every `.md` in the directory (except
the backlog) becomes a tab. `prefix` is what New card mints; existing cards
can use any `PREFIX-N` id.

## Design notes

- The file is the database. Autobahn never stores state of its own.
- Writes are whole-block splices — a moved card is the same bytes in a new
  position, so diffs stay readable and merge conflicts stay rare.
- Intended for localhost. There is no auth; don't expose the port.
- The markdown renderer is deliberately small and only fed your own local
  files.

## License

MIT © Rams (rams.ai)
