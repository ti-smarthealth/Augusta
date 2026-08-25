// Drawing primitives for the architecture SVGs, using the official AWS
// Architecture Icons.
//
// Three things here are load-bearing for how the drawings read:
//   - a node is a block, not just an icon: its bounds include the service name
//     above and the description below, so connections attach outside the words
//     instead of running through them
//   - every connection carries a class that picks its stroke AND its label
//     colour, which means each class needs its own arrowhead marker
//   - anything not built yet renders at half opacity inside a dashed red box

import { readFileSync } from 'node:fs';

// The AWS Architecture Icons this drawing uses, copied out of the official
// package (Icon-package_07312026) into ../icons under their original names.
const ICONS = {
  lambda:      'Arch_AWS-Lambda_64.svg',
  ec2:         'Arch_Amazon-EC2_64.svg',
  apigw:       'Arch_Amazon-API-Gateway_64.svg',
  route53:     'Arch_Amazon-Route-53_64.svg',
  cognito:     'Arch_Amazon-Cognito_64.svg',
  amplify:     'Arch_AWS-Amplify_64.svg',
  rds:         'Arch_Amazon-RDS_64.svg',
  s3:          'Arch_Amazon-Simple-Storage-Service_64.svg',
  ebs:         'Arch_Amazon-Elastic-Block-Store_64.svg',
  firehose:    'Arch_Amazon-Data-Firehose_64.svg',
  athena:      'Arch_Amazon-Athena_64.svg',
  eventbridge: 'Arch_Amazon-EventBridge_64.svg',
  sns:         'Arch_Amazon-Simple-Notification-Service_64.svg',
  cloudwatch:  'Arch_Amazon-CloudWatch_64.svg',
  client:      'Res_Client_48_Light.svg',
  mobile:      'Res_Mobile-client_48_Light.svg',
  email:       'Res_Email_48_Light.svg',
  internet:    'Res_Internet-alt1_48_Light.svg',
  generic:     'Res_Generic-Application_48_Light.svg',
  gCloud:      'AWS-Cloud_32.svg',
  gVpc:        'Virtual-private-cloud-VPC_32.svg',
  gSubnet:     'Private-subnet_32.svg',
};

// group-boundary colours, read out of the AWS group icons themselves
const GROUP = { cloud: '#242F3E', vpc: '#8C4FFF', subnet: '#00A4A6' };

// connection classes. Green traces the telemetry pipeline end to end, red the
// admin/observability plane, blue anything that crosses the account boundary,
// black everything else.
const CLS = {
  tel:   '#1D8348',
  admin: '#C0392B',
  ext:   '#1A6FC4',
  plain: '#232F3E',
};

const INK = '#232F3E';
const MUTED = '#5A6B77';
const PAPER = '#FFFFFF';
const NEW = '#D13212';        // AWS red, used only for the "not yet built" boxes
const SANS = 'Amazon Ember,system-ui,-apple-system,Segoe UI,Roboto,sans-serif';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- icon extraction -------------------------------------------------------
// Every `id` is stripped: ids are document-global even inside <symbol>, and the
// AWS files all reuse names like "Rectangle".
const cache = new Map();
function iconBody(key) {
  if (cache.has(key)) return cache.get(key);
  const raw = readFileSync(new URL(`../icons/${ICONS[key]}`, import.meta.url), 'utf8');
  const vb = raw.match(/viewBox="([^"]+)"/)[1];
  const inner = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/\sid="[^"]*"/g, '')
    .trim();
  const out = { vb, inner };
  cache.set(key, out);
  return out;
}

const symbols = (keys) => [...new Set(keys)].map((k) => {
  const { vb, inner } = iconBody(k);
  return `<symbol id="i-${k}" viewBox="${vb}">${inner}</symbol>`;
}).join('\n');

// --- text metrics ----------------------------------------------------------
// Approximate, but only ever used to reserve space, so erring wide is safe.
const NARROW = `iljtfrI.,;:'!|()[]{} `;
const WIDE = 'mwMW@%';
function textWidth(s, size, bold) {
  let w = 0;
  for (const c of String(s)) {
    w += size * (NARROW.includes(c) ? 0.34 : WIDE.includes(c) ? 0.88 : 0.56);
  }
  return w * (bold ? 1.05 : 1);
}

// --- node geometry ---------------------------------------------------------
const NODE_W = 176, ICON = 64;
const NAME_DY = 13, ICON_DY = 26, DESC_DY = 110;
const NODE_H = 120, NODE_H2 = 137;

const nodeH = (n) => (n.desc2 ? NODE_H2 : NODE_H);
const cx = (n) => n.x + NODE_W / 2;
const icy = (n) => n.y + ICON_DY + ICON / 2;      // icon centre line
/** the whole block: service name, icon, description */
const box = (n) => ({ x: n.x, y: n.y, w: NODE_W, h: nodeH(n) });
/** the dashed "not yet built" marker, when a node has one */
const markBox = (n) => (n.isNew
  ? { x: n.x + 8, y: n.y - 4, w: NODE_W - 16, h: nodeH(n) + 8 } : null);

