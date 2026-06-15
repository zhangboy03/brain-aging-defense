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

    // schedule: events on DIFFERENT lanes (door vs chimney) may overlap for
    // liveliness, but the animation must never contradict the head count. Three
    // rules, in order of priority:
    //   1. SAME lane never overlaps — the previous person fully clears plus an
    //      empty beat before the next appears at that spot (keeps in/out
    //      unambiguous when two events hit the same place back-to-back).
    //   2. ORDER is preserved — every event starts no earlier than the one
    //      before it, so what the audience sees matches the event sequence.
    //      Without this a chimney event on an idle lane could be scheduled
    //      ahead of an earlier, still-pending door event and play out of order.
    //   3. NO IMPOSSIBLE EXITS — an "out" never emerges until every preceding
    //      "in" has finished entering, so the animation can't show a person
    //      leaving a house it hasn't yet shown them entering (which the viewer
    //      reads as a negative head count).
    const laneOf = (ev) => (ev.via === 'chimney' ? 'chimney' : 'door');
    const beat = Math.round(p.moveMs * 0.3);  // empty gap after a lane clears
    const laneFree = {};                       // lane -> earliest next start (ms)
    let cursor = 0;
    let span = 0;
    let prevStart = 0;                          // rule 2: monotonic ordering
    let lastInEnd = 0;                          // rule 3: latest "in" completion
    for (const ev of events) {
      const lane = laneOf(ev);
      let startAt = Math.max(cursor, laneFree[lane] || 0, prevStart);
      if (ev.type === 'out') startAt = Math.max(startAt, lastInEnd);
      ev.startAt = startAt;         // ms, relative to start of events phase
      ev.dur = p.moveMs;
      laneFree[lane] = startAt + p.moveMs + beat;
      prevStart = startAt;
      if (ev.type === 'in') lastInEnd = Math.max(lastInEnd, startAt + p.moveMs);
      cursor += p.gapMs;            // nominal cadence for the next event
      span = Math.max(span, startAt + p.moveMs);
    }
    const eventsSpan = span + 120;  // total play time of events phase (+small tail)

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
    groundY: 472,           // feet line / house base
    house: { cx: 500, bodyTop: 298, bodyW: 272, roofApexY: 206, roofW: 352 },
    chimney: { x: 566, w: 40, top: 226, bottom: 300 },
    window: { cx: 500, cy: 352, pane: 23, gap: 9 },  // centered above the door
    door: { w: 70, h: 66 },  // bottom-center of body
    personH: 98,             // person silhouette height at scale 1
    edgeL: -90, edgeR: 1090, // off-screen spawn/exit x
  };

  function el(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  // Person silhouette, origin at feet center (0,0), grows upward (toward -y).
  // Round head (separate circle) + torso with two arms hanging at the sides
  // and two legs apart — friendly "Brain Training" look. ~98px tall at scale 1.
  const PERSON_BODY =
    'M-5,-70 ' +
    'C-11,-70 -14,-68 -15,-64 ' +        // left shoulder
    'C-16,-61 -19,-59 -20,-54 ' +        // upper-left arm
    'L-19,-39 ' +                        // forearm (outer)
    'C-19,-34 -13,-34 -13,-39 ' +        // round the hand
    'L-12,-52 ' +                        // inner arm up to armpit
    'L-11,-28 ' +                        // torso side down to waist
    'L-12,-3 ' +                         // outer left leg
    'C-12,0 -4,0 -4,-3 ' +               // left foot
    'L-3,-25 ' +                         // inner left leg to crotch
    'C-1,-28 1,-28 3,-25 ' +             // crotch
    'L4,-3 ' +                           // inner right leg
    'C4,0 12,0 12,-3 ' +                 // right foot
    'L11,-28 ' +                         // right waist
    'L12,-52 ' +                         // up to right armpit
    'L13,-39 ' +                         // inner right arm
    'C13,-34 19,-34 19,-39 ' +           // round the hand
    'L20,-54 ' +                         // forearm (outer)
    'C19,-59 16,-61 15,-64 ' +           // upper-right arm
    'C14,-68 11,-70 5,-70 ' +            // right shoulder back to neck
    'Z';
  function personPath() {
    return 'M0,-97 a13,13 0 1,0 0.01,0 Z ' + PERSON_BODY;
  }
  function makePerson(cls) {
    const g = el('g', { class: 'hc-person' + (cls ? ' ' + cls : '') });
    g.appendChild(el('circle', { cx: 0, cy: -84, r: 13 }));
    g.appendChild(el('path', { d: PERSON_BODY }));
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

    // NOTE: alpha (a) stays 1 the whole time — people appear/disappear crisply
    // by crossing a screen edge or being occluded by the wall/roof (sprites are
    // drawn behind the house), never by fading. Easier to count.
    if (ev.via === 'door') {
      if (ev.type === 'in') {
        // walk from the side edge to the door; vanishes the instant the wall
        // occludes them (and the event ends) — no fade
        return [
          { frac: 1, from: { x: startX, y: G, s: 1, a: 1 }, to: { x: doorX, y: G, s: 1, a: 1 } },
        ];
      }
      // out: emerge from behind the wall, walk to the side edge — no fade
      return [
        { frac: 1, from: { x: doorX, y: G, s: 1, a: 1 }, to: { x: startX, y: G, s: 1, a: 1 } },
      ];
    }
    // chimney
    if (ev.type === 'in') {
      // slide straight down from off the top edge, then sink into the chimney
      // (the roof occludes them on the way down) — no fade
      return [
        { frac: 0.62, from: { x: chX, y: chTop - 300, s: 1, a: 1 }, to: { x: chX, y: chTop, s: 1, a: 1 } },
        { frac: 0.38, from: { x: chX, y: chTop, s: 1, a: 1 }, to: { x: chX, y: chTop + 64, s: 1, a: 1 } },
      ];
    }
    // chimney out: emerge from the chimney and rise STRAIGHT UP off the top edge — no fade
    return [
      { frac: 0.40, from: { x: chX, y: chTop + 64, s: 1, a: 1 }, to: { x: chX, y: chTop, s: 1, a: 1 } },          // rise out of chimney
      { frac: 0.10, from: { x: chX, y: chTop, s: 1, a: 1 }, to: { x: chX, y: chTop - 14, s: 1, a: 1 } },           // brief beat on top
      { frac: 0.50, from: { x: chX, y: chTop - 14, s: 1, a: 1 }, to: { x: chX, y: chTop - 360, s: 1, a: 1 } },     // straight up, off the top edge
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
      const n = Math.max(0, count | 0);
      if (!n) return;
      const cx = VB_W / 2, base = GEO.groundY;
      // single tidy row; shrink slightly as the count grows so it always fits
      // and people never touch (person ~42px wide; spacing keeps a clear gap).
      const scale = n <= 7 ? 0.96 : 0.86;
      const spacingX = 56 * scale + 14;            // gap-aware spacing
      for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * spacingX;
        const p = makePerson(cls);
        p.setAttribute('transform', `translate(${x.toFixed(1)},${base}) scale(${scale.toFixed(3)})`);
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

    function startObserve(offsetMs) {
      if (!round) return;
      const offset = Math.max(0, Number(offsetMs) || 0);
      phase = 'observe';
      t0 = performance.now() - offset;
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
            const off = (k - (sp.ev.n - 1) / 2) * 46; // spread wave members
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
})(typeof window !== 'undefined' ? window : globalThis);
