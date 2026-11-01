import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerSupervisorTools, resolveSupervisorConfig, type CollectedTool, type ToolRegistrar } from '../../src/plugin'
import { recordMemoryDecision } from '../../src/runtime/closeout'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'conductor-closeout-tool-'))); roots.push(root)
  const defs: CollectedTool[] = []; const editor: ToolRegistrar = { add: (d) => defs.push(d) }
  const config = resolveSupervisorConfig({ options: { repoRoot: root }, env: {} })
  registerSupervisorTools(editor, config)
  return { root, defs }
}
function parse(value: any) { return JSON.parse(typeof value === 'string' ? value : value.content) }

test('registered receipt requires explicit memory decision, validates run ids and does not fabricate completion', async () => {
  const { root, defs } = setup()
  const generate = defs.find((d) => d.name === 'supervisor_generate_receipt')
  const init = defs.find((d) => d.name === 'supervisor_init_run')
  expect(generate).toBeDefined(); expect(init).toBeDefined()
  const created = parse(await init!.execute({ objective: 'closeout fixture', risk_class: 'low' }))
  const runDir = join(root, '.opencode', 'runs', created.run_id)
  const before = await generate!.execute({ run_id: created.run_id })
  expect(parse(before)).toMatchObject({ error: expect.stringContaining('memory_decision_required') })
  expect(existsSync(join(runDir, 'receipt.md'))).toBe(false)
  expect(parse(await generate!.execute({ run_id: '../escape' })).error).toBeTruthy()
  expect(existsSync(join(root, '.opencode', 'runs', 'receipt.md'))).toBe(false)

  expect(recordMemoryDecision(runDir, created.run_id, { decision: 'none', rationale: 'No reusable lesson was found' }).ok).toBe(true)
  const result = parse(await generate!.execute({ run_id: created.run_id, memory_decision: { decision: 'none', rationale: 'No reusable lesson was found' } }))
  expect(result.receipt_path).toBe(join(runDir, 'receipt.md'))
  expect(result.state).toBe('intake')
  expect(readFileSync(result.receipt_path, 'utf8')).toContain('intake')
})

test('curator handoff is persisted before receipt; disabled config is an explicit decision', async () => {
  const { root, defs } = setup()
  const generate = defs.find((d) => d.name === 'supervisor_generate_receipt')!
  const init = defs.find((d) => d.name === 'supervisor_init_run')!
  const created = parse(await init.execute({ objective: 'curate lesson', risk_class: 'low' }))
  const runDir = join(root, '.opencode', 'runs', created.run_id)
  mkdirSync(join(runDir, 'artifacts'), { recursive: true }); writeFileSync(join(runDir, 'artifacts', 'verification.txt'), 'test passed')
  const decision = { decision: 'curate', rationale: 'A verified lesson merits review' }
  expect(recordMemoryDecision(runDir, created.run_id, decision)).toMatchObject({ ok: true, handoff: true })
  const proposalInput = { label: 'verification', content: 'Verify fixtures before closeout.', source_artifacts: ['artifacts/verification.txt'] }
  expect(parse(await generate.execute({ run_id: created.run_id, memory_decision: decision })).closeout).toBe('handoff_required')
  const result = parse(await generate.execute({ run_id: created.run_id, memory_decision: decision, curator_proposal: proposalInput }))
  expect(result.state).toBe('intake')
  const proposals = join(root, '.opencode', 'memory', 'project')
  expect(existsSync(proposals)).toBe(true)
  const entries = readdirSync(proposals)
  expect(entries.length).toBeGreaterThan(0)
  const proposal = JSON.parse(readFileSync(join(proposals, entries[0]), 'utf8'))
  expect(proposal).toMatchObject({ source_run_id: created.run_id, status: 'proposed', version: 1 })
})

test('cancelled runs still require explicit decision and preserve truthful state', async () => {
  const { root, defs } = setup()
  const init = defs.find((d) => d.name === 'supervisor_init_run')!
  const cancel = defs.find((d) => d.name === 'supervisor_cancel_run')!
  const generate = defs.find((d) => d.name === 'supervisor_generate_receipt')!
  const created = parse(await init.execute({ objective: 'cancelled fixture', risk_class: 'low' }))
  await cancel.execute({ run_id: created.run_id, reason: 'fixture cancellation' })
  const refused = parse(await generate.execute({ run_id: created.run_id }))
  expect(refused).toMatchObject({ refused: true, error: expect.stringContaining('memory_decision_required') })
  expect(existsSync(join(root, '.opencode', 'runs', created.run_id, 'receipt.md'))).toBe(false)
  const result = parse(await generate.execute({ run_id: created.run_id, memory_decision: { decision: 'none', rationale: 'Cancelled work produced no reusable lesson' } }))
  expect(result.state).toBe('cancelled')
  expect(result.memory_outcome).toBe('none')
  expect(readFileSync(join(root, '.opencode', 'runs', created.run_id, 'receipt.md'), 'utf8')).toContain('cancelled')
})

