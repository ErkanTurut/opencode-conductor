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
export type DagDirection = 'top-bottom' | 'left-right'
export interface DagCamera { x: number; y: number; scale: number }
export interface DagViewport { width: number; height: number }

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

/** Retain geometry identities across status-only polling updates (and keyboard focus). */
export function sameDagLayout(a: DagLayout, b: DagLayout): boolean {
  return a.width === b.width && a.height === b.height && a.nodes.length === b.nodes.length
    && a.nodes.every((node, index) => {
      const next = b.nodes[index]
      return next !== undefined && node.id === next.id && node.x === next.x && node.y === next.y
        && node.width === next.width && node.height === next.height
    })
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
  direction: DagDirection = 'top-bottom',
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

  const unplaced: string[] = []
  for (const id of known) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
    seen.add(id)
    unplaced.push(id)
  }
  if (unplaced.length > 0) {
    rows.push(unplaced)
  }

  const nodes: DagPosition[] = []
  const byId: Record<string, DagPosition> = Object.create(null) as Record<string, DagPosition>
  let width = 0

  rows.forEach((row, layer) => {
    const crossSize = size.nodeWidth
    const rowWidth = row.length * crossSize + Math.max(0, row.length - 1) * size.columnGap
    width = Math.max(width, rowWidth)
    row.forEach((id, column) => {
      const position: DagPosition = {
        id,
        layer,
        column,
        x: direction === 'top-bottom' ? column * (size.nodeWidth + size.columnGap) : layer * (size.nodeWidth + size.layerGap),
        y: direction === 'top-bottom' ? layer * (size.nodeHeight + size.layerGap) : column * (size.nodeHeight + size.columnGap),
        width: size.nodeWidth,
        height: size.nodeHeight,
      }
      nodes.push(position)
      byId[id] = position
    })
  })

  const layerCount = rows.length
  let maxRow = 0
  for (const row of rows) maxRow = Math.max(maxRow, row.length)
  const height = direction === 'top-bottom'
    ? (layerCount === 0 ? 0 : layerCount * size.nodeHeight + (layerCount - 1) * size.layerGap)
    : (maxRow === 0 ? 0 : maxRow * size.nodeHeight + (maxRow - 1) * size.columnGap)
  if (direction === 'left-right') width = layerCount === 0 ? 0 : layerCount * size.nodeWidth + (layerCount - 1) * size.layerGap

  return { nodes, byId, width, height, layerCount, unplaced }
}

/** Edge path with explicit orientation; self and same-layer edges loop outside cards. */
export function dagEdgePath(
  from: DagPosition,
  to: DagPosition,
  direction: DagDirection = 'top-bottom',
  padding = 20,
): string {
  if (from.id === to.id) {
    if (direction === 'left-right') {
      const y = from.y + from.height / 2
      return `M ${round(from.x)} ${round(y)} C ${round(from.x - padding * 2)} ${round(from.y - padding)}, ${round(from.x - padding * 2)} ${round(from.y + from.height + padding)}, ${round(from.x)} ${round(y)}`
    }
    const x = from.x + from.width / 2
    const y = from.y
    return `M ${round(x)} ${round(y)} C ${round(from.x + from.width + padding)} ${round(from.y - padding * 2)}, ${round(from.x - padding)} ${round(from.y - padding * 2)}, ${round(x)} ${round(y)}`
  }
  if (from.layer === to.layer) {
    if (direction === 'left-right') {
      const top = Math.min(from.y, to.y)
      const bottom = Math.max(from.y + from.height, to.y + to.height)
      const x = Math.min(from.x, to.x) - padding
      return `M ${round(from.x)} ${round(from.y + from.height / 2)} C ${round(x)} ${round(top - padding)}, ${round(x)} ${round(bottom + padding)}, ${round(to.x)} ${round(to.y + to.height / 2)}`
    }
    const left = Math.min(from.x, to.x)
    const right = Math.max(from.x + from.width, to.x + to.width)
    const y = Math.min(from.y, to.y) - padding
    return `M ${round(from.x + from.width / 2)} ${round(from.y)} C ${round(left - padding)} ${round(y)}, ${round(right + padding)} ${round(y)}, ${round(to.x + to.width / 2)} ${round(to.y)}`
  }
  if (direction === 'left-right') {
    const forward = to.x >= from.x
    const x1 = forward ? from.x + from.width : from.x
    const y1 = from.y + from.height / 2
    const x2 = forward ? to.x : to.x + to.width
    const y2 = to.y + to.height / 2
    const bend = Math.max(16, Math.abs(x2 - x1) / 2)
    return [`M ${round(x1)} ${round(y1)}`, `C ${round(x1 + (forward ? bend : -bend))} ${round(y1)},`, `${round(x2 - (forward ? bend : -bend))} ${round(y2)},`, `${round(x2)} ${round(y2)}`].join(' ')
  }
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

export function filterDagNodes<T extends { id: string; title?: string; state?: string }>(nodes: readonly T[], query = '', states: readonly string[] = []) {
  const needle = query.trim().toLocaleLowerCase()
  const active = new Set(states)
  const visible = nodes.filter((node) => (!needle || `${node.id} ${node.title ?? ''} ${node.state ?? ''}`.toLocaleLowerCase().includes(needle)) && (active.size === 0 || active.has(node.state ?? 'unknown')))
  return { visible, hiddenCount: nodes.length - visible.length }
}

export function clampDagCamera(camera: DagCamera): DagCamera {
  return { x: Number.isFinite(camera.x) ? camera.x : 0, y: Number.isFinite(camera.y) ? camera.y : 0, scale: Number.isFinite(camera.scale) ? Math.max(0.00001, Math.min(2.5, camera.scale)) : 1 }
}

export function fitDagCamera(viewport: DagViewport, width: number, height: number, padding = 28): DagCamera {
  const usableWidth = Math.max(1, viewport.width - Math.min(padding * 2, viewport.width * 0.5))
  const usableHeight = Math.max(1, viewport.height - Math.min(padding * 2, viewport.height * 0.5))
  const scale = Math.min(1, usableWidth / Math.max(1, width), usableHeight / Math.max(1, height))
  return clampDagCamera({ x: (viewport.width - width * scale) / 2, y: (viewport.height - height * scale) / 2, scale })
}

export function visibleDagPositions(layout: DagLayout, camera: DagCamera, viewport: DagViewport, overscan = 100) {
  const c = clampDagCamera(camera)
  const left = -c.x / c.scale - overscan
  const top = -c.y / c.scale - overscan
  const right = left + viewport.width / c.scale + overscan * 2
  const bottom = top + viewport.height / c.scale + overscan * 2
  return layout.nodes.filter((n) => n.x + n.width >= left && n.x <= right && n.y + n.height >= top && n.y <= bottom)
}
