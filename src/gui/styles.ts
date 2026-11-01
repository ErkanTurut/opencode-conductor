// Self-contained styles for the Conductor side panel.
//
// Neutral `currentColor` mixes keep the panel legible in light and dark
// themes: nothing here paints a hard white or black surface. State accents are
// semantic (state dot, badge border, node rail) and the text of a badge is
// mixed towards `currentColor` so small labels keep their contrast.

export const PANEL_CSS = `
.cdt-root {
  --cdt-canvas-bg: var(--background-base, #f7f8fa);
  --cdt-node-bg: var(--background-raised-base, #ffffff);
  --cdt-border: color-mix(in oklab, currentColor 14%, transparent);
  --cdt-border-strong: color-mix(in oklab, currentColor 26%, transparent);
  --cdt-muted: color-mix(in oklab, currentColor 58%, transparent);
  --cdt-surface: color-mix(in oklab, currentColor 4%, transparent);
  --cdt-surface-strong: color-mix(in oklab, currentColor 8%, transparent);
  --cdt-focus: #3b82f6;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 12px;
  box-sizing: border-box;
  overflow: auto;
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
  color: inherit;
}
.cdt-root[data-color-mode="dark"] { --cdt-canvas-bg: var(--background-base, #191c22); --cdt-node-bg: var(--background-raised-base, #252a32); }
.cdt-root *,
.cdt-root *::before,
.cdt-root *::after {
  box-sizing: border-box;
}
.cdt-root button {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.cdt-root :is(button, [tabindex]):focus-visible {
  outline: 2px solid var(--cdt-focus);
  outline-offset: 2px;
  border-radius: 4px;
}

.cdt-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--cdt-border);
}
.cdt-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.cdt-subtitle {
  color: var(--cdt-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cdt-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.cdt-section + .cdt-section {
  margin-top: 4px;
}
.cdt-heading {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--cdt-muted);
}
.cdt-subheading {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}
.cdt-label {
  display: block;
  margin-top: 2px;
  color: var(--cdt-muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.cdt-muted {
  color: var(--cdt-muted);
}
.cdt-strong {
  font-weight: 600;
}
.cdt-mono {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.95em;
}
.cdt-meta {
  font-size: 11px;
}
.cdt-truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cdt-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.cdt-between {
  justify-content: space-between;
}
.cdt-wrap {
  flex-wrap: wrap;
}
.cdt-grow {
  flex: 1 1 auto;
  min-width: 0;
}

.cdt-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cdt-card {
  padding: 8px 10px;
  border: 1px solid var(--cdt-border);
  border-radius: 8px;
  background: var(--cdt-surface);
}
.cdt-card-tight {
  padding: 6px 8px;
}
.cdt-card + .cdt-card {
  margin-top: 6px;
}

.cdt-badge {
  --cdt-tone: currentColor;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  max-width: 100%;
  padding: 0 6px;
  border: 1px solid color-mix(in oklab, var(--cdt-tone) 38%, transparent);
  border-radius: 999px;
  background: color-mix(in oklab, var(--cdt-tone) 10%, transparent);
  color: color-mix(in oklab, var(--cdt-tone) 55%, currentColor);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  line-height: 16px;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cdt-badge[data-tone="pending"] { --cdt-tone: #9ca3af; }
.cdt-badge[data-tone="ready"] { --cdt-tone: #3b82f6; }
.cdt-badge[data-tone="running"] { --cdt-tone: #f59e0b; }
.cdt-badge[data-tone="completed"] { --cdt-tone: #10b981; }
.cdt-badge[data-tone="failed"] { --cdt-tone: #ef4444; }
.cdt-badge[data-tone="blocked"] { --cdt-tone: #8b5cf6; }
.cdt-badge[data-tone="unknown"] { --cdt-tone: #9ca3af; }

.cdt-dot {
  --cdt-tone: currentColor;
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cdt-tone);
}
.cdt-dot[data-tone="pending"] { --cdt-tone: #9ca3af; }
.cdt-dot[data-tone="ready"] { --cdt-tone: #3b82f6; }
.cdt-dot[data-tone="running"] { --cdt-tone: #f59e0b; }
.cdt-dot[data-tone="completed"] { --cdt-tone: #10b981; }
.cdt-dot[data-tone="failed"] { --cdt-tone: #ef4444; }
.cdt-dot[data-tone="blocked"] { --cdt-tone: #8b5cf6; }
.cdt-dot[data-tone="unknown"] { --cdt-tone: #9ca3af; }

.cdt-empty {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 12px;
  border: 1px dashed var(--cdt-border);
  border-radius: 8px;
  text-align: center;
}
.cdt-empty-title {
  font-weight: 600;
}
.cdt-empty-body {
  color: var(--cdt-muted);
  font-size: 11px;
}

.cdt-error {
  padding: 6px 8px;
  border: 1px solid color-mix(in oklab, #ef4444 40%, transparent);
  border-radius: 6px;
  background: color-mix(in oklab, #ef4444 9%, transparent);
  color: color-mix(in oklab, #ef4444 45%, currentColor);
  font-size: 11px;
}
.cdt-error-detail {
  color: var(--cdt-muted);
}

.cdt-run {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--cdt-border);
  border-radius: 8px;
  background: var(--cdt-surface);
  transition: border-color 120ms ease, background-color 120ms ease;
}
.cdt-run:hover {
  border-color: var(--cdt-border-strong);
  background: var(--cdt-surface-strong);
}
.cdt-run[aria-pressed="true"] {
  border-color: color-mix(in oklab, currentColor 42%, transparent);
  background: var(--cdt-surface-strong);
}
.cdt-run-objective {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-weight: 600;
  line-height: 1.35;
}

.cdt-progress {
  display: block;
  width: 100%;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklab, currentColor 12%, transparent);
}
.cdt-progress > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: color-mix(in oklab, currentColor 55%, transparent);
}

.cdt-dag-canvas {
  overflow: auto;
  max-height: 46vh;
  border: 1px solid var(--cdt-border);
  border-radius: 8px;
  background:
    radial-gradient(circle at 1px 1px, color-mix(in oklab, currentColor 10%, transparent) 1px, transparent 0)
    0 0 / 14px 14px;
}
.cdt-dag-inner {
  position: relative;
  min-width: 100%;
}
.cdt-dag-edges {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}
.cdt-dag-edge {
  fill: none;
  stroke: color-mix(in oklab, currentColor 28%, transparent);
  stroke-width: 1.5;
}
.cdt-dag-edge[data-resolved="false"] {
  stroke-dasharray: 4 4;
}
.cdt-dag-node {
  --cdt-tone: #9ca3af;
  position: absolute;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  padding: 4px 7px 4px 9px;
  overflow: hidden;
  border: 1px solid var(--cdt-border);
  border-left: 3px solid var(--cdt-tone);
  border-radius: 6px;
  background: color-mix(in oklab, currentColor 4%, transparent);
  transition: background-color 120ms ease, border-color 120ms ease;
}
.cdt-dag-node:hover {
  background: var(--cdt-surface-strong);
}
.cdt-dag-node[aria-pressed="true"] {
  border-color: color-mix(in oklab, var(--cdt-tone) 60%, var(--cdt-border));
  background: var(--cdt-surface-strong);
}
.cdt-dag-node[data-ghost="true"] {
  border-style: dashed;
  border-left-style: solid;
  opacity: 0.72;
}
.cdt-dag-node[data-tone="pending"] { --cdt-tone: #9ca3af; }
.cdt-dag-node[data-tone="ready"] { --cdt-tone: #3b82f6; }
.cdt-dag-node[data-tone="running"] { --cdt-tone: #f59e0b; }
.cdt-dag-node[data-tone="completed"] { --cdt-tone: #10b981; }
.cdt-dag-node[data-tone="failed"] { --cdt-tone: #ef4444; }
.cdt-dag-node[data-tone="blocked"] { --cdt-tone: #8b5cf6; }
.cdt-dag-node[data-tone="unknown"] { --cdt-tone: #9ca3af; }
.cdt-dag-title {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
}
.cdt-dag-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--cdt-muted);
  font-size: 10px;
}

.cdt-kv {
  display: grid;
  grid-template-columns: minmax(76px, auto) minmax(0, 1fr);
  gap: 2px 10px;
  margin: 6px 0 0;
}
.cdt-kv > dt {
  color: var(--cdt-muted);
  font-size: 11px;
}
.cdt-kv > dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 11px;
}

.cdt-chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 0 5px;
  border: 1px solid var(--cdt-border);
  border-radius: 4px;
  background: var(--cdt-surface);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 10px;
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cdt-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.cdt-verify {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 0;
  border-top: 1px solid var(--cdt-border);
}
.cdt-verify:first-child {
  border-top: 0;
  padding-top: 0;
}
.cdt-command {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
}
.cdt-finding {
  padding: 6px 8px;
  border: 1px solid var(--cdt-border);
  border-radius: 6px;
  background: color-mix(in oklab, currentColor 2%, transparent);
}
.cdt-finding[data-blocking="true"] {
  border-color: color-mix(in oklab, #ef4444 45%, transparent);
}
.cdt-finding + .cdt-finding {
  margin-top: 4px;
}
.cdt-evidence,
.cdt-required {
  margin: 3px 0 0;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.cdt-required {
  color: color-mix(in oklab, #f59e0b 45%, currentColor);
}

.cdt-pre {
  max-height: 280px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  border: 1px solid var(--cdt-border);
  border-radius: 6px;
  background: var(--cdt-surface);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.cdt-qa {
  padding: 6px 8px;
  border-left: 2px solid var(--cdt-border-strong);
}
.cdt-qa-question {
  font-weight: 600;
  font-size: 11px;
}
.cdt-qa-answer {
  margin: 2px 0 0;
  color: var(--cdt-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.cdt-memory {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--cdt-border);
  border-radius: 8px;
  background: var(--cdt-surface);
  transition: background-color 120ms ease, border-color 120ms ease;
}
.cdt-memory:hover {
  background: var(--cdt-surface-strong);
  border-color: var(--cdt-border-strong);
}
.cdt-memory[aria-expanded="true"] {
  border-color: color-mix(in oklab, currentColor 38%, transparent);
}
.cdt-memory-preview {
  color: var(--cdt-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cdt-memory-content {
  margin-top: 6px;
}

.cdt-event {
  display: flex;
  gap: 8px;
  padding: 5px 0;
  border-top: 1px solid var(--cdt-border);
}
.cdt-event:first-child {
  border-top: 0;
}
.cdt-event-seq {
  flex: 0 0 auto;
  min-width: 26px;
  color: var(--cdt-muted);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 10px;
  text-align: right;
}
.cdt-event-body {
  min-width: 0;
  flex: 1 1 auto;
}
.cdt-event-summary {
  margin: 1px 0 0;
  color: var(--cdt-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.cdt-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .cdt-root * {
    transition: none !important;
  }
}
`

