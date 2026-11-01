import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { resolve } from 'node:path'
const here = resolve(import.meta.dirname, '..')
export default defineConfig({ root: resolve(here, 'tests/gui/preview'), cacheDir: resolve(here, '.cache/gui-preview-vite'), plugins: [solid()], resolve: { alias: [
  { find: /^@opencode\/plugin\/gui$/, replacement: resolve(here, 'tests/gui/preview/host-mock.tsx') },
  { find: /^@opencode\/plugin\/rpc$/, replacement: resolve(here, 'tests/gui/preview/rpc-mock.ts') },
] }, server: { host: '127.0.0.1', port: 4179, strictPort: true } })
