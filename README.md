# Kanban — LLMVault fork of Autobahn

Kanban board over a **directory of markdown files**. Fork of
[rams-design/autobahn](https://github.com/rams-design/autobahn) (upstream boards a single
`BACKLOG.md`; this fork boards LLMVault's queue directories).

- Each **card is a file**: `wiki/workblocks/*.md`, `wiki/projects/*.md`.
- The **lane is the `status:` frontmatter field**. Dragging a card between lanes rewrites
  only that file's `status:` + `updated:` lines — everything else byte-for-byte intact.
- The files stay the single source of truth: any LLM session moves cards by editing
  frontmatter; the board is just a lens. No database, no dependencies.

## Run

```sh
node server.mjs            # → http://localhost:4780 (bound to 127.0.0.1 only)
node server.mjs ~/other/wiki
```

Zsh alias installed: `kanban`. Filtra por proyecto con el selector en la UI o `?focus=slug`. Filtra por proyecto con el selector en la UI o `?focus=slug` (ej. `?focus=mawamba`).

## Boards y lanes

| Board      | dir               | lanes                                  |
|------------|-------------------|----------------------------------------|
| Workblocks | `wiki/workblocks` | `someday-maybe → active → waiting-for → done`  |
| Projects   | `wiki/projects`   | `considering → active → done`          |

Config en `kanban.config.json` **junto al server** (nunca dentro del vault).

## Frontmatter contract

```yaml
---
title: "Nombre de la carta"     # fallback: primer «# heading», luego el filename
status: someday-maybe                  # la lane; valores fuera del set caen a la primera lane (chip de aviso)
status_note: "detalle opcional" # se muestra bajo el título de la carta
created: 2026-07-22
updated: 2026-07-22             # el server lo bumpea en cada drag
---
```

`README.md` y archivos con `type: readme` no se cartean. «Nueva carta» crea
`YYYY-MM-DD-<slug>.md` (workblocks) o `<slug>.md` (projects) con ese frontmatter.

## Upstream

Remote `origin` = este fork; remote `upstream` = rams-design/autobahn.
Este fork reemplaza la gramática BACKLOG.md del upstream por el contrato de frontmatter
de arriba. MIT (LICENSE del upstream se conserva).