export const RUNS_CSS = `
.cdt-root { container-type: inline-size; }
.cdt-run-counts { display:flex; flex-wrap:wrap; gap:8px 20px; padding:8px 0; border-bottom:1px solid var(--cdt-border); }
.cdt-run-counts strong { font-size:16px; margin-right:3px; }
.cdt-run-toolbar { display:flex; flex-wrap:wrap; align-items:end; gap:8px 12px; }
.cdt-run-toolbar label { display:flex; flex-direction:column; gap:3px; color:var(--cdt-muted); }
.cdt-run-toolbar input,.cdt-run-toolbar select { color:inherit; font:inherit; background:var(--cdt-surface); border:1px solid var(--cdt-border-strong); border-radius:4px; padding:5px 7px; max-width:100%; }
.cdt-root :is(input,select):focus-visible { outline:2px solid var(--cdt-focus); outline-offset:2px; }
.cdt-run-switch { display:flex; gap:2px; border-bottom:1px solid var(--cdt-border); }
.cdt-root .cdt-run-switch button { padding:6px 9px; border-bottom:2px solid transparent; }
.cdt-root .cdt-run-switch button[aria-pressed=true] { border-color:currentColor; font-weight:600; }
.cdt-table-scroll { max-width:100%; overflow-x:auto; }
.cdt-run-table { width:100%; min-width:764px; border-collapse:collapse; table-layout:fixed; text-align:left; }
.cdt-run-table th,.cdt-run-table td { padding:8px; border-bottom:1px solid var(--cdt-border); vertical-align:top; }
.cdt-run-table th { color:var(--cdt-muted); font-weight:600; }
.cdt-run-table th:nth-child(1),.cdt-run-table td:nth-child(1) { width:270px; }
.cdt-run-table th:nth-child(2),.cdt-run-table td:nth-child(2) { width:155px; }
.cdt-run-table th:nth-child(3),.cdt-run-table td:nth-child(3) { width:72px; }
.cdt-run-table th:nth-child(4),.cdt-run-table td:nth-child(4) { width:175px; }
.cdt-run-table th:nth-child(5),.cdt-run-table td:nth-child(5) { width:92px; white-space:nowrap; }
.cdt-run-table td:nth-child(4) { overflow-wrap:anywhere; }
.cdt-run-table td:first-child { overflow-wrap:anywhere; }
.cdt-root .cdt-run-link { font-weight:600; text-decoration:underline; text-underline-offset:3px; }
.cdt-root .cdt-more,.cdt-root .cdt-back { padding:6px 9px; border:1px solid var(--cdt-border-strong); border-radius:4px; align-self:start; }
.cdt-root .cdt-more:disabled { opacity:.6; cursor:default; }
.cdt-root p { margin:0; }
@container (max-width: 420px) { .cdt-run-toolbar label { flex:1 1 130px; } }
`
