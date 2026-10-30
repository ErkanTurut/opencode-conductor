# Iterating on the Conductor GUI

This is the practical loop for changing the Desktop panel without breaking the server, the
ledger, or an active conductor run.

## Prerequisites

- OpenCode Desktop **2.2.x** (the GUI SDK ships with 2.2).
- The plugin in the global `~/.config/opencode/opencode.json(c)` `plugins` list. For a local
  checkout, add its absolute path.
- A project with a conductor ledger. `saul` is the reference project in this workspace.

## The loop

```sh
cd ~/.config/opencode/plugins/opencode-conductor

# 1. edit src/gui/**
bunx tsc -p tsconfig.gui.json --noEmit
bun run gui:build
bun run smoke:gui

# 2. Desktop: Settings → Extensions → Plugins → conductor → Reload
#    or keep this running while you edit:
bun run gui:watch
```

`bun run gui:build` writes the single CommonJS bundle `dist/gui-experimental.cjs`. Desktop
reloads the GUI in every window; the **server entry does not restart**. If the panel does not
refresh, use **Reload** or restart the app. A server/RPC change is different: it can reload
the plugin, so read the live-run rules below.

Before finishing:

```sh
bun test
bun run typecheck
bunx tsc -p tsconfig.gui.json --noEmit
bun run gui:build
bun run smoke:gui
```

## Safe iteration during an active conductor run

- **GUI-only** changes (`src/gui/**`, `dist/gui-experimental.cjs`) are safe: they reload the
  window's GUI, not the server plugin.
- **Server/RPC** changes (`src/index.ts`, `src/rpc/**`, `src/read/**`, `src/plugin.ts`) can
  reload the plugin. While a run is active, avoid them unless the user explicitly accepts the
  reload.
- Never inspect a live issue by writing to `.opencode/supervisor.db`, `.opencode/runs/**`, or
  `.opencode/memory/**`. Use `sqlite3 -readonly` and plain reads.
- A run in `awaiting_refinement` is parked; that does not make a restart automatically safe.
  Ask.

## How the panel is discovered

A `Panel` contributes tabs, but it does **not** create a launcher. The side panel's **+ /
New tab** list is built from `MenuItem`s. `src/gui.tsx` registers both:

```ts
ctx.add(Panel, {
  id: 'conductor',
  region: 'side',
  list: () => tabs,
  render: (props) => <ConductorPanel {...props} />,
})

ctx.add(MenuItem, (): MenuItem => ({
  menu: 'session.panel',
  id: 'open',
  title: ctx.t('panel.title'),
  icon: 'terminal',
  order: 35,
  keybind: `${ctx.id}.open`,
  run: () => {
    const session = ctx.sessions.current()
    if (session) ctx.layout.open(`${ctx.id}:runs`, session)
  },
}))
```

The command palette entry is `conductor.open`; it toggles the panel. If the **+** menu has no
Conductor entry, the `MenuItem` is missing or the GUI setup did not run.

## Location scoping — the “No runs yet” trap

RPC registrations are per location. The Desktop app's server also has a global plugin instance
at `/Users/<you>`. A call without a location hits that instance and returns an empty ledger.

Every call must carry the session directory:

```ts
const location = () => ({ directory: props.session.directory })

rpc().runs({ limit: 50 }, { location: location() })
rpc().run({ runId }, { location: location() })
rpc().memory({ limit: 50 }, { location: location() })
```

The client serializes this as `location[directory]`. Verified against a live server:

```sh
curl -u "opencode:$PASSWORD" -X POST \
  'http://127.0.0.1:49374/api/rpc/conductor/runs?location%5Bdirectory%5D=%2Fpath%2Fto%2Fproject' \
  -H 'Content-Type: application/json' \
  -d '{"input":{"limit":5}}'
```

If the panel shows “No runs yet” in a project that has runs, check this first.

## Adding a tab

1. Add the id to `CONDUCTOR_TABS` in `src/gui/panel.tsx`.
2. Add its title key to the `TITLES` map in `src/gui.tsx` and the `i18n.en` catalog.
3. Create `src/gui/views/your-view.tsx` and render from the `Switch` in `ConductorPanel`.
4. Keep all tabs in the `group: 'conductor'` group so one render stays mounted and the selected
   run survives tab switches.
5. Add loading, empty, and error states; unknown fields render as `unknown`.
6. If the view needs data, add an RPC method (see `docs/RPC.md`) rather than reading files.
7. Test pure formatting/grouping helpers under `tests/gui/`.

## Adding an RPC method

See `docs/RPC.md` for the full checklist. Short version:

