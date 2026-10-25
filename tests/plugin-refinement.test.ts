import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import type { SupervisorTool } from '../src/plugin'
import supervisorPlugin, { SupervisorPlugin } from '../src/plugin'

const repoRoot = `/tmp/opencode-conductor-test/refinement-${Date.now()}`

describe('Requirements refinement gate (plugin)', () => {
  let tools: Record<string, SupervisorTool>

  beforeAll(async () => {
    await Bun.$`mkdir -p ${repoRoot}/.opencode`.quiet()
    const plugin = await SupervisorPlugin({ directory: repoRoot, $: Bun.$ })
    tools = plugin.tool
  })

  afterAll(async () => {
    await Bun.$`rm -rf ${repoRoot}`.quiet()
  })

  it('keeps the auto-discovery default export as the runtime plugin object', () => {
    expect(supervisorPlugin.id).toBe('supervisor')
    expect(typeof supervisorPlugin.setup).toBe('function')
  })

  it('parks an under-specified run in awaiting_refinement via init uncertainties', async () => {
    const init = JSON.parse(
      await tools.supervisor_init_run.execute({
        objective: 'make onboarding better',
        risk_class: 'low',
        uncertainties: ['no success criteria', 'unknown target users'],
      }),
    )
    expect(init.state).toBe('awaiting_refinement')
  })

  it('keeps the run parked on request_refinement', async () => {
    const init = JSON.parse(
      await tools.supervisor_init_run.execute({
        objective: 'vague request',
        risk_class: 'low',
        uncertainties: ['vague objective'],
      }),
    )
    const req = JSON.parse(
      await tools.supervisor_request_refinement.execute({
        run_id: init.run_id,
        uncertainties: ['vague objective'],
      }),
    )
    expect(req.state).toBe('awaiting_refinement')
  })

  it('records refined requirements and resumes the run to discovered', async () => {
    const init = JSON.parse(
      await tools.supervisor_init_run.execute({
        objective: 'make onboarding better',
        risk_class: 'low',
        uncertainties: ['no success criteria'],
      }),
    )
    const rec = JSON.parse(
      await tools.supervisor_record_requirements.execute({
        run_id: init.run_id,
        objective: 'Reduce onboarding drop-off with a guided first-run setup',
        non_goals: ['Auto-detection of user skill level'],
        acceptance_criteria: [
          'New users complete setup in under 90 seconds',
          'Setup completion rate >= 80%',
        ],
        risk_class: 'medium',
        constraints: ['No new dependencies'],
        qa_pairs: [{ q: 'target users', a: 'new SME signups' }],
        outcome: 'completed',
      }),
    )
    expect(rec.state).toBe('discovered')
    expect(rec.recorded).toBe(true)

    const proj = JSON.parse(
      await Bun.file(`${repoRoot}/.opencode/runs/${init.run_id}/run.json`).text(),
    )
    expect(proj.state).toBe('discovered')
    expect(proj.contract.objective).toContain('guided first-run setup')
    expect(proj.contract.refinement.outcome).toBe('completed')
  })

  it('records a declined refinement as-is', async () => {
    const init = JSON.parse(
      await tools.supervisor_init_run.execute({
        objective: 'make it shinier',
        risk_class: 'low',
        uncertainties: ['vague objective'],
      }),
    )
    const decl = JSON.parse(
      await tools.supervisor_record_requirements.execute({
        run_id: init.run_id,
        objective: 'make it shinier (as-is)',
        non_goals: [],
        acceptance_criteria: ['User-visible polish pass on main pages'],
        risk_class: 'low',
        outcome: 'declined',
      }),
    )
    expect(decl.state).toBe('discovered')
    const proj = JSON.parse(
      await Bun.file(`${repoRoot}/.opencode/runs/${init.run_id}/run.json`).text(),
    )
    expect(proj.contract.refinement.outcome).toBe('declined')
  })

  it('rejects recording requirements once the run has progressed', async () => {
    const init = JSON.parse(
      await tools.supervisor_init_run.execute({
        objective: 'vague request',
        risk_class: 'low',
        uncertainties: ['vague objective'],
      }),
    )
    await tools.supervisor_record_requirements.execute({
      run_id: init.run_id,
      objective: 'refined objective',
      acceptance_criteria: ['a', 'b'],
      risk_class: 'medium',
      outcome: 'completed',
    })
    const second = JSON.parse(
      await tools.supervisor_record_requirements.execute({
        run_id: init.run_id,
        objective: 'another objective',
        acceptance_criteria: ['c'],
        risk_class: 'low',
        outcome: 'completed',
      }),
    )
    expect(second.recorded).toBeUndefined()
    expect(second.error).toContain('Cannot record requirements from state discovered')
  })
})