/**
 * Where a connection meets a node.
 *
 * Vertical attachments sit clear of the text block, because that is what the
 * text would otherwise be clipped by. Horizontal ones sit at the icon's own
 * edge: nothing is drawn at that height, so pulling out to the full block
 * width would only leave a stub of visible line between adjacent columns.
 */
function anchor(n, side, off = 0) {
  const b = box(n);
  if (side === 'top') return { x: cx(n) + off, y: b.y - 3 };
  if (side === 'bottom') return { x: cx(n) + off, y: b.y + b.h + 3 };
  if (side === 'left') return { x: cx(n) - ICON / 2 - 6, y: icy(n) + off };
  return { x: cx(n) + ICON / 2 + 6, y: icy(n) + off };
}

// --- rendering -------------------------------------------------------------
function text(x, y, s, o = {}) {
  if (!s) return '';
  const halo = o.halo === false ? ''
    : `paint-order="stroke" stroke="${PAPER}" stroke-width="3.6" stroke-linejoin="round"`;
  return `<text x="${x}" y="${y}" text-anchor="${o.anchor ?? 'middle'}" font-family="${SANS}" `
    + `font-size="${o.size ?? 12}"${o.weight ? ` font-weight="${o.weight}"` : ''} `
    + `fill="${o.fill ?? INK}" ${halo}>${esc(s)}</text>`;
}

function node(n) {
  const b = box(n);
  const ix = cx(n) - ICON / 2, iy = n.y + ICON_DY;
  const inner = `${text(cx(n), n.y + NAME_DY, n.svc, { size: 11.5, fill: MUTED })}
    <use href="#i-${n.icon}" x="${ix}" y="${iy}" width="${ICON}" height="${ICON}"/>
    ${text(cx(n), n.y + DESC_DY, n.desc, { size: 13.5, weight: '700' })}
    ${n.desc2 ? text(cx(n), n.y + DESC_DY + 17, n.desc2, { size: 13.5, weight: '700' }) : ''}`;
  // the marker box stays fully opaque so it still reads at a glance; only the
  // thing it is marking is dimmed
  const mark = n.isNew
    ? `<rect x="${b.x + 8}" y="${b.y - 4}" width="${b.w - 16}" height="${b.h + 8}" rx="8"
         fill="none" stroke="${NEW}" stroke-width="1.8" stroke-dasharray="5 4"/>` : '';
  return `<g>${mark}<g${n.isNew ? ' opacity="0.5"' : ''}>${inner}</g></g>`;
}

function group(g) {
  const c = GROUP[g.kind];
  const dashed = g.kind !== 'cloud';
  return `<g>
    <rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="4" fill="none"
      stroke="${c}" stroke-width="2"${dashed ? ' stroke-dasharray="7 5"' : ''}/>
    <use href="#i-${g.icon}" x="${g.x + 12}" y="${g.y + 12}" width="26" height="26"/>
    ${text(g.x + 46, g.y + 30, g.label, { size: 12.5, weight: '700', anchor: 'start', fill: c, halo: false })}
    ${g.label2 ? text(g.x + 46, g.y + 45, g.label2, { size: 12.5, weight: '700', anchor: 'start', fill: c, halo: false }) : ''}
  </g>`;
}

/** an orthogonal polyline plus its label, both in the class colour */
function edge(e) {
  const col = CLS[e.cls];
  const d = e.pts.map((p, i) => `${i ? 'L' : 'M'} ${round(p.x)} ${round(p.y)}`).join(' ');
  const op = e.faded ? ' opacity="0.5"' : '';
  const line = `<path d="${d}" fill="none" stroke="${col}" stroke-width="1.7"
    stroke-linejoin="round" marker-end="url(#arw-${e.cls})"${op}/>`;
  const labels = (e.label ? e.label.split('\n') : []).map((s, i) =>
    text(e.lx, e.ly + i * 15, s, { size: 11.5, fill: col, anchor: e.anchor ?? 'middle' })).join('');
  return `<g>${line}${labels ? `<g${op}>${labels}</g>` : ''}</g>`;
}

const round = (v) => Math.round(v * 10) / 10;

function svg({ w, h, title, iconKeys, body }) {
  const markers = Object.entries(CLS).map(([k, c]) =>
    `<marker id="arw-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5"
       orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${c}"/></marker>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
  <defs>
${markers}
${symbols(iconKeys)}
  </defs>
  <rect width="${w}" height="${h}" fill="${PAPER}"/>
${body}
</svg>`;
}

export {
  NODE_W, NODE_H, NODE_H2, ICON, ICON_DY, DESC_DY, NAME_DY,
  GROUP, CLS, INK, MUTED, PAPER, NEW, SANS,
  nodeH, cx, icy, box, markBox, anchor, textWidth,
  text, node, group, edge, svg, esc,
};
