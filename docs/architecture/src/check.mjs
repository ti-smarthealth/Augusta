// Verify the generated drawings: no line through an icon or a word, no label
// sitting on top of anything else, nothing off the canvas.
//
// An earlier version tested lines only against labels, and missed four running
// straight through icons. So it now builds an explicit rectangle for every
// single thing that gets painted and tests every segment against all of them.
// Run it after any change to build.mjs; a layout that looks fine at one screen
// size hides collisions that this catches exactly.

import { buildAll, L, RDS_CAPTION } from './build.mjs';
import { NODE_W, ICON, ICON_DY, NAME_DY, DESC_DY, nodeH, cx, markBox, textWidth } from './primitives.mjs';

const rect = (x, y, w, h, what) => ({ x, y, w, h, what });

/** the three things a node actually paints */
function nodeRects(n) {
  const out = [
    rect(cx(n) - ICON / 2, n.y + ICON_DY, ICON, ICON, `${n.id} icon`),
  ];
  const sw = textWidth(n.svc, 11.5, false);
  out.push(rect(cx(n) - sw / 2, n.y + NAME_DY - 11, sw, 15, `${n.id} service name`));
  const dw = textWidth(n.desc, 13.5, true);
  out.push(rect(cx(n) - dw / 2, n.y + DESC_DY - 12, dw, 17, `${n.id} description`));
  if (n.desc2) {
    const d2 = textWidth(n.desc2, 13.5, true);
    out.push(rect(cx(n) - d2 / 2, n.y + DESC_DY + 5, d2, 17, `${n.id} description`));
  }
  return out;
}

function labelRects(e) {
  const lines = e.label ? e.label.split('\n') : [];
  return lines.map((s, i) => {
    const w = textWidth(s, 11.5, false);
    const x = e.anchor === 'start' ? e.lx : e.anchor === 'end' ? e.lx - w : e.lx - w / 2;
    const r = rect(x, e.ly + i * 15 - 11, w, 15, `label "${s}" (${e.from}->${e.to})`);
    r.edge = e;   // the lines of one label are meant to stack; see below
    return r;
  });
}