test('explicitly disabled project memory records disabled outcome without curator handoff', async () => {
  const { root, defs } = setup()
  mkdirSync(join(root, '.opencode'), { recursive: true })
  writeFileSync(join(root, '.opencode', 'conductor.json'), JSON.stringify({ memory: { enabled: false } }))
  const init = defs.find((d) => d.name === 'supervisor_init_run')!
  const generate = defs.find((d) => d.name === 'supervisor_generate_receipt')!
  const created = parse(await init.execute({ objective: 'disabled memory fixture', risk_class: 'low' }))
  const result = parse(await generate.execute({ run_id: created.run_id }))
  expect(result.memory_outcome).toBe('disabled')
  expect(readFileSync(join(root, '.opencode', 'runs', created.run_id, 'memory-decision.json'), 'utf8')).toContain('"decision": "disabled"')
})

test('cancel cannot bypass a persisted curate handoff by omitting the decision', async () => {
  const { root, defs } = setup()
  const init = defs.find((d) => d.name === 'supervisor_init_run')!
  const cancel = defs.find((d) => d.name === 'supervisor_cancel_run')!
  const generate = defs.find((d) => d.name === 'supervisor_generate_receipt')!
  const created = parse(await init.execute({ objective: 'preserve curator handoff', risk_class: 'low' }))
  const runDir = join(root, '.opencode', 'runs', created.run_id)
  mkdirSync(join(runDir, 'artifacts'), { recursive: true }); writeFileSync(join(runDir, 'artifacts', 'result.txt'), 'evidence')
  const decision = { decision: 'curate', rationale: 'Existing decision requires curator review' }
  expect(recordMemoryDecision(runDir, created.run_id, decision).handoff).toBe(true)
  await cancel.execute({ run_id: created.run_id })
  expect(parse(await generate.execute({ run_id: created.run_id })).closeout).toBe('handoff_required')
  expect(existsSync(join(runDir, 'receipt.md'))).toBe(false)
})

test('curator may record no worthwhile evidence and finalize without inventing a proposal', async () => {
  const { root, defs } = setup()
  const init = defs.find((d) => d.name === 'supervisor_init_run')!
  const generate = defs.find((d) => d.name === 'supervisor_generate_receipt')!
  const created = parse(await init.execute({ objective: 'curator found no lesson', risk_class: 'low' }))
  const runDir = join(root, '.opencode', 'runs', created.run_id)
  const decision = { decision: 'curate', rationale: 'Inspect evidence before deciding whether a proposal is warranted' }
  expect(recordMemoryDecision(runDir, created.run_id, decision).handoff).toBe(true)
  const result = parse(await generate.execute({ run_id: created.run_id, memory_decision: decision, curator_no_learning: 'The artifacts contain no reusable, evidence-supported lesson.' }))
  expect(result).toMatchObject({ state: 'intake', memory_outcome: 'curated_no_learning' })
  expect(existsSync(join(root, '.opencode', 'memory', 'project'))).toBe(false)
  expect(JSON.parse(readFileSync(join(runDir, 'curator-review.json'), 'utf8'))).toMatchObject({ run_id: created.run_id, outcome: 'no_learning' })
})

test('receipt write refuses symlink targets and symlinked run directories without touching outside files', async () => {
  const { root, defs } = setup()
  const init = defs.find((d) => d.name === 'supervisor_init_run')!
  const generate = defs.find((d) => d.name === 'supervisor_generate_receipt')!
  const created = parse(await init.execute({ objective: 'symlink safe receipt', risk_class: 'low' }))
  const runDir = join(root, '.opencode', 'runs', created.run_id)
  const outside = join(root, 'outside.md'); writeFileSync(outside, 'protected')
  symlinkSync(outside, join(runDir, 'receipt.md'))
  await expect(generate.execute({ run_id: created.run_id, memory_decision: { decision: 'none', rationale: 'No lesson' } })).rejects.toThrow('symlink_path_refused')
  expect(readFileSync(outside, 'utf8')).toBe('protected')
  rmSync(join(runDir, 'receipt.md'))
  const savedDir = `${runDir}-saved`; renameSync(runDir, savedDir); symlinkSync(savedDir, runDir)
  await expect(generate.execute({ run_id: created.run_id, memory_decision: { decision: 'none', rationale: 'No lesson' } })).rejects.toThrow('symlink_path_refused')
  expect(existsSync(join(savedDir, 'receipt.md'))).toBe(false)
  expect(readFileSync(outside, 'utf8')).toBe('protected')
})
