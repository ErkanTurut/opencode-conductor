import { describe, expect, it } from 'bun:test'
import { buildDagLayout, dagEdgePath, DAG_METRICS, filterDagNodes, fitDagCamera, clampDagCamera, visibleDagPositions } from '../../src/gui/dag-layout'

describe('gui DAG layout', () => {
  it('places each layer in a row and keeps known unplaced ids', () => {
    const layout = buildDagLayout([['a', 'b'], ['c']], ['a', 'b', 'c', 'orphan'])
    expect(layout.layerCount).toBe(3)
    expect(layout.byId.a.x).toBe(0)
    expect(layout.byId.b.x).toBe(DAG_METRICS.nodeWidth + DAG_METRICS.columnGap)
    expect(layout.byId.c.y).toBe(DAG_METRICS.nodeHeight + DAG_METRICS.layerGap)
    expect(layout.unplaced).toEqual(['orphan'])
    expect(layout.byId.orphan.layer).toBe(2)
  })

  it('deduplicates ids across and within layers', () => {
    const layout = buildDagLayout([['a', 'a'], ['a', 'b']], ['a', 'b'])
    expect(layout.nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(layout.layerCount).toBe(2)
  })

  it('handles empty and malformed layers', () => {
    expect(buildDagLayout(null).nodes).toEqual([])
    expect(buildDagLayout([]).layerCount).toBe(0)
    expect(buildDagLayout([[], ['']]).nodes).toEqual([])
  })

  it('draws a cubic edge between node centres', () => {
    const from = { id: 'from', layer: 0, column: 0, x: 0, y: 0, width: 100, height: 40 }
    const to = { id: 'to', layer: 1, column: 0, x: 0, y: 80, width: 100, height: 40 }
    const path = dagEdgePath(from, to)
    expect(path).toContain('M 50 40')
    expect(path).toContain('C')
    expect(path).toContain('50 80')
  })

  it('handles prototype-like ids safely and deduplicates known ids', () => {
    const layout = buildDagLayout([['__proto__', 'constructor'], ['constructor']], ['__proto__', 'constructor', 'toString', 'toString'])
    expect(layout.nodes.map((n) => n.id)).toEqual(['__proto__', 'constructor', 'toString'])
    expect(layout.byId.__proto__.id).toBe('__proto__')
  })

  it('keeps large deep and wide graphs finite', () => {
    const layers = Array.from({ length: 1001 }, (_, i) => [`n${i}`])
    const deep = buildDagLayout(layers)
    const wide = buildDagLayout([Array.from({ length: 1001 }, (_, i) => `w${i}`)])
    expect(deep.height).toBeLessThan(200000)
    expect(wide.width).toBeLessThan(200000)
    expect([...deep.nodes, ...wide.nodes].every((n) => Number.isFinite(n.x + n.y))).toBe(true)
  })

  it('supports orientation, filtering, camera fit, and viewport culling', () => {
    const horizontal = buildDagLayout([['a', 'b'], ['c']], [], {}, 'left-right')
    expect(horizontal.byId.a.width).toBe(DAG_METRICS.nodeWidth)
    expect(horizontal.byId.a.height).toBe(DAG_METRICS.nodeHeight)
    expect(horizontal.byId.c.x).toBeGreaterThan(horizontal.byId.a.x)
    expect(horizontal.byId.b.y).toBeGreaterThan(horizontal.byId.a.y)
    expect(horizontal.width).toBeGreaterThan(horizontal.byId.c.x + horizontal.byId.c.width - 1)
    expect(horizontal.height).toBeGreaterThan(horizontal.byId.b.y + horizontal.byId.b.height - 1)
    expect(filterDagNodes([{ id: 'a', title: 'Alpha', state: 'ready' }, { id: 'b', state: 'done' }], 'alpha').hiddenCount).toBe(1)
    expect(fitDagCamera({ width: 250, height: 120 }, 10000, 10000).scale).toBeGreaterThan(0)
    expect(clampDagCamera({ x: NaN, y: Infinity, scale: NaN })).toEqual({ x: 0, y: 0, scale: 1 })
    expect(visibleDagPositions(horizontal, { x: 0, y: 0, scale: 1 }, { width: 100, height: 100 }).length).toBeGreaterThan(0)
    expect(visibleDagPositions(horizontal, { x: -10000, y: -10000, scale: 1 }, { width: 100, height: 100 })).toEqual([])
    const tinyFit = fitDagCamera({ width: 10, height: 10 }, 10000, 10000)
    expect(tinyFit.scale).toBeGreaterThan(0)
    expect(tinyFit.scale * 10000).toBeLessThanOrEqual(10)
    const deepFit = fitDagCamera({ width: 300, height: 300 }, 168, 99_964)
    expect(deepFit.scale * 99_964).toBeLessThanOrEqual(300)
  })

  it('routes self and same-layer cycles around nodes with finite explicit direction', () => {
    const layout = buildDagLayout([['a', 'b']], [], {}, 'left-right')
    const self = dagEdgePath(layout.byId.a, layout.byId.a, 'left-right')
    const sameLayer = dagEdgePath(layout.byId.a, layout.byId.b, 'left-right')
    expect(self).toContain('C')
    expect(sameLayer).toContain('C')
    expect([...self.matchAll(/-?\d+(?:\.\d+)?/g), ...sameLayer.matchAll(/-?\d+(?:\.\d+)?/g)].every(([value]) => Number.isFinite(Number(value)))).toBe(true)
  })
})
