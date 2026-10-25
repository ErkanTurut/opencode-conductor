// Fleet dashboard entry point.
//
// Resolves the listen port (`--port` CLI flag > FLEET_UI_PORT env var >
// default 4649) and serves the fleet UI + REST API, bound to 127.0.0.1
// only. Run directly: `bun run src/fleet-ui/server.ts`.

import { createFleetUiApp, DEFAULT_FLEET_UI_PORT } from './app'
import type { FleetUiApp, FleetUiOptions } from './app'

export const FLEET_UI_PORT_ENV_VAR = 'FLEET_UI_PORT'
export { DEFAULT_FLEET_UI_PORT } from './app'

const MIN_PORT = 1
const MAX_PORT = 65535

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_PORT && value <= MAX_PORT
}

/**
 * Extract `--port <n>` / `--port=<n>` from CLI args. Returns undefined
 * when absent or unparseable (invalid values fall through to later
 * precedence levels rather than crashing).
 */
export function parseCliPort(argv: string[]): number | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port') {
      const raw = argv[i + 1]
      if (raw !== undefined) {
        const parsed = Number(raw)
        if (isValidPort(parsed)) return parsed
      }
      return undefined
    }
    if (arg.startsWith('--port=')) {
      const parsed = Number(arg.slice('--port='.length))
      if (isValidPort(parsed)) return parsed
      return undefined
    }
  }
  return undefined
}

function parseEnvPort(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const parsed = Number(raw.trim())
  return isValidPort(parsed) ? parsed : undefined
}

/** Port precedence: `--port` flag > env var > default. */
export function resolveFleetUiPort(argv: string[], envPort: string | undefined): number {
  return parseCliPort(argv) ?? parseEnvPort(envPort) ?? DEFAULT_FLEET_UI_PORT
}

export interface RunningFleetUi {
  server: ReturnType<typeof Bun.serve>
  app: FleetUiApp
  hostname: string
  port: number
}

/** Create the app and bind it to loopback. `port` defaults to 0 (ephemeral). */
export function startFleetUiServer(
  options: FleetUiOptions & { port?: number } = {},
): RunningFleetUi {
  const app = createFleetUiApp({ configPath: options.configPath })
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.port ?? 0,
    fetch: (req: Request) => app.fetch(req),
  })
  const { hostname, port } = server
  if (hostname === undefined || port === undefined) {
    server.stop(true)
    throw new Error('fleet-ui: server did not report a TCP address')
  }
  // Pin the Host allowlist to the real bound port before any request can
  // be handled (same synchronous block as the bind, so no request event
  // can run in between).
  app.setBoundPort(port)
  return { server, app, hostname, port }
}

export { createFleetUiApp } from './app'
export type { FleetView } from './app'
export type {
  FleetAssignmentSource,
  FleetEffectiveModel,
  FleetModelView,
  FleetRoleView,
  FleetSlotView,
  FleetUiOptions,
} from './app'

if (import.meta.main) {
  const argv = process.argv.slice(2)
  const port = resolveFleetUiPort(argv, process.env[FLEET_UI_PORT_ENV_VAR])
  const started = startFleetUiServer({ port })
  console.log(`fleet-ui: serving http://${started.hostname}:${started.port}`)
}
