#!/usr/bin/env node
// Load the built GUI bundle with a fake OpenCode GUI host.
//
// This is the fastest way to catch a bundle that cannot even register its
// contributions: wrong default export, missing registry imports, a setup that
// throws before the panel is added, or a missing tab. It does not render Solid;
// it only executes `Plugin.define` + `setup` and inspects the registrations.
//
// Usage: node scripts/gui-smoke.cjs

const Module = require('node:module')
const path = require('node:path')
const { existsSync } = require('node:fs')

const bundle = path.resolve(__dirname, '..', 'dist', 'gui-experimental.cjs')

if (!existsSync(bundle)) {
  console.error('GUI smoke: dist/gui-experimental.cjs is missing. Run `bun run gui:build` first.')
  process.exit(1)
}

const registrations = []
const registry = (id) => ({ kind: 'registry', id })
const gui = {
  Plugin: { define: (definition) => definition },
  Panel: registry('Panel'),
  Command: registry('Command'),
  MenuItem: registry('MenuItem'),
  Style: registry('Style'),
  usePlugin: () => ({}),
}
const rpc = { Rpc: { define: (definition) => definition } }
const solid = new Proxy({}, { get: () => () => ({}) })

const originalLoad = Module._load
Module._load = function (request) {
  if (request === '@opencode/plugin/gui') return gui
  if (request === '@opencode/plugin/rpc') return rpc
  if (request === 'solid-js' || request === 'solid-js/web' || request === 'solid-js/store') {
    return solid
  }
  return originalLoad.apply(this, arguments)
}

try {
  const mod = require(bundle)
  const definition = mod.default || mod

  if (!definition || typeof definition.setup !== 'function') {
    throw new Error('the bundle default export has no setup()')
  }

  const ctx = {
    id: 'conductor',
    t: (key) => key,
    plural: (key, count) => `${count} ${key}`,
    add: (reg, item) => {
      registrations.push({ reg, item })
      return () => {}
    },
    sessions: { current: () => ({ id: 'smoke', directory: process.cwd() }) },
    layout: { open() {}, toggle() {}, state: () => 'closed' },
    client: { rpc: () => ({}) },
  }

  definition.setup(ctx)

  const ids = registrations.map((entry) => entry.reg.id)
  for (const required of ['Panel', 'Command', 'MenuItem', 'Style']) {
    if (!ids.includes(required)) throw new Error(`setup did not register ${required}`)
  }

  const panel = registrations.find((entry) => entry.reg.id === 'Panel').item
  if (panel.id !== 'conductor') throw new Error(`panel id is ${panel.id}, expected conductor`)
  if (panel.region !== 'side') throw new Error(`panel region is ${panel.region}, expected side`)

  const tabs = panel.list({ open: [] }).map((tab) => tab.id)
  const expectedTabs = ['runs', 'dag', 'gates', 'refinements', 'memory', 'routing']
  if (JSON.stringify(tabs) !== JSON.stringify(expectedTabs)) {
    throw new Error(`tabs are ${JSON.stringify(tabs)}, expected ${JSON.stringify(expectedTabs)}`)
  }

  const menuEntry = registrations.find((entry) => entry.reg.id === 'MenuItem').item
  const menu = typeof menuEntry === 'function' ? menuEntry() : menuEntry
  if (!menu || menu.menu !== 'session.panel') {
    throw new Error('MenuItem is not registered on the session.panel menu')
  }

  const title = definition.i18n && definition.i18n.en && definition.i18n.en['panel.title']
  if (!title) throw new Error('i18n.en["panel.title"] is missing')

  console.log(
    `GUI smoke: ok — Panel, Command, MenuItem, Style; tabs: ${tabs.join(', ')}; title: ${title}`,
  )
} catch (error) {
  console.error('GUI smoke: failed')
  console.error(error && error.stack ? error.stack : error)
  process.exitCode = 1
} finally {
  Module._load = originalLoad
}
