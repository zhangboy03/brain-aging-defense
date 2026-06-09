/* Head Count — shared engine (round generation + SVG stage/animation)
 * Used by both player.html (full-size audience screen) and index.html (host mini preview).
 * Faithful to the Switch Brain Training "Head Count / 进进出出":
 *   observe -> house drops to cover -> people enter/leave via DOOR and CHIMNEY -> reveal.
 */
(function (global) {
  'use strict';

  // ---- Difficulty presets -------------------------------------------------
  // observeMs: how long initial people are shown (with 3/2/1 countdown)
  // dropMs:    house fall-to-cover duration
  // moveMs:    one person's walk/climb duration
  // gapMs:     delay between successive event starts (gap < moveMs => visual overlap)
  // events:    number of in/out events
  // waveMax:   max people moving together in one event
  // chimney:   allow chimney entries/exits
  // maxInside: cap on people inside (keeps answers sane)
  const PRESETS = {
    warmup:   { label: '热身',     observeMs: 2100, dropMs: 1100, moveMs: 1150, gapMs: 1300, events: 3,  waveMax: 1, chimney: false, maxInside: 6 },
    standard: { label: '标准赛题', observeMs: 1750, dropMs: 950,  moveMs: 1000, gapMs: 820,  events: 5,  waveMax: 2, chimney: false, maxInside: 7 },
    hard:     { label: '高压',     observeMs: 1450, dropMs: 820,  moveMs: 820,  gapMs: 580,  events: 8,  waveMax: 2, chimney: true,  maxInside: 8 },
    final:    { label: '决赛压轴', observeMs: 1150, dropMs: 700,  moveMs: 700,  gapMs: 430,  events: 11, waveMax: 3, chimney: true,  maxInside: 9 },
  };
  const PRESET_ORDER = ['warmup', 'standard', 'hard', 'final'];

  // ---- Seeded RNG ---------------------------------------------------------
  function hashSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return (h >>> 0) || 1;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeSeedString(rngSeed) {
    // short human-friendly seed: e.g. "K7Q2-9F3"
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const r = mulberry32(rngSeed);
    let s = '';
    for (let i = 0; i < 7; i++) {
      if (i === 4) s += '-';
      s += chars[Math.floor(r() * chars.length)];
    }
    return s;
  }

  // ---- Round generation ---------------------------------------------------
  // config: { presetKey, seed?, overrides? }
  // returns a fully-resolved round object (pure data, no DOM).
  function generateRound(config) {
    config = config || {};
    const presetKey = PRESETS[config.presetKey] ? config.presetKey : 'standard';
    const base = PRESETS[presetKey];
    const p = Object.assign({}, base, config.overrides || {});

    const seedStr = config.seed || makeSeedString((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
    const rand = mulberry32(hashSeed(seedStr));
    const pick = (n) => Math.floor(rand() * n);
    const between = (lo, hi) => lo + pick(hi - lo + 1);

    let inside = between(2, 5);
    const initialCount = inside;
    const events = [];
    const nEvents = Math.max(1, p.events | 0);

    for (let i = 0; i < nEvents; i++) {
      // decide direction respecting bounds
      let type;
      if (inside <= 0) type = 'in';
      else if (inside >= p.maxInside) type = 'out';
      else type = rand() < 0.52 ? 'in' : 'out';

      const capacity = type === 'in' ? (p.maxInside - inside) : inside;
      const n = Math.max(1, Math.min(capacity, between(1, p.waveMax)));

      const via = (p.chimney && rand() < 0.34) ? 'chimney' : 'door';
      const side = rand() < 0.5 ? 'left' : 'right';

      inside += (type === 'in' ? n : -n);
      events[i] = { type, via, side, n };
    }

    // schedule: each event starts gapMs after the previous start
    let cursor = 0;
    for (const ev of events) {
      ev.startAt = cursor;          // ms, relative to start of events phase
      ev.dur = p.moveMs;
      cursor += p.gapMs;
    }
    const eventsSpan = cursor + p.moveMs; // total play time of events phase

    return {
      seed: seedStr,
      presetKey,
      presetLabel: base.label,
      initialCount,
      events,
      answer: inside,
      maxInside: p.maxInside,
      timings: {
        observeMs: p.observeMs,
        dropMs: p.dropMs,
        moveMs: p.moveMs,
        gapMs: p.gapMs,
        eventsSpan,
      },
    };
  }

  function describeEvent(ev) {
    const dir = ev.type === 'in' ? '进' : '出';
    const via = ev.via === 'chimney' ? '烟囱' : (ev.side === 'left' ? '左门' : '右门');
    return `${via}${dir}${ev.n}人`;
  }

  // ---- Geometry (landscape stage) ----------------------------------------
  const NS = 'http://www.w3.org/2000/svg';
  const VB_W = 1000, VB_H = 640;
  const GEO = {
    groundY: 470,           // feet line / house base
    house: { cx: 500, bodyTop: 320, bodyW: 250, roofApexY: 232, roofW: 330 },
    chimney: { x: 560, w: 38, top: 258, bottom: 320 },
    window: { cx: 488, cy: 392, pane: 22, gap: 6 },
    door: { w: 64, h: 60 },  // bottom-center of body
    personH: 96,             // person silhouette height at scale 1
    edgeL: -80, edgeR: 1080, // off-screen spawn/exit x
  };

  function el(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  // person silhouette, origin at feet center (0,0), grows upward (toward -y)
  function personPath() {
    return 'M0,-96 a14,14 0 1,0 0.01,0 Z M-17,-66 Q0,-72 17,-66 ' +
           'L11,-30 L15,0 L4,0 L0,-26 L-4,0 L-15,0 L-11,-30 Z';
  }
  function makePerson(cls) {
    const g = el('g', { class: 'hc-person' + (cls ? ' ' + cls : '') });
    g.appendChild(el('circle', { cx: 0, cy: -82, r: 14 }));
    const body = el('path', { d: 'M-17,-66 Q0,-72 17,-66 L11,-30 L15,0 L4,0 L0,-26 L-4,0 L-15,0 L-11,-30 Z' });
    g.appendChild(body);
    return g;
  }

  // ---- Easing -------------------------------------------------------------
  const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const clamp01 = (t) => t < 0 ? 0 : t > 1 ? 1 : t;
  const lerp = (a, b, t) => a + (b - a) * t;

  // Build per-event sprite trajectory.
  // Returns segments [{frac, from:{x,y,s,a}, to:{...}}] consumed over event dur.
  function spriteSegments(ev) {
    const G = GEO.groundY;
    const doorX = GEO.house.cx;
    const chX = GEO.chimney.x + GEO.chimney.w / 2;
    const chTop = GEO.chimney.top;
    const startX = ev.side === 'left' ? GEO.edgeL : GEO.edgeR;

    if (ev.via === 'door') {
      if (ev.type === 'in') {
        // walk from edge to door, fade as entering
        return [
          { frac: 0.82, from: { x: startX, y: G, s: 1, a: 1 }, to: { x: doorX, y: G, s: 1, a: 1 } },
          { frac: 0.18, from: { x: doorX, y: G, s: 1, a: 1 }, to: { x: doorX, y: G, s: 0.7, a: 0 } },
        ];
      }
      // out: emerge at door, walk to edge
      return [
        { frac: 0.18, from: { x: doorX, y: G, s: 0.7, a: 0 }, to: { x: doorX, y: G, s: 1, a: 1 } },
        { frac: 0.82, from: { x: doorX, y: G, s: 1, a: 1 }, to: { x: startX, y: G, s: 1, a: 1 } },
      ];
    }
    // chimney
    if (ev.type === 'in') {
      // descend from sky onto chimney top, then sink in
      return [
        { frac: 0.55, from: { x: chX, y: chTop - 220, s: 1, a: 0 }, to: { x: chX, y: chTop, s: 1, a: 1 } },
        { frac: 0.10, from: { x: chX, y: chTop, s: 1, a: 1 }, to: { x: chX, y: chTop, s: 1, a: 1 } },
        { frac: 0.35, from: { x: chX, y: chTop, s: 1, a: 1 }, to: { x: chX, y: chTop + 50, s: 0.35, a: 0 } },
      ];
    }
    // chimney out: emerge from the chimney and rise STRAIGHT UP off the top of the screen
    return [
      { frac: 0.35, from: { x: chX, y: chTop + 55, s: 0.4, a: 0 }, to: { x: chX, y: chTop, s: 1, a: 1 } },        // rise out of chimney
      { frac: 0.12, from: { x: chX, y: chTop, s: 1, a: 1 }, to: { x: chX, y: chTop - 12, s: 1, a: 1 } },           // brief pause on top
      { frac: 0.53, from: { x: chX, y: chTop - 12, s: 1, a: 1 }, to: { x: chX, y: chTop - 340, s: 1, a: 0 } },     // straight up, fade off top
    ];
  }

  function sampleSegments(segs, t) {
    t = clamp01(t);
    let acc = 0;
    for (const seg of segs) {
      if (t <= acc + seg.frac || seg === segs[segs.length - 1]) {
        const local = seg.frac > 0 ? clamp01((t - acc) / seg.frac) : 1;
        const e = easeInOut(local);
        return {
          x: lerp(seg.from.x, seg.to.x, e),
          y: lerp(seg.from.y, seg.to.y, e),
          s: lerp(seg.from.s, seg.to.s, e),
          a: lerp(seg.from.a, seg.to.a, e),
        };
      }
      acc += seg.frac;
    }
    const last = segs[segs.length - 1];
    return { x: last.to.x, y: last.to.y, s: last.to.s, a: last.to.a };
  }

  // ---- Stage --------------------------------------------------------------
  // HeadCountStage(svgEl, opts) — renders & animates a round.
  // phases: idle -> observe -> drop -> events -> settle ; reveal is a separate overlay.
  function HeadCountStage(svg, opts) {
    opts = opts || {};
    svg.setAttribute('viewBox', `0 0 ${VB_W} ${VB_H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.classList.add('hc-stage');

    // layers
    const gGround = el('g');
    const gObserve = el('g', { class: 'hc-observe' });
    const gHouse = el('g', { class: 'hc-house' });
    const gSprites = el('g', { class: 'hc-sprites' });
    const gPrompt = el('g', { class: 'hc-prompt' });
    const gReveal = el('g', { class: 'hc-reveal' });
    svg.appendChild(gGround);
    svg.appendChild(gObserve);
    svg.appendChild(gSprites);   // sprites behind house body? no — sprites enter door, keep behind house so they vanish "into" it
    svg.appendChild(gHouse);
    svg.appendChild(gPrompt);
    svg.appendChild(gReveal);

    // ground line (subtle pencil stroke)
    const ground = el('line', { x1: 40, y1: GEO.groundY, x2: VB_W - 40, y2: GEO.groundY, class: 'hc-groundline' });
    gGround.appendChild(ground);

    // build house (drawn into a movable group for the drop animation)
    const houseInner = el('g');
    gHouse.appendChild(houseInner);
    (function buildHouse() {
      const h = GEO.house;
      const bodyLeft = h.cx - h.bodyW / 2, bodyRight = h.cx + h.bodyW / 2;
      // chimney (behind roof)
      houseInner.appendChild(el('rect', { x: GEO.chimney.x, y: GEO.chimney.top, width: GEO.chimney.w, height: GEO.chimney.bottom - GEO.chimney.top, class: 'hc-fill' }));
      // roof
      const roof = el('path', { d: `M${h.cx - h.roofW / 2},${h.bodyTop} L${h.cx},${h.roofApexY} L${h.cx + h.roofW / 2},${h.bodyTop} Z`, class: 'hc-fill' });
      houseInner.appendChild(roof);
      // body
      houseInner.appendChild(el('rect', { x: bodyLeft, y: h.bodyTop, width: h.bodyW, height: GEO.groundY - h.bodyTop, class: 'hc-fill' }));
      // window (4 panes punched out — light fill)
      const w = GEO.window;
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
        houseInner.appendChild(el('rect', {
          x: w.cx - w.pane - w.gap / 2 + c * (w.pane + w.gap),
          y: w.cy - w.pane - w.gap / 2 + r * (w.pane + w.gap),
          width: w.pane, height: w.pane, class: 'hc-window',
        }));
      }
      // door (light, bottom-center) — entry point
      houseInner.appendChild(el('rect', {
        x: h.cx - GEO.door.w / 2, y: GEO.groundY - GEO.door.h,
        width: GEO.door.w, height: GEO.door.h, rx: 4, class: 'hc-door',
      }));
    })();

    // observe prompt + countdown
    const observeText = el('text', { x: VB_W / 2, y: 96, class: 'hc-toptext', 'text-anchor': 'middle' });
    observeText.textContent = '请记住人数。';
    gObserve.appendChild(observeText);
    const countText = el('text', { x: VB_W / 2, y: 230, class: 'hc-count', 'text-anchor': 'middle' });
    gObserve.appendChild(countText);
    const observePeople = el('g');
    gObserve.appendChild(observePeople);

    // prompt during play / settle
    const promptText = el('text', { x: VB_W / 2, y: 96, class: 'hc-toptext', 'text-anchor': 'middle' });
    gPrompt.appendChild(promptText);

    // state
    let round = null;
    let phase = 'idle';
    let t0 = 0;
    let raf = 0;
    let revealStart = 0;
    let onPhase = opts.onPhase || function () {};

    function clearGroup(g) { while (g.firstChild) g.removeChild(g.firstChild); }
    function showGroup(g, on) { g.style.display = on ? '' : 'none'; }

    function placeCluster(g, count, cls) {
      clearGroup(g);
      const n = Math.max(0, count);
      const cx = VB_W / 2, base = GEO.groundY;
      // arrange in a tidy huddle: rows of up to 4
      const perRow = 4, spacingX = 56, spacingY = 8, scale = 0.92;
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / perRow);
        const inRow = Math.min(perRow, n - row * perRow);
        const idx = i % perRow;
        const x = cx + (idx - (inRow - 1) / 2) * spacingX;
        const y = base - row * spacingY;
        const p = makePerson(cls);
        p.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${scale})`);
        p.setAttribute('opacity', 1);
        g.appendChild(p);
      }
    }

    function setRound(r) {
      round = r;
      phase = 'ready';
      cancelAnimationFrame(raf);
      spriteNodes = null;
      clearGroup(gSprites);
      clearGroup(gReveal);
      showGroup(gReveal, false);
      showGroup(gSprites, true);
      showGroup(gObserve, true);
      showGroup(gHouse, false);
      observeText.textContent = '题目已生成';
      countText.textContent = '';
      observePeople.style.opacity = 1;
      placeCluster(observePeople, r.initialCount);
      promptText.textContent = '';
      // house starts above screen for later drop
      houseInner.setAttribute('transform', `translate(0,${-(GEO.groundY + 40)})`);
      onPhase('ready');
    }

    function startObserve() {
      if (!round) return;
      phase = 'observe';
      t0 = performance.now();
      observeText.textContent = '请记住人数。';
      showGroup(gObserve, true);
      showGroup(gSprites, true);
      showGroup(gHouse, false);
      showGroup(gReveal, false);
      spriteNodes = null;
      clearGroup(gSprites);
      observePeople.style.opacity = 1;
      onPhase('observe');
      loop();
    }

    function reveal() {
      if (!round) return;
      cancelAnimationFrame(raf);
      phase = 'reveal';
      revealStart = performance.now();
      buildReveal();
      onPhase('reveal');
      loop();
    }

    function reset() {
      cancelAnimationFrame(raf);
      phase = 'idle';
      round = null;
      spriteNodes = null;
      clearGroup(gSprites);
      clearGroup(gReveal);
      clearGroup(observePeople);
      showGroup(gReveal, false);
      showGroup(gSprites, true);
      showGroup(gObserve, true);
      showGroup(gHouse, false);
      observeText.textContent = '等待出题';
      countText.textContent = '';
      promptText.textContent = '';
      onPhase('idle');
    }

    // sprites cache: build DOM nodes for all events once at play start
    let spriteNodes = null;
    function buildSprites() {
      clearGroup(gSprites);
      spriteNodes = [];
      round.events.forEach((ev, i) => {
        const segs = spriteSegments(ev);
        const group = [];
        for (let k = 0; k < ev.n; k++) {
          const node = makePerson(ev.type === 'in' ? 'is-in' : 'is-out');
          node.setAttribute('opacity', 0);
          gSprites.appendChild(node);
          group.push(node);
        }
        spriteNodes.push({ ev, segs, nodes: group });
      });
    }

    function buildReveal() {
      clearGroup(gReveal);
      showGroup(gObserve, false);
      showGroup(gHouse, false);
      showGroup(gSprites, false);
      showGroup(gReveal, true);
      promptText.textContent = '';

      const top = el('text', { x: VB_W / 2, y: 92, class: 'hc-toptext', 'text-anchor': 'middle' });
      top.textContent = '房屋里有几人？';
      gReveal.appendChild(top);

      // red people cluster
      const cluster = el('g', { class: 'hc-revealcluster' });
      gReveal.appendChild(cluster);
      placeCluster(cluster, round.answer, 'is-answer');
      // shift cluster up a bit
      cluster.setAttribute('transform', 'translate(0,-170)');

      // small handwritten number under cluster
      const small = el('text', { x: VB_W / 2, y: 372, class: 'hc-smallnum', 'text-anchor': 'middle' });
      small.textContent = round.answer;
      gReveal.appendChild(small);

      // divider
      gReveal.appendChild(el('line', { x1: 200, y1: 416, x2: VB_W - 200, y2: 416, class: 'hc-divider' }));

      // big number + check
      const big = el('text', { x: VB_W / 2 - 70, y: 590, class: 'hc-bignum', 'text-anchor': 'middle' });
      big.textContent = round.answer;
      gReveal.appendChild(big);
      const check = el('path', {
        d: 'M-60,0 L-18,42 L70,-70',
        class: 'hc-check',
        transform: `translate(${VB_W / 2 + 40},548)`,
      });
      gReveal.appendChild(check);
      // stash for animation
      gReveal._anim = { cluster, small, big, check, top };
    }

    function loop() {
      raf = requestAnimationFrame(loop);
      const now = performance.now();

      if (phase === 'observe' || phase === 'drop' || phase === 'events' || phase === 'settle') {
        const T = round.timings;
        const t = now - t0;
        if (t < T.observeMs) {
          // observe: countdown 3..1
          phase = 'observe';
          showGroup(gObserve, true);
          showGroup(gHouse, false);
          const remain = T.observeMs - t;
          const n = Math.max(1, Math.ceil(remain / (T.observeMs / 3)));
          countText.textContent = n;
          return;
        }
        // ensure house + sprites built once
        if (!spriteNodes) { buildSprites(); }
        const td = t - T.observeMs;
        if (td < T.dropMs) {
          if (phase !== 'drop') { phase = 'drop'; onPhase('drop'); }
          showGroup(gHouse, true);
          const p = easeInOut(clamp01(td / T.dropMs));
          const fromY = -(GEO.groundY + 40);
          houseInner.setAttribute('transform', `translate(0,${(fromY * (1 - p)).toFixed(1)})`);
          // hide observe people once house has dropped enough to cover them
          observePeople.style.opacity = p > 0.45 ? 0 : 1;
          countText.textContent = '';
          observeText.textContent = '';
          return;
        }
        // events phase
        houseInner.setAttribute('transform', 'translate(0,0)');
        observePeople.style.opacity = 0;
        showGroup(gObserve, false);
        const te = td - T.dropMs;
        if (phase !== 'events' && phase !== 'settle') { phase = 'events'; onPhase('events'); }
        promptText.textContent = '记住：屋内人数';
        let anyActive = false;
        for (const sp of spriteNodes) {
          const local = (te - sp.ev.startAt) / sp.ev.dur;
          const visible = local >= 0 && local <= 1;
          if (local > -0.001 && local < 1.001) anyActive = anyActive || visible;
          const pos = sampleSegments(sp.segs, local);
          sp.nodes.forEach((node, k) => {
            if (local < 0 || local > 1) { node.setAttribute('opacity', 0); return; }
            const off = (k - (sp.ev.n - 1) / 2) * 30; // spread wave members
            node.setAttribute('opacity', pos.a.toFixed(3));
            node.setAttribute('transform', `translate(${(pos.x + off).toFixed(1)},${pos.y.toFixed(1)}) scale(${pos.s.toFixed(3)})`);
          });
        }
        if (te >= T.eventsSpan) {
          phase = 'settle';
          promptText.textContent = '请作答';
          onPhase('settle');
        }
        return;
      }

      if (phase === 'reveal') {
        const a = gReveal._anim;
        if (!a) return;
        const t = clamp01((now - revealStart) / 900);
        const t2 = clamp01((now - revealStart - 500) / 600);
        a.cluster.setAttribute('opacity', t.toFixed(3));
        a.small.setAttribute('opacity', t.toFixed(3));
        a.big.setAttribute('opacity', t2.toFixed(3));
        // check draws on with stroke-dashoffset
        const len = 260;
        a.check.style.strokeDasharray = len;
        a.check.style.strokeDashoffset = (len * (1 - t2)).toFixed(1);
        if (t2 >= 1) { cancelAnimationFrame(raf); }
        return;
      }
    }

    // init
    reset();

    return {
      setRound,
      startObserve,
      reveal,
      reset,
      get phase() { return phase; },
      get round() { return round; },
    };
  }

  global.HeadCount = {
    PRESETS, PRESET_ORDER,
    generateRound, describeEvent, makeSeedString,
    HeadCountStage,
  };
})(typeof window !== 'undefined' ? window : this);