1. `src/rpc-contract.ts` — method + JSON Schema + view types.
2. `src/read/ledger-reader.ts` or `src/read/artifacts.ts` — read-only source.
3. `src/read/projections.ts` — pure builder.
4. `src/rpc/register.ts` — guarded handler + envelope.
5. `tests/read/*`, `tests/rpc/*`.
6. GUI call with `{ location: location() }`.

## Debugging checklist

1. **Plugin is active with GUI support**

   ```sh
   opencode api get /api/plugin | grep -o '"id":"conductor"[^}]*'
   ```

   Expect `"features":{"server":true,"rpc":true,"gui":true},"state":{"status":"active"}`.

2. **Bundle is served**

   ```sh
   curl -u "opencode:$PASSWORD" \
     'http://127.0.0.1:49374/api/plugin/gui?id=conductor&location=%2Fpath%2Fto%2Fproject'
   ```

   A 500 with `ENOENT ... dist/gui-experimental.cjs` means the bundle was not built.

3. **Global config lists the plugin**

   ```jsonc
   { "plugins": ["/absolute/path/to/opencode-conductor"] }
   ```

   Desktop loads GUI entries from its configured plugins, not only from auto-discovery.

4. **No other plugin breaks the reload**

   The whole plugin reload fails if another plugin registers an invalid command. A command must
   use `name`, not `id`:

   ```ts
   // wrong: editor.add({ id: 'carousel-new', ... })
   editor.add({ name: 'carousel-new', description, execute })
   ```

   The Carousel plugin in saul is disabled as `index.ts.disabled` for this reason. Re-enable
   it only after fixing its command shape.

5. **Run the bundle smoke test**

   ```sh
   bun run smoke:gui
   ```

   It loads `dist/gui-experimental.cjs` with a fake host and asserts `Panel`, `Command`,
   `MenuItem`, `Style`, and the six tab ids.

6. **Desktop logs**

   ```text
   ~/Library/Application Support/ai.opencode.desktop/logs/<timestamp>/main.log
   ~/Library/Application Support/ai.opencode.desktop/logs/<timestamp>/renderer.log
   ```

   Look for `plugin bundle read failed`, `Failed to load`, or a GUI evaluation error.

## Manual smoke checklist

Open a project with runs (saul) and the Conductor panel:

- [ ] **+ → Conductor** opens the panel.
- [ ] Runs lists the newest run; selecting another run updates the header.
- [ ] DAG renders nodes, edges, layers, and a selected-task detail.
- [ ] Gates shows approvals, verification rows, and findings.
- [ ] Refinements shows the state, Q&A, and requirements text.
- [ ] Memory lists blocks and expands the full content.
- [ ] Routing & timeline shows assignments, observed routes, and events.
- [ ] A project with no runs shows the empty state, not an error.
- [ ] The panel never writes state (no approval/retry/pause controls).
- [ ] After a GUI rebuild, **Reload** updates the panel without restarting the server.

## Common errors

| Error | Cause | Fix |
| --- | --- | --- |
| Panel absent from **+** | No `MenuItem` | Add `ctx.add(MenuItem, ...)` in `src/gui.tsx` |
| **No runs yet** with runs present | Missing RPC `location` | Pass `{ location: { directory: session.directory } }` |
| **Could not load data** | Server part older than GUI, or RPC not registered | Check `/api/plugin`; restart once; verify `ctx.rpc.register` |
| `/api/plugin/gui` 500 / ENOENT | Bundle missing | `bun run gui:build`; ensure `dist/gui-experimental.cjs` is committed |
| Plugin reload fails / `/api/command` 500 | Another plugin's command uses `id` | Fix to `name`; disable that plugin to confirm |
| GUI shows global data | Wrong location | Use the session directory; check `workspace.projectRoot` |
| Duplicate panel/tabs | Local + installed package both loaded | Keep one plugin entry |

## Ownership

| Area | Files |
| --- | --- |
| Panel shell, launcher, command, i18n | `src/gui.tsx` |
| Data loop, polling, tab switch | `src/gui/panel.tsx` |
| Views | `src/gui/views/*.tsx` |
| Pure formatting/parsing/geometry | `src/gui/format.ts`, `data.ts`, `dag-layout.ts` |
| Contract | `src/rpc-contract.ts` |
| RPC handlers | `src/rpc/register.ts` |
| Read-only sources | `src/read/*` |
| Bundle build | `vite.config.ts`, `dist/gui-experimental.cjs` |
| Bundle smoke | `scripts/gui-smoke.cjs` |
