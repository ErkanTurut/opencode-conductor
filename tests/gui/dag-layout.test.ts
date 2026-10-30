import { describe, expect, it } from 'bun:test'
import { buildDagLayout, dagEdgePath, DAG_METRICS } from '../../src/gui/dag-layout'

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
})
