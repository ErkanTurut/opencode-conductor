# Entry points: why the package root is mountable

OpenCode loads a locally mounted plugin by resolving `index.ts` (or `server.ts`)
**at the configured directory**. For that path it does not read
`package.json#main`, and it does not search `src/`. So the directory named in
`plugins` must itself contain an `index.ts`.

Measured on opencode v2.1.3, same package, two configs:

| `plugins: [...]` | server log | loaded |
| --- | --- | --- |
| `…/tools/opencode-conductor` | no `loading plugin` line | no |
| `…/tools/opencode-conductor/src` | `msg="loading plugin" id=…/src entrypoint=file://…/src/index.ts` | yes |

Before P1b the first row was a silent no-op: the package root — the path a
consumer installs and the only one `files`/`main`/`exports` describe — carried
no `index.ts`, while `src/` happened to satisfy the rule by accident.

## The root entry

`tools/opencode-conductor/index.ts` is a re-export shim, not a second
implementation:

```ts
export * from './src/index'
export { default } from './src/index'

export { resolveStateLayout } from './src/runtime/state-layout'
export { resolveTrust } from './src/runtime/trust'
export { registerConductorTools } from './src/register/tools'
```

- `export *` forwards every named export of `src/index.ts`; `export *` never
  forwards `default`, hence the explicit default line. The default is the
  conductor plugin object `{ id: 'conductor', setup }`.
- The three extra named re-exports are the primitives the conductor entry
  composes. `src/index.ts` keeps `runtime/*` and `register/*` off the package
  surface (it reaches them via `plugin.ts`), so a host that mounts the root
  could otherwise not reach the state-layout, trust, or registration seams.
  They are explicit re-exports, so they keep working if `src/index.ts` ever
  forwards the same names.
- Imports are extensionless: this package's `tsc --noEmit` baseline rejects
  `.ts` specifiers (TS5097) unless `allowImportingTsExtensions` is set.

Rule for maintainers: never declare anything in `index.ts`. It must stay
derived from `src/index.ts`, or the two surfaces drift and the mounted plugin
stops being the one the tests exercise.

`package.json` follows the same entry: `main`, `types`, and `exports["."]` all
point at `./index.ts`, and `files` ships it. That is what makes an
`opencode plugin add` / npm-style install resolve to the mountable root rather
than to `src/`.

## Both mount forms

Root mount (recommended — the shipped path):

```jsonc
// ~/.config/opencode/opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/abs/path/to/tools/opencode-conductor"]
}
```

`src` mount (still works, but it is an internal directory):

```jsonc
{
  "plugins": ["/abs/path/to/tools/opencode-conductor/src"]
}
```

Both load the identical plugin (`id: conductor`). Prefer the root: it is the
path `package.json` advertises, and `src` only works because of the
index-at-the-configured-directory rule described above.

## Running the mount check

The check needs a real `opencode` binary, a real background server, and a real
plugin load, so it is **opt-in and not part of `bun test`**:

```bash
cd tools/opencode-conductor
bun run scripts/entry/mount-check.ts        # or: bun tools/opencode-conductor/scripts/entry/mount-check.ts from the repo root
bun run scripts/entry/mount-check.ts --keep # keep the temp HOME/project for inspection
```

What it does:

1. creates a throwaway HOME and a throwaway non-git project under the OS temp
   dir, with every `XDG_*` root redirected into that HOME;
2. writes `<home>/.config/opencode/opencode.jsonc` with
   `plugins: ["<absolute package root>"]`;
3. picks a free port, runs `opencode service set port <port>`, then
   `opencode debug agents` with `HOME`/cwd pointed at the fixtures;
4. asserts the server log has a `loading plugin` line whose `id` is the package
   root (or whose `entrypoint` is `<root>/index.ts`), and that no
   `level=ERROR` line mentions the plugin;
5. snapshots the project before boot and asserts the recursive listing is
   unchanged after the load;
6. removes both temp dirs (unless `--keep`) and stops the throwaway server.

Binary resolution: `$OPENCODE_BIN`, else `opencode2`, else `opencode` (via
`Bun.which`).

Output is evidence lines plus exactly one verdict:

```
LOG_ROOT_LOAD … msg="loading plugin" id=<package root> entrypoint=file://<package root>/index.ts
LOG_PLUGIN_ERRORS none
PROJECT_DIR_UNCHANGED yes before=0 after=0
MOUNT_OK <package root>
```

Exit `0` on `MOUNT_OK`; exit `1` with `MOUNT_FAIL <reason>` when the root never
loads, the plugin logs an ERROR, or the project directory changed.
