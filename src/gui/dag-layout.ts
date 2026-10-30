// Deterministic DAG geometry for the side panel.
//
// The view renders the nodes as absolutely positioned HTML buttons and draws
// the edges in an SVG overlay. Because the geometry is computed instead of
// measured, it is testable without a DOM and does not shift when the panel is
// resized.

export interface DagLayoutMetrics {
  nodeWidth: number
  nodeHeight: number
  columnGap: number
  layerGap: number
}

export interface DagPosition {
  id: string
  layer: number
  column: number
  x: number
  y: number
  width: number
  height: number
}

export interface DagLayout {
  nodes: DagPosition[]
  byId: Record<string, DagPosition>
  width: number
  height: number
  layerCount: number
  /** Known ids that no layer listed, rendered in a final row. */
  unplaced: string[]
}

export const DAG_METRICS: DagLayoutMetrics = {
  nodeWidth: 168,
  nodeHeight: 46,
  columnGap: 12,
  layerGap: 36,
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Place each layer in its own row. Nodes in a layer sit side by side, so the
 * graph grows downwards and can scroll horizontally when a layer is wide.
 * Ids repeated across layers, or repeated inside one layer, are placed once.
 */
export function buildDagLayout(
  layers: readonly (readonly string[])[] | null | undefined,
  known: readonly string[] = [],
  metrics: Partial<DagLayoutMetrics> = {},
): DagLayout {
  const size: DagLayoutMetrics = {
    nodeWidth: positive(metrics.nodeWidth, DAG_METRICS.nodeWidth),
    nodeHeight: positive(metrics.nodeHeight, DAG_METRICS.nodeHeight),
    columnGap: positive(metrics.columnGap, DAG_METRICS.columnGap),
    layerGap: positive(metrics.layerGap, DAG_METRICS.layerGap),
  }

  const seen = new Set<string>()
  const rows: string[][] = []
  for (const layer of Array.isArray(layers) ? layers : []) {
    const row: string[] = []
    for (const id of Array.isArray(layer) ? layer : []) {
      if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
      seen.add(id)
      row.push(id)
    }
    if (row.length > 0) rows.push(row)
  }

  const unplaced = known.filter((id) => typeof id === 'string' && id.length > 0 && !seen.has(id))
  if (unplaced.length > 0) {
    rows.push(unplaced)
    for (const id of unplaced) seen.add(id)
  }

  const nodes: DagPosition[] = []
  const byId: Record<string, DagPosition> = {}
  let width = 0

  rows.forEach((row, layer) => {
    const rowWidth = row.length * size.nodeWidth + Math.max(0, row.length - 1) * size.columnGap
    width = Math.max(width, rowWidth)
    row.forEach((id, column) => {
      const position: DagPosition = {
        id,
        layer,
        column,
        x: column * (size.nodeWidth + size.columnGap),
        y: layer * (size.nodeHeight + size.layerGap),
        width: size.nodeWidth,
        height: size.nodeHeight,
      }
      nodes.push(position)
      byId[id] = position
    })
  })

  const layerCount = rows.length
  const height = layerCount === 0 ? 0 : layerCount * size.nodeHeight + (layerCount - 1) * size.layerGap

  return { nodes, byId, width, height, layerCount, unplaced }
}

/** Cubic path from the bottom centre of `from` to the top centre of `to`. */
export function dagEdgePath(from: DagPosition, to: DagPosition): string {
  const x1 = from.x + from.width / 2
  const y1 = from.y + from.height
  const x2 = to.x + to.width / 2
  const y2 = to.y
  const bend = Math.max(16, Math.abs(y2 - y1) / 2)
  return [
    `M ${round(x1)} ${round(y1)}`,
    `C ${round(x1)} ${round(y1 + bend)},`,
    `${round(x2)} ${round(y2 - bend)},`,
    `${round(x2)} ${round(y2)}`,
  ].join(' ')
}
