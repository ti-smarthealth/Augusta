// Read a hand-edited .drawio back into the node/edge model the SVG generator
// uses, resolving container-relative geometry to absolute coordinates.
import { readFileSync } from 'node:fs';

export function parseDrawio(file) {
  const s = readFileSync(file, 'utf8');

  const cells = [];
  // mxCell may be self-closing or wrap an mxGeometry
  for (const m of s.matchAll(/<mxCell\b([^>]*?)(\/>|>([\s\S]*?)<\/mxCell>)/g)) {
    const at = m[1], inner = m[3] ?? '';
    const attr = (k) => (at.match(new RegExp(`\\s${k}="([^"]*)"`)) ?? [])[1];
    const g = inner.match(/<mxGeometry\b([^>]*)/);
    const gat = (k) => (g ? (g[1].match(new RegExp(`\\s${k}="([^"]*)"`)) ?? [])[1] : undefined);
    cells.push({
      id: attr('id'),
      value: (attr('value') ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#10;/g, ' ').replace(/<br\s*\/?>/g, ' '),
      style: attr('style') ?? '',
      parent: attr('parent'),
      source: attr('source'),
      target: attr('target'),
      vertex: attr('vertex') === '1',
      edge: attr('edge') === '1',
      x: gat('x') !== undefined ? Number(gat('x')) : undefined,
      y: gat('y') !== undefined ? Number(gat('y')) : undefined,
      w: gat('width') !== undefined ? Number(gat('width')) : undefined,
      h: gat('height') !== undefined ? Number(gat('height')) : undefined,
    });
  }

  const byId = new Map(cells.map((c) => [c.id, c]));

  // absolute position = own geometry plus every ancestor's
  const abs = (c) => {
    let x = c.x ?? 0, y = c.y ?? 0, p = byId.get(c.parent);
    while (p && p.id !== '1' && p.id !== '0') {
      x += p.x ?? 0; y += p.y ?? 0; p = byId.get(p.parent);
    }
    return { x, y };
  };

  const resIcon = (st) => (st.match(/resIcon=mxgraph\.aws4\.([A-Za-z0-9_]+)/) ?? [])[1];
  const genShape = (st) => (st.match(/shape=mxgraph\.aws4\.([A-Za-z0-9_]+)/) ?? [])[1];

  const nodes = [], groups = [], labels = [], edges = [];
  for (const c of cells) {
    if (c.edge) {
      edges.push({
        id: c.id, from: c.source, to: c.target, label: c.value,
        stroke: (c.style.match(/strokeColor=(#[0-9A-Fa-f]{6})/) ?? [])[1],
      });
      continue;
    }
    if (!c.vertex) continue;
    // plain draw.io groups (an icon bundled with its label) are containers,
    // not nodes — they carry no shape and would otherwise count as blanks
    if (/^group(;|$)/.test(c.style.trim())) continue;
    const p = abs(c);
    if (/shape=mxgraph\.aws4\.group\b/.test(c.style) || /grIcon=/.test(c.style)) {
      groups.push({ id: c.id, label: c.value, ...p, w: c.w, h: c.h, style: c.style });
    } else if (/^text;/.test(c.style)) {
      labels.push({ id: c.id, text: c.value, ...p, w: c.w, h: c.h });
    } else {
      const ri = resIcon(c.style);
      const gs = genShape(c.style);
      nodes.push({
        id: c.id, desc: c.value, ...p, w: c.w, h: c.h,
        shape: ri ?? (gs && gs !== 'resourceIcon' ? gs : undefined),
        opacity: (c.style.match(/opacity=(\d+)/) ?? [])[1],
      });
    }
  }

  // pair each icon with the nearest text cell sitting above it
  for (const n of nodes) {
    let best = null, bestD = Infinity;
    for (const l of labels) {
      const dx = Math.abs((l.x + l.w / 2) - (n.x + n.w / 2));
      const dy = (n.y) - (l.y + l.h);
      if (dx < 120 && dy >= -14 && dy < 60 && dy + dx < bestD) { bestD = dy + dx; best = l; }
    }
    n.svc = best ? best.text : '';
    n.svcId = best ? best.id : null;
  }

  return { nodes, groups, labels, edges, byId };
}
