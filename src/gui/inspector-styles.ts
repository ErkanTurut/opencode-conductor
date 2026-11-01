/** Compact inspectors and configuration forms using the panel's theme tokens. */
export const INSPECTOR_CSS = `
.cdt-inspector-layout { display:flex; gap:12px; flex-wrap:wrap; min-width:0; }
.cdt-inspector-nav { display:flex; flex-direction:column; flex:1 1 130px; min-width:110px; max-width:210px; max-height:320px; overflow:auto; border:1px solid var(--cdt-border); border-radius:5px; }
.cdt-root .cdt-inspector-nav button { padding:6px 8px; overflow-wrap:anywhere; border-left:2px solid transparent; }
.cdt-root .cdt-inspector-nav button:hover { background:var(--cdt-surface-strong); }
.cdt-root .cdt-inspector-nav button[aria-pressed="true"] { border-left-color:currentColor; background:var(--cdt-surface-strong); font-weight:600; }
.cdt-inspector-detail { display:flex; flex-direction:column; gap:8px; flex:3 1 300px; min-width:0; }
.cdt-inspector-scroll { max-width:100%; overflow-x:auto; }
.cdt-inspector-table { width:100%; min-width:320px; border-collapse:collapse; text-align:left; }
.cdt-inspector-table :is(th,td) { border-bottom:1px solid var(--cdt-border); padding:6px 8px; vertical-align:top; overflow-wrap:anywhere; }
.cdt-inspector-table th { color:var(--cdt-muted); font-weight:600; }
.cdt-inspector-table th[scope=row] { min-width:105px; }
.cdt-inspector-note { margin:0; padding:8px; border-left:2px solid var(--cdt-border-strong); background:var(--cdt-surface); overflow-wrap:anywhere; }
.cdt-inspector-note p { margin:4px 0 0; }
.cdt-inspector-note ul { margin:4px 0 0; padding-left:20px; }
.cdt-inspector-disclosure { border-top:1px solid var(--cdt-border); padding:8px 0; min-width:0; }
.cdt-inspector-disclosure summary { cursor:pointer; font-weight:600; }
.cdt-inspector-disclosure summary:focus-visible { outline:2px solid var(--cdt-focus); outline-offset:2px; }
.cdt-inspector-disclosure .cdt-pre { margin:8px 0; }
.cdt-inspector-list,.cdt-inspector-sequence { margin:0; padding-left:20px; overflow-wrap:anywhere; }
.cdt-inspector-list li,.cdt-inspector-sequence li { padding:2px 0; }
.cdt-inspector-review { margin:6px 0; padding:6px 8px; border-left:2px solid var(--cdt-border-strong); overflow-wrap:anywhere; }
.cdt-inspector-review p { margin:3px 0; }
.cdt-skill-rule { display:flex; flex-wrap:wrap; gap:8px; align-items:end; margin:8px 0; min-width:0; }
.cdt-skill-rule label { display:flex; flex:1 1 130px; flex-direction:column; min-width:0; gap:4px; font-weight:600; }
.cdt-skill-rule :is(input,select) { width:100%; min-width:0; padding:6px 8px; color:inherit; font:inherit; background:var(--cdt-surface); border:1px solid var(--cdt-border-strong); border-radius:4px; }
.cdt-skill-rule :is(input,select):focus-visible { outline:2px solid var(--cdt-focus); outline-offset:2px; }
.cdt-editor-fieldset { border:0; margin:0; padding:0; min-width:0; }
.cdt-agent-draft > p { margin:8px 0; }
.cdt-agent-draft > .cdt-row select { color:inherit; font:inherit; background:var(--cdt-surface); border:1px solid var(--cdt-border-strong); border-radius:4px; padding:5px 8px; }
.cdt-agent-draft > .cdt-row select:focus-visible { outline:2px solid var(--cdt-focus); outline-offset:2px; }
.cdt-draft-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr)); gap:10px; margin:10px 0; min-width:0; }
.cdt-draft-fields label { display:flex; flex-direction:column; gap:4px; min-width:0; font-weight:600; }
.cdt-draft-fields :is(input,select,textarea) { width:100%; min-width:0; padding:6px 8px; color:inherit; font:inherit; font-weight:400; background:var(--cdt-surface); border:1px solid var(--cdt-border-strong); border-radius:4px; }
.cdt-draft-fields textarea { resize:vertical; }
.cdt-draft-fields select:disabled { opacity:.65; }
.cdt-draft-fields :is(input,select,textarea):focus-visible { outline:2px solid var(--cdt-focus); outline-offset:2px; }
.cdt-draft-fields label span { font-weight:400; }
`