const overlap = (a, b, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad &&
  a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/**
 * Does a segment pass through a rect?
 *
 * Liang-Barsky, not a bounding-box test: with a diagonal in the drawing the
 * bounding box covers a large area the line never touches, and every node in
 * that area would be reported as clipped.
 */
function segHitsRect(p, q, r, pad = 0) {
  const dx = q.x - p.x, dy = q.y - p.y;
  const lo = { x: r.x - pad, y: r.y - pad };
  const hi = { x: r.x + r.w + pad, y: r.y + r.h + pad };
  let t0 = 0, t1 = 1;
  for (const [den, num] of [[-dx, p.x - lo.x], [dx, hi.x - p.x], [-dy, p.y - lo.y], [dy, hi.y - p.y]]) {
    if (den === 0) {
      if (num < 0) return false;      // parallel to this edge and outside it
      continue;
    }
    const t = num / den;
    if (den < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

function audit(name, { g, N, edges, list, w, h }) {
  const problems = [];
  // NaN slips through every comparison below, so catch it up front
  for (const n of list) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) problems.push(`${name}: ${n.id} has no grid position`);
  }
  for (const e of edges) {
    for (const p of e.pts) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) problems.push(`${name}: ${e.from}->${e.to} has a point at (${p.x},${p.y})`);
    }
    if (!Number.isFinite(e.lx) || !Number.isFinite(e.ly)) problems.push(`${name}: ${e.from}->${e.to} label is unplaced`);
  }
  if (problems.length) return { problems, warn: [] };

  const nrects = list.flatMap(nodeRects);

  // the shared database caption is drawn outside the edge model
  const capW = textWidth(RDS_CAPTION[0], 11.5, false);
  const caption = rect(g.X[3] + 134, L.h5 + 18 - 11, capW, 15, 'rds caption');

  const lrects = edges.flatMap(labelRects).concat([caption]);

  // 1. lines through icons or words
  for (const e of edges) {
    for (let i = 0; i < e.pts.length - 1; i++) {
      const p = e.pts[i], q = e.pts[i + 1];
      for (const r of nrects) {
        if (segHitsRect(p, q, r)) problems.push(`${name}: ${e.from}->${e.to} seg${i} crosses ${r.what}`);
      }
    }
  }

  // 2. labels on top of icons, words, or each other
  for (const lr of lrects) {
    for (const r of nrects) {
      if (overlap(lr, r)) problems.push(`${name}: ${lr.what} overlaps ${r.what}`);
    }
  }
  for (let i = 0; i < lrects.length; i++) {
    for (let j = i + 1; j < lrects.length; j++) {
      if (lrects[i].edge && lrects[i].edge === lrects[j].edge) continue;
      if (overlap(lrects[i], lrects[j], 2)) {
        problems.push(`${name}: ${lrects[i].what} overlaps ${lrects[j].what}`);
      }
    }
  }

  // 3. labels sitting on a line they do not belong to (the white halo hides a
  //    little of this, so it is a warning rather than a failure)
  const warn = [];
  for (const e of edges) {
    for (const lr of labelRects(e).concat([caption])) {
      for (const o of edges) {
        if (o === e) continue;
        for (let i = 0; i < o.pts.length - 1; i++) {
          if (segHitsRect(o.pts[i], o.pts[i + 1], lr, -3)) {
            warn.push(`${name}: ${lr.what} sits on ${o.from}->${o.to}`);
          }
        }
      }
    }
  }

  // 4. everything inside the canvas
  for (const r of nrects.concat(lrects)) {
    if (r.x < 0 || r.y < 0 || r.x + r.w > w || r.y + r.h > h) {
      problems.push(`${name}: ${r.what} outside the canvas (${Math.round(r.x)},${Math.round(r.y)})`);
    }
  }

  // 5. containment: the subnet holds exactly the VPC-attached lambdas and the
  //    database, and nothing else strays inside a boundary it does not belong to
  const inside = (n, b) => n.x >= b.x && n.x + NODE_W <= b.x + b.w
    && n.y >= b.y && n.y + nodeH(n) <= b.y + b.h;
  const EXPECT_SUB = new Set(['apiL', 'mig', 'rollW', 'escW', 'adminL', 'rds']);
  const EXPECT_OUT = new Set(['mobile', 'web', 'adminui', 'gh', 'expo', 'oncall']);
  for (const n of list) {
    if (inside(n, g.sub) !== EXPECT_SUB.has(n.id)) {
      problems.push(`${name}: ${n.id} is ${inside(n, g.sub) ? '' : 'not '}in the private subnet`);
    }
    if (inside(n, g.cloud) === EXPECT_OUT.has(n.id)) {
      problems.push(`${name}: ${n.id} is ${inside(n, g.cloud) ? '' : 'not '}in the AWS Cloud box`);
    }
  }

  // 6. multiple lines leaving the same node on the same side must be separated
  const exits = new Map();
  for (const e of edges) {
    for (const [id, p, q] of [[e.from, e.pts[0], e.pts[1]], [e.to, e.pts.at(-1), e.pts.at(-2)]]) {
      const n = N[id];
      const side = Math.abs(q.x - p.x) >= Math.abs(q.y - p.y)
        ? (p.x < q.x ? 'right' : 'left')
        : (p.y < q.y ? 'top' : 'bottom');
      const k = `${id}:${side}`;
      if (!exits.has(k)) exits.set(k, []);
      exits.get(k).push({ e, v: side === 'top' || side === 'bottom' ? p.x : p.y });
    }
  }
  for (const [k, arr] of exits) {
    if (arr.length < 2) continue;
    const vs = arr.map((a) => a.v).sort((a, b) => a - b);
    for (let i = 1; i < vs.length; i++) {
      if (vs[i] - vs[i - 1] < 18) {
        problems.push(`${name}: ${arr.length} lines share ${k} only ${Math.round(vs[i] - vs[i - 1])}px apart`);
      }
    }
  }

  // 7. the boundary captions are drawn last but sit low in the box, so lines
  //    entering the top of the first column can run straight through them
  const SUBNET = 'Private subnets · no route to the internet';
  const BOX = [
    ...list.filter((n) => n.isNew).map((n) => [markBox(n), `${n.id} marker`, []]),
    [g.cloud, 'AWS Cloud', ['AWS Cloud', 'ap-east-2']],
    [g.vpc, 'VPC', ['VPC']],
    [g.sub, SUBNET, [SUBNET]],
  ];
  const grects = BOX.flatMap(([b, s, lines]) => (lines.length ? [
    rect(b.x + 12, b.y + 12, 26, 26, `${s} badge`),
    ...lines.map((t, i) =>
      rect(b.x + 46, b.y + 30 + i * 15 - 11, textWidth(t, 12.5, true), 15, `${s} caption`)),
  ] : []));
  for (const e of edges) {
    for (let i = 0; i < e.pts.length - 1; i++) {
      for (const r of grects) {
        if (segHitsRect(e.pts[i], e.pts[i + 1], r)) {
          problems.push(`${name}: ${e.from}->${e.to} seg${i} crosses ${r.what}`);
        }
      }
    }
  }
  for (const lr of lrects) {
    for (const r of grects) if (overlap(lr, r)) problems.push(`${name}: ${lr.what} overlaps ${r.what}`);
  }

  // 8. and nothing may straddle a boundary line itself
  for (const [b, s] of BOX) {
    const edgesOf = [
      [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }],
      [{ x: b.x, y: b.y + b.h }, { x: b.x + b.w, y: b.y + b.h }],
      [{ x: b.x, y: b.y }, { x: b.x, y: b.y + b.h }],
      [{ x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }],
    ];
    for (const r of nrects.concat(lrects)) {
      for (const [p, q] of edgesOf) {
        if (segHitsRect(p, q, r, -2)) problems.push(`${name}: ${r.what} straddles the ${s} boundary`);
      }
    }
  }

  // 9. the colour rules, restated independently of how the edges were written
  const OUTSIDE = new Set(['mobile', 'web', 'adminui', 'gh', 'expo', 'oncall']);
  for (const e of edges) {
    const crosses = OUTSIDE.has(e.from) !== OUTSIDE.has(e.to);
    if (crosses && e.cls !== 'ext') problems.push(`${name}: ${e.from}->${e.to} crosses the account boundary but is ${e.cls}`);
    if (!crosses && e.cls === 'ext') problems.push(`${name}: ${e.from}->${e.to} is marked ext but stays inside AWS`);
  }

  return { problems, warn };
}

const drawings = buildAll({ write: false });

let bad = 0;
for (const [nm, d] of Object.entries(drawings)) {
  const { problems, warn } = audit(nm, d);
  bad += problems.length;
  problems.forEach((p) => console.log('FAIL ', p));
  warn.forEach((p) => console.log('warn ', p));
}
console.log(bad ? `\n${bad} problems` : '\nall clear');
