// Single-page fleet dashboard served at GET /.
//
// Fully offline vanilla HTML/CSS/JS embedded as one template string:
// no framework, no build step, no CDN assets. The page talks to the
// REST API under /api/fleet via fetch. NOTE: keep `${` and backticks
// out of the client code below — it lives inside this template literal.

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fleet Manager</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif; background: #f5f6f8; color: #1c2430; }
  header { position: sticky; top: 0; z-index: 2; background: #fff; border-bottom: 1px solid #dde3ea; padding: 12px 20px; display: flex; align-items: baseline; gap: 14px; }
  h1 { font-size: 17px; margin: 0; }
  header .sub { color: #66707d; font-size: 12px; }
  main { padding: 18px 20px 60px; max-width: 1240px; margin: 0 auto; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .07em; color: #5a6572; margin: 24px 0 10px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dde3ea; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #edf0f4; vertical-align: middle; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #5a6572; background: #fafbfc; }
  tr:last-child td { border-bottom: none; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .muted { color: #7a8492; }
  .variant-tag { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: #eef2ff; color: #4353b0; font-size: 11px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .badge.ok { background: #e5f6ec; color: #176c3a; }
  .badge.warn { background: #fdf3dc; color: #8a5b00; }
  .badge.open { background: #fdeaea; color: #a02c2c; }
  .suit { font-size: 11px; color: #57616e; }
  .role-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
  .role-card { background: #fff; border: 1px solid #dde3ea; border-radius: 8px; padding: 12px; }
  .role-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .role-head strong { font-size: 13px; }
  .src { margin-left: auto; font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; }
  .src.role-override { background: #efe9fd; color: #5b34b1; }
  .src.slot-default { background: #e3f2fd; color: #1565c0; }
  .src.scored { background: #eef1f4; color: #5a6572; }
  .eff { margin: 8px 0; font-size: 12px; color: #33404e; overflow-wrap: anywhere; }
  .eff.none { color: #a3adb9; font-style: italic; }
  .controls { display: flex; gap: 8px; }
  .controls select { flex: 1; min-width: 0; }
  select, input[type="number"], button { font: inherit; padding: 6px 8px; border: 1px solid #c9d1da; border-radius: 6px; background: #fff; color: inherit; }
  input[type="number"] { width: 92px; }
  button { cursor: pointer; background: #2456d6; border-color: #2456d6; color: #fff; font-weight: 600; }
  button:hover { background: #1c47b5; }
  .ovr { margin-top: 8px; font-size: 11px; overflow-wrap: anywhere; }
  .toast { position: fixed; right: 18px; bottom: 18px; max-width: 440px; padding: 10px 14px; border-radius: 8px; background: #1c2430; color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.25); opacity: 0; pointer-events: none; transition: opacity .15s ease; font-size: 13px; }
  .toast.show { opacity: 1; }
  .toast.error { background: #8f2424; }
  footer { margin-top: 26px; font-size: 11px; color: #8b95a1; word-break: break-all; }
</style>
</head>
<body>
<header><h1>Fleet Manager</h1><span class="sub" id="summary">loading&hellip;</span></header>
<main>
  <h2>Models</h2>
  <table>
    <thead><tr>
      <th>Model</th><th>Provider</th><th>Family</th>
      <th class="num">Context</th><th class="num">Cost / 1k</th>
      <th>Suitability</th><th>Circuit</th><th>Enabled</th>
    </tr></thead>
    <tbody id="fleet-body"></tbody>
  </table>
  <h2>Agent Roles</h2>
  <div id="roles" class="role-grid"></div>
  <footer id="footer"></footer>
</main>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>
(function () {
  'use strict';
  var SUIT_ORDER = ['fast-triage', 'architecture', 'implementation', 'ui-visual', 'testing', 'critique', 'security', 'integration'];
  var SUIT_ABBR = { 'fast-triage': 'triage', architecture: 'arch', implementation: 'impl', 'ui-visual': 'ui', testing: 'test', critique: 'crit', security: 'sec', integration: 'intg' };
  var state = null;
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(message, isError) {
    var el = $('toast');
    el.textContent = message;
    el.className = 'toast show' + (isError ? ' error' : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 3500);
  }

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(
        function (data) { return { ok: res.ok, status: res.status, data: data }; },
        function () { return { ok: res.ok, status: res.status, data: {} }; }
      );
    });
  }

  function fmtContext(n) { return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n); }
  function fmtCost(cost) {
    if (cost === null || cost === undefined) return '\\u2014';
    return '$' + cost;
  }
  function suitText(suit) {
    var parts = [];
    for (var i = 0; i < SUIT_ORDER.length; i++) {
      var slot = SUIT_ORDER[i];
      if (suit[slot] !== undefined) parts.push(SUIT_ABBR[slot] + ' ' + suit[slot]);
    }
    return parts.length ? parts.join(' \\u00b7 ') : '\\u2014';
  }
  function circuitBadge(m) {
    if (m.circuitBreakerOpen) return '<span class="badge open">OPEN \\u00d7' + m.consecutiveFailures + '</span>';
    if (!m.healthy) return '<span class="badge warn">unhealthy \\u00d7' + m.consecutiveFailures + '</span>';
    return '<span class="badge ok">healthy</span>';
  }

  function selectOptions(roleView) {
    var chosen = roleView.roleOverride ? roleView.roleOverride.modelRef : '';
    var groups = {};
    var chosenSeen = chosen === '';
    state.models.forEach(function (m) {
      if (!m.enabled) return;
      if (!groups[m.providerId]) groups[m.providerId] = [];
      groups[m.providerId].push(m);
      if (m.id === chosen) chosenSeen = true;
    });
    var out = ['<option value="">default</option>'];
    Object.keys(groups).sort().forEach(function (provider) {
      var opts = groups[provider].map(function (m) {
        return '<option value="' + esc(m.id) + '"' + (m.id === chosen ? ' selected' : '') + '>' +
          esc(m.id) + (m.variant ? ' (' + esc(m.variant) + ')' : '') + '</option>';
      }).join('');
      out.push('<optgroup label="' + esc(provider) + '">' + opts + '</optgroup>');
    });
    if (!chosenSeen && chosen) {
      out.push('<option value="' + esc(chosen) + '" selected>' + esc(chosen) + ' (disabled)</option>');
    }
    return out.join('');
  }

  function render() {
    $('summary').textContent = state.models.length + ' models \\u00b7 ' + Object.keys(state.roles).length + ' agent roles';
    $('footer').textContent = 'config: ' + (state.configPath || '?');

    var rows = state.models.map(function (m) {
      var variant = m.variant ? '<span class="variant-tag">' + esc(m.variant) + '</span>' : '';
      var suit = suitText(m.roleSuitability);
      return '<tr>' +
        '<td class="mono">' + esc(m.id) + variant + '</td>' +
        '<td>' + esc(m.providerId) + '</td>' +
        '<td>' + esc(m.family) + '</td>' +
        '<td class="num mono">' + fmtContext(m.contextLimit) + '</td>' +
        '<td class="num mono">' + esc(fmtCost(m.costPer1kTokens)) + '</td>' +
        '<td><span class="suit mono" title="' + esc(suit) + '">' + esc(suit) + '</span></td>' +
        '<td>' + circuitBadge(m) + '</td>' +
        '<td><input type="checkbox" data-kind="toggle" data-model="' + esc(m.id) + '"' +
          (m.enabled ? ' checked' : '') + ' aria-label="Enable ' + esc(m.id) + '"></td>' +
        '</tr>';
    });
    $('fleet-body').innerHTML = rows.join('');

    var cards = [];
    Object.keys(state.roles).forEach(function (role) {
      var r = state.roles[role];
      var effHtml;
      if (r.effective) {
        effHtml = '\\u2192 <span class="mono">' + esc(r.effective.key) + '</span>' +
          (r.effective.variant ? '<span class="variant-tag">' + esc(r.effective.variant) + '</span>' : '') +
          ' <span class="muted">via ' + esc(r.source) + '</span>';
      } else {
        effHtml = '\\u2192 no eligible model';
      }
      var bits = [
        'override: ' + (r.roleOverride ? esc(r.roleOverride.modelRef) +
          (r.roleOverride.variant ? ' (' + esc(r.roleOverride.variant) + ')' : '') : 'none'),
        'steps: ' + (r.stepsOverride === null || r.stepsOverride === undefined ? 'agent default' : r.stepsOverride),
        'slot default: ' + (r.slotDefault ? esc(r.slotDefault.modelRef) +
          (r.slotDefault.variant ? ' (' + esc(r.slotDefault.variant) + ')' : '') : 'none')
      ];
      cards.push('<div class="role-card" data-role="' + esc(role) + '">' +
        '<div class="role-head"><strong>' + esc(role) + '</strong>' +
        '<span class="muted">' + esc(r.slot) + '</span>' +
        '<span class="src ' + esc(r.source) + '">' + esc(r.source) + '</span></div>' +
        '<div class="eff' + (r.effective ? '' : ' none') + '">' + effHtml + '</div>' +
        '<div class="controls">' +
        '<select aria-label="Model override for ' + esc(role) + '">' + selectOptions(r) + '</select>' +
        '<input type="number" min="1" max="10000" step="1" aria-label="Steps limit for ' + esc(role) + '" placeholder="agent default" value="' +
        (r.stepsOverride === null || r.stepsOverride === undefined ? '' : r.stepsOverride) + '">' +
        '<button type="button" data-kind="save-role">Save</button>' +
        '</div>' +
        '<div class="ovr muted mono">' + bits.join(' \\u00b7 ') + '</div>' +
        '</div>');
    });
    $('roles').innerHTML = cards.join('');
  }

  function refresh() {
    return api('GET', '/api/fleet').then(function (res) {
      if (!res.ok) { toast('failed to load fleet state (HTTP ' + res.status + ')', true); return; }
      state = res.data;
      render();
    }, function () { toast('network error loading fleet state', true); });
  }

  $('fleet-body').addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute || t.getAttribute('data-kind') !== 'toggle') return;
    var ref = t.getAttribute('data-model');
    api('PUT', '/api/fleet/models/' + encodeURIComponent(ref) + '/enabled', { enabled: !!t.checked })
      .then(function (res) {
        if (res.ok) toast(ref + (t.checked ? ' enabled' : ' disabled'));
        else toast((res.data && res.data.error) || 'update failed', true);
        refresh();
      }, function () { toast('network error', true); refresh(); });
  });

  $('roles').addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute || t.getAttribute('data-kind') !== 'save-role') return;
    var card = t.closest('.role-card');
    var role = card.getAttribute('data-role');
    var model = card.querySelector('select').value;
    var rawSteps = card.querySelector('input[type="number"]').value.trim();
    var steps = null;
    if (rawSteps !== '') {
      steps = Number(rawSteps);
      if (!isFinite(steps) || Math.floor(steps) !== steps || steps < 1 || steps > 10000) {
        toast('steps must be an integer between 1 and 10000', true);
        return;
      }
    }
    api('PUT', '/api/fleet/roles/' + encodeURIComponent(role), { model: model === '' ? null : model, steps: steps })
      .then(function (res) {
        if (res.ok) toast('saved ' + role);
        else toast((res.data && res.data.error) || 'update failed', true);
        refresh();
      }, function () { toast('network error', true); });
  });

  refresh();
})();
</script>
</body>
</html>
`
