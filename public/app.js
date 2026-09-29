/* PBC Parking web app: Entrance, Usher, Map and Setup screens. */
(function () {
  'use strict';

  const core = window.ParkingCore;
  const $app = document.getElementById('app');
  const $sheet = document.getElementById('sheet');
  const $toast = document.getElementById('toast');

  let state = null; // { version, lot, session }
  let expanded = null; // core.expandLot(state.lot)
  let route = 'home';

  // Per-screen UI state that must survive live re-renders.
  const ui = {
    lastTicket: null, // entrance: result just handed out
    keypad: '',
    lookup: null, // usher: ticket number being shown
    station: load('station', ''),
    mapSpot: null,
    draft: null, // setup: lot being edited
    draftDirty: false,
    editSpot: null, // setup: { rowId, number }
  };

  // ---------- utilities ----------

  function load(key, fallback) {
    try {
      const v = localStorage.getItem('pbc.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem('pbc.' + key, JSON.stringify(value));
    } catch {
      /* private mode: ignore */
    }
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function toast(msg, kind) {
    $toast.textContent = msg;
    $toast.className = 'toast ' + (kind || '');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => $toast.classList.add('hidden'), 3500);
  }

  function vibrate() {
    if (navigator.vibrate) navigator.vibrate(30);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Code': load('code', ''),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      askCode();
      throw new Error('Access code required');
    }
    if (!res.ok) {
      const err = new Error(data.error || 'Something went wrong');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function act(method, url, body) {
    try {
      return await api(method, url, body);
    } catch (err) {
      toast(err.message, 'error');
      return null;
    }
  }

  function zoneName(id) {
    const z = state.lot.zones.find((z) => z.id === id);
    return z ? z.name : id;
  }

  function ticketInfo(n, station) {
    const t = state.session.tickets[n];
    if (!t) return null;
    const spot = t.spotId ? expanded.byId[t.spotId] : null;
    if (!spot) return { ticket: t };
    return {
      ticket: t,
      spot,
      direction: core.parkDirection(spot, t.size),
      instruction: core.usherInstruction(state.lot, spot, station),
    };
  }

  const STATUS_LABEL = {
    assigned: 'On the way',
    parked: 'Parked',
    overflow: 'Overflow',
    cancelled: 'Cancelled',
  };

  function sizeTag(size) {
    return `<span class="size-tag size-${size}">${core.SIZE_LABELS[size]}</span>`;
  }

  function dirIcon(dir) {
    return dir === 'reverse' ? '⬇️' : '⬆️';
  }

  // ---------- live connection ----------

  let es = null;
  function connect() {
    if (es) es.close();
    const code = encodeURIComponent(load('code', ''));
    es = new EventSource('/api/events?code=' + code);
    es.onmessage = (e) => {
      setState(JSON.parse(e.data));
      document.getElementById('live').className = 'live on';
    };
    es.onerror = () => {
      document.getElementById('live').className = 'live off';
      // A 401 closes the stream for good; probe to find out.
      if (es.readyState === EventSource.CLOSED) {
        api('GET', '/api/state').then(setState).catch(() => {});
        setTimeout(connect, 3000);
      }
    };
  }

  function setState(next) {
    if (state && next.version && next.version <= state.version) return;
    state = next;
    expanded = core.expandLot(state.lot);
    document.getElementById('session-name').textContent = state.session.name;
    // Don't yank a Setup field out from under someone typing in it.
    const focused = document.activeElement;
    if (route === 'setup' && focused && /^(INPUT|SELECT|TEXTAREA)$/.test(focused.tagName)) return;
    render();
  }

  function askCode() {
    if (askCode.open) return;
    askCode.open = true;
    const code = prompt('Enter the parking team access code:');
    askCode.open = false;
    if (code !== null) {
      save('code', code.trim());
      connect();
    }
  }

  // ---------- routing ----------

  function onRoute() {
    route = (location.hash.replace(/^#\/?/, '') || 'home').split('/')[0];
    document.querySelectorAll('.tabs a').forEach((a) => {
      a.classList.toggle('active', a.dataset.tab === route);
    });
    closeSheet();
    render();
  }

  function render() {
    if (!state) {
      $app.innerHTML = '<p class="muted center pad">Connecting…</p>';
      return;
    }
    const views = { home, entrance, usher, map: mapView, setup };
    (views[route] || home)();
  }

  // ---------- home ----------

  function home() {
    const cap = core.capacity(state.lot, state.session, expanded);
    $app.innerHTML = `
      <section class="card">
        <h2>Who are you today?</h2>
        <div class="role-grid">
          <a class="role" href="#/entrance"><b>🚗 Entrance</b><span>Size up each car, hand out a number</span></a>
          <a class="role" href="#/usher"><b>🦺 Usher</b><span>Enter a number, point the driver to the spot</span></a>
          <a class="role" href="#/map"><b>🗺️ Lot Map</b><span>Live view of every spot</span></a>
          <a class="role" href="#/setup"><b>⚙️ Setup</b><span>Lot layout &amp; new session</span></a>
        </div>
      </section>
      ${capacityCard(cap)}`;
  }

  function capacityCard(cap) {
    return `
      <section class="card">
        <h3>Open spots <small class="muted">${cap.used} of ${cap.total - cap.reserved} in use</small></h3>
        <div class="cap-grid">
          ${core.SIZES.map((s) => `
            <div class="cap"><b>${cap[s]}</b>${sizeTag(s)}</div>`).join('')}
        </div>
      </section>`;
  }

  // ---------- entrance ----------

  function entrance() {
    const cap = core.capacity(state.lot, state.session, expanded);
    const recent = Object.values(state.session.tickets)
      .sort((a, b) => b.n - a.n)
      .slice(0, 8);
    const last = ui.lastTicket && ticketInfo(ui.lastTicket);

    $app.innerHTML = `
      ${last ? entranceResult(last) : ''}
      <section class="card ${last ? 'dim' : ''}">
        <h2>How big is the car?</h2>
        <div class="size-grid">
          ${core.SIZES.map((s) => `
            <button class="size-btn size-${s}" data-act="new" data-size="${s}" ${cap[s] ? '' : 'data-full="1"'}>
              <b>${core.SIZE_LABELS[s]}</b>
              <span>${core.SIZE_HINTS[s]}</span>
              <small>${cap[s]} open</small>
            </button>`).join('')}
        </div>
      </section>
      <section class="card">
        <h3>Recent cars</h3>
        ${recent.length ? ticketTable(recent, true) : '<p class="muted">No cars yet.</p>'}
      </section>`;
  }

  function entranceResult(info) {
    const t = info.ticket;
    if (!info.spot) {
      return `
        <section class="card result overflow">
          <div class="big-num">#${t.n}</div>
          <p class="headline">No ${core.SIZE_LABELS[t.size].toLowerCase()} spot left</p>
          <p>${esc(state.lot.overflowNote || 'Send to overflow parking.')}</p>
          <button class="btn" data-act="dismiss">Next car</button>
        </section>`;
    }
    return `
      <section class="card result ok">
        <p class="muted">Tell the driver:</p>
        <div class="big-num">#${t.n}</div>
        <p class="say">“Your number is <b>${t.n}</b>. Please drive forward and tell the next usher your number.”</p>
        <p class="muted">Heading to <b>${esc(zoneName(info.spot.zoneId))}</b> · spot ${esc(info.spot.id)} · ${sizeTag(t.size)}</p>
        <div class="row-btns">
          <button class="btn primary" data-act="dismiss">Next car ➜</button>
          <button class="btn ghost" data-act="ticket-menu" data-n="${t.n}">Fix…</button>
        </div>
      </section>`;
  }

  function ticketTable(tickets, withMenu) {
    return `
      <table class="tickets">
        <thead><tr><th>#</th><th>Size</th><th>Spot</th><th>Status</th></tr></thead>
        <tbody>
          ${tickets.map((t) => `
            <tr ${withMenu ? `data-act="ticket-menu" data-n="${t.n}"` : ''} class="st-${t.status}">
              <td><b>${t.n}</b></td>
              <td>${sizeTag(t.size)}</td>
              <td>${esc(t.spotId || '—')}</td>
              <td>${STATUS_LABEL[t.status] || t.status}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function ticketMenu(n) {
    const t = state.session.tickets[n];
    if (!t) return;
    openSheet(`
      <h3>Car #${t.n} ${sizeTag(t.size)}</h3>
      <p class="muted">${t.spotId ? 'Spot ' + esc(t.spotId) : 'No spot'} · ${STATUS_LABEL[t.status] || t.status}</p>
      ${t.status === 'cancelled' ? '' : `
        <p>Wrong size? Pick the right one (gets a new spot):</p>
        <div class="size-row">
          ${core.SIZES.map((s) => `<button class="btn size-${s}" data-act="resize" data-n="${t.n}" data-size="${s}" ${s === t.size ? 'disabled' : ''}>${core.SIZE_LABELS[s]}</button>`).join('')}
        </div>
        ${t.status === 'assigned' ? `<button class="btn" data-act="parked" data-n="${t.n}">✓ Mark parked</button>` : ''}
        ${t.spotId ? `<button class="btn" data-act="reassign" data-n="${t.n}">Spot taken → new spot</button>` : ''}
        <button class="btn danger" data-act="cancel" data-n="${t.n}">Cancel number / car left</button>`}
      <button class="btn ghost" data-act="close-sheet">Close</button>`);
  }

  // ---------- usher ----------

  function usher() {
    const zones = state.lot.zones;
    if (ui.station && !zones.some((z) => z.id === ui.station)) ui.station = '';
    const incoming = Object.values(state.session.tickets)
      .filter((t) => t.status === 'assigned' && t.spotId)
      .filter((t) => !ui.station || expanded.byId[t.spotId]?.zoneId === ui.station)
      .sort((a, b) => a.n - b.n);

    $app.innerHTML = `
      <section class="card">
        <label class="lbl">I'm standing at</label>
        <div class="pills">
          ${zones.map((z) => `<button class="pill ${ui.station === z.id ? 'on' : ''}" data-act="station" data-zone="${esc(z.id)}">${esc(z.name)}</button>`).join('')}
          <button class="pill ${ui.station ? '' : 'on'}" data-act="station" data-zone="">Anywhere</button>
        </div>
      </section>
      ${ui.lookup ? usherResult() : keypad()}
      <section class="card">
        <h3>On the way to ${ui.station ? esc(zoneName(ui.station)) : 'their spots'} <small class="muted">${incoming.length}</small></h3>
        ${incoming.length ? `<div class="chips">${incoming.map((t) => `
          <button class="chip" data-act="lookup" data-n="${t.n}"><b>#${t.n}</b> → ${esc(t.spotId)} ${sizeTag(t.size)}</button>`).join('')}</div>`
          : '<p class="muted">Nobody headed here right now.</p>'}
      </section>`;
  }

  function keypad() {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
    return `
      <section class="card">
        <div class="keypad-display">${ui.keypad ? '#' + esc(ui.keypad) : '<span class="muted">Car number</span>'}</div>
        <div class="keypad">
          ${keys.map((k) => `<button class="key" data-act="key" data-k="${k}">${k}</button>`).join('')}
        </div>
        <button class="btn primary big" data-act="go" ${ui.keypad ? '' : 'disabled'}>Find spot</button>
      </section>`;
  }

  function usherResult() {
    const info = ticketInfo(ui.lookup, ui.station);
    if (!info) {
      return `
        <section class="card result warn">
          <p class="headline">No car #${esc(ui.lookup)}</p>
          <p>Double-check the number with the driver.</p>
          <button class="btn primary big" data-act="clear">Try again</button>
        </section>`;
    }
    const t = info.ticket;
    if (t.status === 'cancelled' || !info.spot) {
      return `
        <section class="card result warn">
          <div class="big-num">#${t.n}</div>
          <p class="headline">${t.status === 'cancelled' ? 'This number was cancelled' : 'No spot available'}</p>
          <p>${t.status === 'overflow' ? esc(state.lot.overflowNote) : 'Ask the entrance team.'}</p>
          <div class="row-btns">
            ${t.status === 'overflow' ? `<button class="btn" data-act="reassign" data-n="${t.n}" data-keep="1">Try again for a spot</button>` : ''}
            <button class="btn primary" data-act="clear">Done</button>
          </div>
        </section>`;
    }
    const ins = info.instruction;
    const cls = { park: 'ok', forward: 'go', back: 'warn', info: 'go' }[ins.action];
    const head = {
      park: 'PARK HERE',
      forward: 'KEEP GOING ⬆',
      back: 'TURN AROUND',
      info: 'SPOT',
    }[ins.action];
    return `
      <section class="card result ${cls}">
        <div class="result-top">
          <span class="big-num small">#${t.n}</span>${sizeTag(t.size)}
          ${t.status === 'parked' ? '<span class="badge">Already parked</span>' : ''}
        </div>
        <p class="headline">${head}</p>
        <p class="say">${esc(ins.text)}</p>
        <div class="spot-big">${esc(info.spot.id)}</div>
        <p class="direction">${dirIcon(info.direction.dir)} <b>${core.directionLabel(info.direction.dir)}</b><br><small>${esc(info.direction.reason)}</small></p>
        ${info.spot.note ? `<p class="note">📝 ${esc(info.spot.note)}</p>` : ''}
        ${mapSvg({ highlight: info.spot.id, compact: true })}
        <div class="row-btns">
          ${t.status === 'assigned' ? `<button class="btn primary" data-act="parked" data-n="${t.n}">✓ Parked</button>` : ''}
          <button class="btn" data-act="reassign" data-n="${t.n}">Spot taken</button>
          <button class="btn ghost" data-act="ticket-menu" data-n="${t.n}">More…</button>
          <button class="btn ghost" data-act="clear">Next car</button>
        </div>
      </section>`;
  }

  // ---------- map ----------

  function mapSvg(opts) {
    const o = opts || {};
    const lot = o.lot || state.lot;
    const ex = o.lot ? core.expandLot(lot) : expanded;
    const occ = o.lot ? {} : core.occupancy(state.session);
    const blocked = o.lot ? {} : state.session.blocked;
    const markers = lot.markers || [];
    if (!ex.spots.length) return '<p class="muted">No spots yet.</p>';

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of ex.spots) {
      minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h);
    }
    for (const m of markers) {
      minX = Math.min(minX, m.x - 0.5); minY = Math.min(minY, m.y - 1);
      maxX = Math.max(maxX, m.x + m.text.length * 0.6); maxY = Math.max(maxY, m.y + 0.5);
    }
    // Extra room for row labels drawn beside/above the first spot.
    const pad = 1;
    const vb = [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2];

    const rowLabels = (lot.rows || []).map((r) => {
      const first = ex.byId[`${r.label}1`];
      if (!first) return '';
      const vertical = r.orientation === 'vertical';
      const x = vertical ? first.x + first.w / 2 : first.x - 0.35;
      const y = vertical ? first.y - 0.25 : first.y + first.h / 2 + 0.2;
      return `<text class="row-label" x="${x}" y="${y}" text-anchor="${vertical ? 'middle' : 'end'}">${esc(r.label)}</text>`;
    }).join('');

    const rects = ex.spots.map((s) => {
      const t = occ[s.id];
      let cls = 'free';
      let label = s.number;
      if (s.reserved) { cls = 'reserved'; label = 'R'; }
      else if (t) { cls = t.status; label = '#' + t.n; }
      else if (blocked[s.id]) { cls = 'blocked'; label = '✕'; }
      const big = s.maxSize === 'van' ? ' van' : s.maxSize === 'small' ? ' compact' : '';
      const hl = o.highlight === s.id ? ' hl' : '';
      const edit = o.editSpot && o.editSpot === s.id ? ' hl' : '';
      const fs = Math.min(s.w, s.h) * 0.42;
      return `
        <g class="spot ${cls}${big}${hl}${edit}" data-act="${o.onSpot || ''}" data-spot="${s.id}" data-row="${s.rowId}" data-num="${s.number}">
          ${spotShape(s)}
          <text x="${s.x + s.w / 2}" y="${s.y + s.h / 2 + fs * 0.35}" font-size="${fs}" text-anchor="middle">${esc(label)}</text>
        </g>`;
    }).join('');

    const marks = markers.map((m) =>
      `<text class="marker" x="${m.x}" y="${m.y}">${esc(m.text)}</text>`).join('');

    return `
      <div class="map-wrap ${o.compact ? 'compact' : ''}">
        <svg class="map" viewBox="${vb.join(' ')}" preserveAspectRatio="xMidYMid meet">
          ${rowLabels}${rects}${marks}
        </svg>
      </div>`;
  }

  // Straight spots are rectangles; diagonal ones are parallelograms leaning
  // along the row, so the map looks like the painted lines.
  function spotShape(s) {
    if (!s.angled) {
      return `<rect x="${s.x + 0.05}" y="${s.y + 0.05}" width="${s.w - 0.1}" height="${s.h - 0.1}" rx="0.12"/>`;
    }
    const lean = (s.angled === 'right' ? 1 : -1) * 0.45;
    const g = 0.06;
    let pts;
    if (s.w <= s.h) {
      // Horizontal row: spot is 1 wide, 2 deep; shift the top edge sideways.
      const x0 = s.x + g, x1 = s.x + s.w - g, y0 = s.y + g, y1 = s.y + s.h - g;
      pts = [[x0 + lean, y0], [x1 + lean, y0], [x1 - lean, y1], [x0 - lean, y1]];
    } else {
      // Vertical row: spot is 2 wide, 1 deep; shift the left edge up/down.
      const x0 = s.x + g, x1 = s.x + s.w - g, y0 = s.y + g, y1 = s.y + s.h - g;
      pts = [[x0, y0 + lean], [x1, y0 - lean], [x1, y1 - lean], [x0, y1 + lean]];
    }
    return `<polygon points="${pts.map((p) => p.join(',')).join(' ')}"/>`;
  }

  function mapView() {
    const cap = core.capacity(state.lot, state.session, expanded);
    const tickets = Object.values(state.session.tickets)
      .filter((t) => t.status !== 'cancelled')
      .sort((a, b) => b.n - a.n);
    $app.innerHTML = `
      <section class="card">
        <h2>${esc(state.lot.name)}</h2>
        ${mapSvg({ onSpot: 'map-spot', highlight: ui.mapSpot })}
        <div class="legend">
          <span><i class="lg free"></i>Open</span>
          <span><i class="lg free van"></i>Van-size</span>
          <span><i class="lg assigned"></i>On the way</span>
          <span><i class="lg parked"></i>Parked</span>
          <span><i class="lg blocked"></i>Blocked</span>
          <span><i class="lg reserved"></i>Reserved</span>
        </div>
        <p class="muted small">Tap a spot to block it (cone, unticketed car) or manage the car in it.</p>
      </section>
      ${capacityCard(cap)}
      <section class="card">
        <h3>All cars <small class="muted">${tickets.length}</small></h3>
        ${tickets.length ? ticketTable(tickets, true) : '<p class="muted">No cars yet.</p>'}
      </section>`;
  }

  function spotMenu(id) {
    const s = expanded.byId[id];
    if (!s) return;
    ui.mapSpot = id;
    const t = core.occupancy(state.session)[id];
    if (t) return ticketMenu(t.n);
    const blocked = state.session.blocked[id];
    openSheet(`
      <h3>Spot ${esc(s.id)}</h3>
      <p class="muted">${esc(zoneName(s.zoneId))} · fits up to ${core.SIZE_LABELS[s.maxSize]}${s.reserved ? ' · Reserved' : ''}${s.note ? ' · ' + esc(s.note) : ''}</p>
      ${s.reserved ? '<p>Reserved spots are never auto-assigned. Change this in Setup.</p>' :
        `<button class="btn ${blocked ? 'primary' : 'danger'}" data-act="block" data-spot="${s.id}">
          ${blocked ? 'Unblock: spot is open again' : 'Block: spot is taken / unusable'}</button>`}
      <button class="btn ghost" data-act="close-sheet">Close</button>`);
  }

  // ---------- setup ----------

  function cloneLot() {
    return JSON.parse(JSON.stringify(state.lot));
  }

  function setup() {
    if (!ui.draft || !ui.draftDirty) ui.draft = cloneLot();
    const d = ui.draft;
    const errors = core.validateLot(d);
    const editRow = ui.editSpot && d.rows.find((r) => r.id === ui.editSpot.rowId);
    const editId = editRow ? `${editRow.label}${ui.editSpot.number}` : null;

    $app.innerHTML = `
      <section class="card">
        <h2>Session</h2>
        <p class="muted">Current: <b>${esc(state.session.name)}</b> · started ${new Date(state.session.startedAt).toLocaleString()} · ${Object.keys(state.session.tickets).length} numbers handed out</p>
        <div class="inline">
          <input id="session-input" placeholder="e.g. Sunday 11am" value="">
          <button class="btn primary" data-act="reset-session">Start new session</button>
        </div>
        <p class="muted small">Starting a new session clears every number and blocked spot. Do this before each service.</p>
      </section>

      <section class="card">
        <h2>Lot layout ${ui.draftDirty ? '<span class="badge">Unsaved</span>' : ''}</h2>
        <p class="muted small">Tap a spot in the preview to set its size, parking direction, or reserve it.</p>
        ${mapSvg({ lot: d, onSpot: 'edit-spot', editSpot: editId })}
        ${editRow ? spotEditor(editRow, ui.editSpot.number) : ''}
        ${errors.length ? `<ul class="errors">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
        <div class="row-btns">
          <button class="btn primary" data-act="save-lot" ${errors.length || !ui.draftDirty ? 'disabled' : ''}>Save layout</button>
          <button class="btn ghost" data-act="discard-lot" ${ui.draftDirty ? '' : 'disabled'}>Discard changes</button>
        </div>
      </section>

      <section class="card">
        <h3>Lot</h3>
        <label class="lbl">Name</label>
        <input data-bind="name" value="${esc(d.name)}">
        <label class="lbl">When the lot is full, tell the entrance team</label>
        <input data-bind="overflowNote" value="${esc(d.overflowNote || '')}">
      </section>

      <section class="card">
        <h3>Zones <small class="muted">in the order cars drive past them</small></h3>
        <p class="muted small">Ushers pick the zone they stand in. A car headed for a later zone gets "keep going".</p>
        ${d.zones.map((z, i) => `
          <div class="inline">
            <input data-bind="zones.${i}.name" value="${esc(z.name)}">
            <button class="btn mini" data-act="zone-up" data-i="${i}" ${i ? '' : 'disabled'}>↑</button>
            <button class="btn mini danger" data-act="zone-del" data-i="${i}">✕</button>
          </div>`).join('')}
        <button class="btn" data-act="zone-add">+ Add zone</button>
      </section>

      <section class="card">
        <h3>Rows of spots</h3>
        <p class="muted small">Position is in spot-widths (a spot is 1 wide, 2 deep). <b>Fill order</b>: lower fills first. Spots neighbor each other within a row.</p>
        ${d.rows.map((r, i) => rowEditor(r, i)).join('')}
        <button class="btn" data-act="row-add">+ Add row</button>
      </section>

      <section class="card">
        <h3>Map labels</h3>
        ${(d.markers || []).map((m, i) => `
          <div class="inline">
            <input data-bind="markers.${i}.text" value="${esc(m.text)}">
            <input class="num" type="number" step="0.5" data-bind="markers.${i}.x" data-num="1" value="${m.x}" title="x">
            <input class="num" type="number" step="0.5" data-bind="markers.${i}.y" data-num="1" value="${m.y}" title="y">
            <button class="btn mini danger" data-act="marker-del" data-i="${i}">✕</button>
          </div>`).join('')}
        <button class="btn" data-act="marker-add">+ Add label</button>
      </section>

      <section class="card">
        <h3>Backup</h3>
        <p class="muted small">Copy this to save your layout, or paste a layout and press Load.</p>
        <textarea id="lot-json" rows="6">${esc(JSON.stringify(d, null, 2))}</textarea>
        <button class="btn" data-act="load-json">Load pasted layout</button>
      </section>`;
  }

  function sel(bind, value, options) {
    return `<select data-bind="${bind}">${options.map(([v, l]) =>
      `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  }

  const SIZE_OPTS = core.SIZES.map((s) => [s, core.SIZE_LABELS[s]]);
  const PARK_OPTS = [['auto', 'Auto (by car size)'], ['front', 'Pull in forward'], ['reverse', 'Back in']];

  function rowEditor(r, i) {
    const d = ui.draft;
    const p = `rows.${i}.`;
    return `
      <div class="row-edit">
        <div class="grid">
          <label>Label<input data-bind="${p}label" value="${esc(r.label)}"></label>
          <label>Zone${sel(p + 'zone', r.zone, d.zones.map((z) => [z.id, esc(z.name)]))}</label>
          <label>Spots<input type="number" min="1" max="200" data-num="1" data-bind="${p}count" value="${r.count}"></label>
          <label>Direction${sel(p + 'orientation', r.orientation, [['horizontal', 'Left→right'], ['vertical', 'Top→bottom']])}</label>
          <label>X<input type="number" step="0.5" data-num="1" data-bind="${p}x" value="${r.x}"></label>
          <label>Y<input type="number" step="0.5" data-num="1" data-bind="${p}y" value="${r.y}"></label>
          <label>Fill order<input type="number" data-num="1" data-bind="${p}fillOrder" value="${r.fillOrder}"></label>
          <label>Fill from${sel(p + 'fillFrom', r.fillFrom || 'start', [['start', 'Spot 1 first'], ['end', 'Last spot first']])}</label>
          <label>Fits up to${sel(p + 'maxSize', r.maxSize || 'large', SIZE_OPTS)}</label>
          <label>Spot angle${sel(p + 'angled', r.angled || '', [['', 'Straight'], ['left', 'Diagonal, leaning left'], ['right', 'Diagonal, leaning right']])}</label>
          <label>Parking${r.angled ? '<select disabled><option>Pull in forward (diagonal)</option></select>' : sel(p + 'park', r.park || 'auto', PARK_OPTS)}</label>
        </div>
        <button class="btn mini danger" data-act="row-del" data-i="${i}">Delete row ${esc(r.label)}</button>
      </div>`;
  }

  function spotEditor(row, number) {
    const i = ui.draft.rows.indexOf(row);
    row.spots = row.spots || {};
    const o = row.spots[number] || {};
    const p = `rows.${i}.spots.${number}.`;
    return `
      <div class="spot-edit">
        <h4>Spot ${esc(row.label)}${number}</h4>
        <div class="grid">
          <label>Fits up to${sel(p + 'maxSize', o.maxSize || '', [['', `Row default (${core.SIZE_LABELS[row.maxSize || 'large']})`], ...SIZE_OPTS])}</label>
          <label>Parking${sel(p + 'park', o.park || '', [['', 'Row default'], ...PARK_OPTS])}</label>
          <label>Note<input data-bind="${p}note" value="${esc(o.note || '')}" placeholder="e.g. Accessible, tight"></label>
          <label class="check"><input type="checkbox" data-bind="${p}reserved" ${o.reserved ? 'checked' : ''}> Reserved (never auto-assign)</label>
        </div>
        <button class="btn mini ghost" data-act="close-spot-edit">Done</button>
      </div>`;
  }

  function setPath(obj, pathStr, value) {
    const keys = pathStr.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (cur[keys[i]] == null) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    const last = keys[keys.length - 1];
    if (value === '' || value === false) delete cur[last];
    else cur[last] = value;
  }

  function cleanSpotOverrides(lot) {
    for (const r of lot.rows) {
      for (const k of Object.keys(r.spots || {})) {
        if (!Object.keys(r.spots[k]).length || Number(k) > r.count) delete r.spots[k];
      }
    }
  }

  function draftChanged(rerender) {
    ui.draftDirty = true;
    if (rerender) {
      const y = window.scrollY;
      setup();
      window.scrollTo(0, y);
    }
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'zone';
  }

  // ---------- sheet ----------

  function openSheet(html) {
    $sheet.innerHTML = `<div class="sheet-body">${html}</div>`;
    $sheet.classList.remove('hidden');
  }

  function closeSheet() {
    $sheet.classList.add('hidden');
    $sheet.innerHTML = '';
  }

  // ---------- actions ----------

  const actions = {
    async new(el) {
      if (el.dataset.full && !confirm('No open spot of this size. Hand out a number anyway (overflow)?')) return;
      vibrate();
      const r = await act('POST', '/api/tickets', { size: el.dataset.size });
      if (r) {
        ui.lastTicket = r.ticket.n;
        render();
        window.scrollTo(0, 0);
      }
    },
    dismiss() {
      ui.lastTicket = null;
      render();
    },
    'ticket-menu'(el) {
      ticketMenu(Number(el.dataset.n));
    },
    async resize(el) {
      const r = await act('POST', `/api/tickets/${el.dataset.n}/size`, { size: el.dataset.size });
      if (r) {
        closeSheet();
        toast(r.spot ? `#${r.ticket.n} now goes to ${r.spot.id}` : `#${r.ticket.n}: no spot for that size`);
      }
    },
    async parked(el) {
      const r = await act('POST', `/api/tickets/${el.dataset.n}/parked`);
      if (r) {
        vibrate();
        closeSheet();
        toast(`#${r.ticket.n} parked in ${r.ticket.spotId} ✓`, 'ok');
        if (route === 'usher') actions.clear();
      }
    },
    async reassign(el) {
      const keep = el.dataset.keep === '1';
      if (!keep && !confirm('Mark the current spot as taken and pick a new spot for this car?')) return;
      const r = await act('POST', `/api/tickets/${el.dataset.n}/reassign`, { blockOld: !keep });
      if (r) {
        closeSheet();
        toast(r.spot ? `New spot for #${r.ticket.n}: ${r.spot.id}` : 'No other spot available', r.spot ? 'ok' : 'error');
        if (route === 'usher') {
          ui.lookup = r.ticket.n;
          render();
        }
      }
    },
    async cancel(el) {
      if (!confirm(`Cancel number ${el.dataset.n}? Its spot becomes free.`)) return;
      const r = await act('POST', `/api/tickets/${el.dataset.n}/cancel`);
      if (r) {
        closeSheet();
        if (ui.lastTicket === r.ticket.n) ui.lastTicket = null;
        if (ui.lookup === r.ticket.n) ui.lookup = null;
        render();
      }
    },
    station(el) {
      ui.station = el.dataset.zone;
      save('station', ui.station);
      render();
    },
    key(el) {
      const k = el.dataset.k;
      if (k === 'C') ui.keypad = '';
      else if (k === '⌫') ui.keypad = ui.keypad.slice(0, -1);
      else if (ui.keypad.length < 4) ui.keypad += k;
      vibrate();
      render();
    },
    go() {
      if (!ui.keypad) return;
      ui.lookup = Number(ui.keypad);
      ui.keypad = '';
      render();
    },
    lookup(el) {
      ui.lookup = Number(el.dataset.n);
      render();
      window.scrollTo(0, 0);
    },
    clear() {
      ui.lookup = null;
      ui.keypad = '';
      render();
    },
    'map-spot'(el) {
      spotMenu(el.dataset.spot);
      render();
    },
    async block(el) {
      const r = await act('POST', `/api/spots/${el.dataset.spot}/block`);
      if (r) closeSheet();
    },
    'close-sheet'() {
      closeSheet();
    },
    async 'reset-session'() {
      const name = document.getElementById('session-input').value.trim() || 'Service';
      if (!confirm(`Start "${name}"? All current numbers and blocked spots will be cleared.`)) return;
      const r = await act('POST', '/api/session/reset', { name });
      if (r) {
        ui.lastTicket = null;
        ui.lookup = null;
        toast(`Started ${name}`, 'ok');
      }
    },
    async 'save-lot'() {
      cleanSpotOverrides(ui.draft);
      try {
        await api('PUT', '/api/lot', { lot: ui.draft });
      } catch (err) {
        if (err.status !== 409) return toast(err.message, 'error');
        if (!confirm(err.message + '\n\nSave anyway and start a new session now?')) return;
        if (!(await act('PUT', '/api/lot', { lot: ui.draft, force: true }))) return;
      }
      ui.draftDirty = false;
      ui.editSpot = null;
      toast('Layout saved', 'ok');
    },
    'discard-lot'() {
      ui.draftDirty = false;
      ui.editSpot = null;
      render();
    },
    'edit-spot'(el) {
      ui.editSpot = { rowId: el.dataset.row, number: Number(el.dataset.num) };
      if (!ui.draftDirty) ui.draft = cloneLot();
      const y = window.scrollY;
      setup();
      window.scrollTo(0, y);
    },
    'close-spot-edit'() {
      ui.editSpot = null;
      draftChanged(true);
    },
    'zone-add'() {
      const ids = new Set(ui.draft.zones.map((z) => z.id));
      let id = 'zone-' + (ui.draft.zones.length + 1);
      while (ids.has(id)) id += 'x';
      ui.draft.zones.push({ id, name: 'Zone ' + (ui.draft.zones.length + 1) });
      draftChanged(true);
    },
    'zone-up'(el) {
      const i = Number(el.dataset.i);
      const z = ui.draft.zones;
      [z[i - 1], z[i]] = [z[i], z[i - 1]];
      draftChanged(true);
    },
    'zone-del'(el) {
      const i = Number(el.dataset.i);
      const z = ui.draft.zones[i];
      if (ui.draft.rows.some((r) => r.zone === z.id)) {
        return toast('Move or delete the rows in this zone first', 'error');
      }
      ui.draft.zones.splice(i, 1);
      draftChanged(true);
    },
    'row-add'() {
      const d = ui.draft;
      const used = new Set(d.rows.map((r) => r.label));
      let code = 65;
      while (used.has(String.fromCharCode(code)) && code < 90) code++;
      const maxY = Math.max(0, ...core.expandLot(d).spots.map((s) => s.y + s.h));
      d.rows.push({
        id: 'r' + Date.now().toString(36),
        label: String.fromCharCode(code),
        zone: (d.zones[0] || {}).id,
        x: 0, y: maxY + 2, orientation: 'horizontal', count: 10,
        fillOrder: d.rows.length + 1, fillFrom: 'start',
        park: 'auto', maxSize: 'large', spots: {},
      });
      draftChanged(true);
    },
    'row-del'(el) {
      const i = Number(el.dataset.i);
      if (!confirm(`Delete row ${ui.draft.rows[i].label}?`)) return;
      ui.draft.rows.splice(i, 1);
      ui.editSpot = null;
      draftChanged(true);
    },
    'marker-add'() {
      ui.draft.markers = ui.draft.markers || [];
      ui.draft.markers.push({ x: 0, y: -1, text: 'Label' });
      draftChanged(true);
    },
    'marker-del'(el) {
      ui.draft.markers.splice(Number(el.dataset.i), 1);
      draftChanged(true);
    },
    'load-json'() {
      try {
        const lot = JSON.parse(document.getElementById('lot-json').value);
        const errors = core.validateLot(lot);
        if (errors.length) return toast(errors[0], 'error');
        ui.draft = lot;
        ui.editSpot = null;
        draftChanged(true);
        toast('Loaded. Review, then Save layout.', 'ok');
      } catch {
        toast('That is not valid layout JSON', 'error');
      }
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !el.dataset.act) {
      if (e.target === $sheet) closeSheet();
      return;
    }
    const fn = actions[el.dataset.act];
    if (fn && !el.disabled) {
      e.preventDefault();
      fn(el);
    }
  });

  // Setup form fields: data-bind="path.in.draft"
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.bind || route !== 'setup') return;
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.num) value = Number(value);
    const bind = el.dataset.bind;
    const zm = bind.match(/^zones\.(\d+)\.name$/);
    if (zm && !value) value = 'Zone';
    setPath(ui.draft, bind, value);
    // New zones get a readable id from their first name.
    if (zm) {
      const z = ui.draft.zones[Number(zm[1])];
      if (/^zone-\d+x*$/.test(z.id) && !ui.draft.rows.some((r) => r.zone === z.id)) {
        z.id = slug(value) + '-' + Date.now().toString(36).slice(-3);
      }
    }
    draftChanged(true);
  });

  document.addEventListener('keydown', (e) => {
    if (route !== 'usher' || ui.lookup || e.target.tagName === 'INPUT') return;
    if (/^\d$/.test(e.key) && ui.keypad.length < 4) ui.keypad += e.key;
    else if (e.key === 'Backspace') ui.keypad = ui.keypad.slice(0, -1);
    else if (e.key === 'Enter') return actions.go();
    else return;
    render();
  });

  window.addEventListener('hashchange', onRoute);
  onRoute();
  connect();
})();
