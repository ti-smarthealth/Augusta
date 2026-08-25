// The model both architecture drawings are generated from: a node table, a
// connection table, and the grid they are laid out on.
//
// The node placement is the arrangement from tish-aws-future-rearranged.drawio,
// snapped to a regular 8-column x 7-row grid, with a wider gutter after column
// 4 (so the VPC and subnet boundaries have somewhere to sit) and after column 6
// (so the AWS Cloud boundary does).
//
// The current-state diagram reuses the same grid with column 5 removed, so the
// two drawings line up when flipped between.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as A from './primitives.mjs';

const { NODE_W, ICON, node, group, edge, svg, text, box, nodeH, anchor, cx, icy, CLS, NEW, MUTED } = A;

// --- grid ------------------------------------------------------------------
const ROW = [56, 268, 464, 660, 856, 1176, 1372];

// horizontal routing lanes, each in the clear band between two rows
const L = {
  h1a: 428, h1b: 444,     // between the identity row and the API row
  h3: 818,                 // between the compute row and the analytics row
  h4: 1020,                // between the analytics row and the VPC boundary
  h5: 1334,                // inside the subnet, above the database
};

const VPC_TOP = 1064, SUB_TOP = 1108, SUB_BOT = 1516, VPC_BOT = 1540;
const CLOUD_TOP = 216, CLOUD_BOT = 1580;

/** everything that depends on which columns a given diagram uses */
function geometry(colX) {
  const present = Object.keys(colX).map(Number).sort((a, b) => a - b);
  const nextCol = (k) => present.find((p) => p > k);
  return {
    X: colX,
    /** the clear vertical lane just to the right of column k */
    V: (k) => (colX[k] + NODE_W + colX[nextCol(k)]) / 2,
    farLeft: colX[0] - 54,
    /** a clear lane tucked against the left edge of column k */
    gutterL: (k) => (colX[k] ?? colX[nextCol(k)]) - 20,
    cloud: { x: colX[0] - 76, y: CLOUD_TOP, w: (colX[7] - 44) - (colX[0] - 76), h: CLOUD_BOT - CLOUD_TOP },
    vpc: { x: colX[0] - 32, y: VPC_TOP, w: (colX[4] + NODE_W + 32) - (colX[0] - 32), h: VPC_BOT - VPC_TOP },
    sub: { x: colX[0] - 12, y: SUB_TOP, w: (colX[4] + NODE_W + 14) - (colX[0] - 12), h: SUB_BOT - SUB_TOP },
    width: colX[7] + NODE_W + 60,
  };
}

// --- nodes -----------------------------------------------------------------
// [id, col, row, icon, service, description, {new}]
const NODES = [
  ['mobile', 0, 0, 'mobile', 'Client', 'Patient mobile app'],
  ['web', 2, 0, 'client', 'Client', 'Patient web browser', { isNew: true }],
  ['adminui', 5, 0, 'client', 'Client', 'Admin web browser', { curCol: 4 }],

  ['cogP', 1, 1, 'cognito', 'Amazon Cognito', 'Patient accounts'],
  ['ampP', 2, 1, 'amplify', 'AWS Amplify Hosting', 'Patient web site', { isNew: true }],
  ['r53', 3, 1, 'route53', 'Amazon Route 53', 'Public DNS'],
  ['amp', 4, 1, 'amplify', 'AWS Amplify Hosting', 'Admin dashboard'],

  ['apiP', 0, 2, 'apigw', 'Amazon API Gateway', 'Patient API'],
  ['signup', 2, 2, 'lambda', 'AWS Lambda', 'Staff sign-up gate'],
  ['cogS', 3, 2, 'cognito', 'Amazon Cognito', 'Staff accounts'],
  ['apiA', 4, 2, 'apigw', 'Amazon API Gateway', 'Admin API'],
  ['ops', 6, 2, 'lambda', 'AWS Lambda', 'Admin ops & health'],
  ['gh', 7, 2, 'generic', 'GitHub', 'Translation commits'],

  ['ingest', 0, 3, 'lambda', 'AWS Lambda', 'Telemetry ingest'],
  ['fh', 1, 3, 'firehose', 'Amazon Data Firehose', 'Event buffer'],
  ['sched', 2, 3, 'eventbridge', 'Amazon EventBridge', 'Job schedules'],
  ['escD', 3, 3, 'lambda', 'AWS Lambda', 'Escalation driver'],
  ['expo', 7, 3, 'internet', 'Expo Push', 'Caregiver alerts'],

  ['s3', 0, 4, 's3', 'Amazon S3', 'Raw event store'],
  ['ath', 1, 4, 'athena', 'Amazon Athena + Glue', 'Event queries'],
  ['rollD', 2, 4, 'lambda', 'AWS Lambda', 'Rollup driver'],
  ['mb', 5, 4, 'ec2', 'Amazon EC2', 'Metabase BI server', { isNew: true }],
  ['ebs', 6, 4, 'ebs', 'Amazon EBS', 'BI disk & snapshots', { isNew: true }],

  ['apiL', 0, 5, 'lambda', 'AWS Lambda', 'Patient API'],
  ['mig', 1, 5, 'lambda', 'AWS Lambda', 'Schema migrations'],
  ['rollW', 2, 5, 'lambda', 'AWS Lambda', 'Rollup writer'],
  ['escW', 3, 5, 'lambda', 'AWS Lambda', 'Escalation writer'],
  ['adminL', 4, 5, 'lambda', 'AWS Lambda', 'Admin data API'],
  ['cw', 6, 5, 'cloudwatch', 'Amazon CloudWatch', 'Logs, metrics, alarms'],

  ['rds', 2, 6, 'rds', 'Amazon RDS for PostgreSQL', 'Care data & rollups'],
  ['sns', 6, 6, 'sns', 'Amazon SNS', 'Alert fan-out'],
  ['oncall', 7, 6, 'email', 'Email subscription', 'On-call inbox', { isNew: true }],
];

// --- route builders --------------------------------------------------------
const P = (x, y) => ({ x, y });

/** straight down the column */
const vline = (a, b, oa = 0, ob = 0) => [anchor(a, 'bottom', oa), anchor(b, 'top', ob)];
/** straight across the row, at icon height */
const hline = (a, b, oa = 0, ob = 0) => {
  const right = b.x > a.x;
  return [anchor(a, right ? 'right' : 'left', oa), anchor(b, right ? 'left' : 'right', ob)];
};
/** down, along a lane, then down again */
const vjog = (a, b, laneY, oa = 0, ob = 0) => {
  const p = anchor(a, 'bottom', oa), q = anchor(b, 'top', ob);
  return [p, P(p.x, laneY), P(q.x, laneY), q];
};
/** out sideways, along a vertical lane, then back in sideways */
const hjog = (a, b, laneX, sa, sb, oa = 0, ob = 0) => {
  const p = anchor(a, sa, oa), q = anchor(b, sb, ob);
  return [p, P(laneX, p.y), P(laneX, q.y), q];
};
/** out sideways, along a vertical lane, then into the top */
const hvjog = (a, b, laneX, laneY, sa, oa = 0, ob = 0) => {
  const p = anchor(a, sa, oa), q = anchor(b, 'top', ob);
  return [p, P(laneX, p.y), P(laneX, laneY), P(q.x, laneY), q];
};

/** down out of the bottom, along a lane, down again, then in from the side */
const vhjog = (a, b, laneY, laneX, sb, oa = 0, ob = 0) => {
  const p = anchor(a, 'bottom', oa), q = anchor(b, sb, ob);
  return [p, P(p.x, laneY), P(laneX, laneY), P(laneX, q.y), q];
};

/** place a label beside one segment of a route */
function place(pts, o = {}) {
  const i = o.seg ?? 0;
  const p = pts[i], q = pts[i + 1];
  const t = o.t ?? 0.5;
  if (Math.abs(p.y - q.y) >= 1 && Math.abs(p.x - q.x) >= 1) {
    // a diagonal has no clear side to sit on, so it takes an explicit offset
    return {
      lx: p.x + (q.x - p.x) * t + (o.dx ?? 0),
      ly: p.y + (q.y - p.y) * t + (o.dy ?? 0),
      anchor: o.anchor ?? 'middle',
    };
  }
  if (Math.abs(p.y - q.y) < 1) {
    return {
      lx: p.x + (q.x - p.x) * t + (o.dx ?? 0),
      ly: p.y - 12 + (o.dy ?? 0),
      anchor: o.anchor ?? 'middle',
    };
  }
  const right = (o.side ?? 'right') === 'right';
  return {
    lx: p.x + (right ? 11 : -11) + (o.dx ?? 0),
    ly: p.y + (q.y - p.y) * t + (o.dy ?? 0),
    anchor: o.anchor ?? (right ? 'start' : 'end'),
  };
}

// --- connections -----------------------------------------------------------
// cls: tel = telemetry pipeline, admin = admin & observability plane,
//      ext = crosses the AWS account boundary, plain = everything else
const EDGES = [
  ['mobile', 'apiP', 'signs in, calls API', 'ext',
    (g, N) => vline(N.mobile, N.apiP), { side: 'left', t: 0.72 }],
  ['cogP', 'apiP', 'authorises', 'plain',
    (g, N, v) => (v === 'current'
      ? [anchor(N.cogP, 'bottom'), P(cx(N.cogP), anchor(N.apiP, 'right', -14).y), anchor(N.apiP, 'right', -14)]
      : [anchor(N.cogP, 'bottom'), anchor(N.apiP, 'right', -14)]),
    { t: 0.5, dx: 97, dy: -20, anchor: 'start', current: { seg: 1, t: 0.5, dx: 0, dy: 0, anchor: 'middle' } }],
  ['ampP', 'apiP', 'calls API', 'plain',
    (g, N) => hjog(N.ampP, N.apiP, g.V(1), 'left', 'right', 0, 14), { seg: 1, t: 0.5 }],
  ['web', 'ampP', 'loads site', 'ext', (g, N) => vline(N.web, N.ampP), { t: 0.25 }],
  ['adminui', 'amp', 'loads site', 'ext',
    (g, N, v) => (v === 'current'
      ? vline(N.adminui, N.amp)
      : [anchor(N.adminui, 'left'), P(cx(N.amp), icy(N.adminui)), anchor(N.amp, 'top')]),
    { seg: 0, current: { t: 0.4 } }],
  ['r53', 'amp', 'resolves', 'plain', (g, N) => hline(N.r53, N.amp), {}],
  ['r53', 'ampP', 'resolves', 'plain', (g, N) => hline(N.r53, N.ampP), { t: 0.3 }],
  ['amp', 'apiA', 'calls API', 'admin', (g, N) => vline(N.amp, N.apiA), { t: 0.55 }],
  ['cogS', 'apiA', 'authorises', 'admin', (g, N) => hline(N.cogS, N.apiA), {}],
  ['cogS', 'signup', 'pre-sign-up trigger', 'admin', (g, N) => hline(N.cogS, N.signup), {}],

  ['apiP', 'ingest', 'app-open events', 'tel', (g, N) => vline(N.apiP, N.ingest), { t: 0.55 }],
  ['apiP', 'apiL', 'doses,\nreminders', 'plain',
    (g, N) => hjog(N.apiP, N.apiL, g.farLeft, 'left', 'left'),
    { seg: 1, t: 0.4, side: 'right', dy: -10 }],

  ['ingest', 'fh', 'batched records', 'tel', (g, N) => hline(N.ingest, N.fh), {}],
  ['fh', 's3', 'every 5 min', 'tel', (g, N) => vjog(N.fh, N.s3, L.h3), { seg: 1 }],
  ['s3', 'ath', 'queried in place', 'tel', (g, N) => hline(N.s3, N.ath), {}],
  ['ath', 'rollD', 'nightly read', 'tel', (g, N) => hline(N.ath, N.rollD), {}],
  ['sched', 'rollD', 'nightly', 'tel', (g, N) => vline(N.sched, N.rollD), { t: 0.5 }],
  ['rollD', 'rollW', 'invoke', 'tel', (g, N) => vline(N.rollD, N.rollW), { t: 0.24 }],

  ['sched', 'escD', 'every minute', 'plain', (g, N) => hline(N.sched, N.escD), {}],
  ['escD', 'expo', 'push to caregiver', 'ext', (g, N) => hline(N.escD, N.expo), { t: 0.6 }],
  ['escD', 'escW', 'invoke', 'plain', (g, N) => vline(N.escD, N.escW), { t: 0.2 }],

  ['apiA', 'ops', 'ops requests', 'admin', (g, N) => hline(N.apiA, N.ops), { t: 0.5 }],
  ['apiA', 'adminL', 'tables, adherence', 'admin', (g, N) => vline(N.apiA, N.adminL),
    { t: 0.385, dy: 8 }],
  ['ops', 'gh', 'commits', 'ext', (g, N) => hline(N.ops, N.gh, -14, -14),
    { t: 0.22, anchor: 'start' }],

  ['apiL', 'rds', '', 'plain', (g, N) => vjog(N.apiL, N.rds, L.h5, 0, -48), {}],
  ['mig', 'rds', '', 'plain', (g, N) => vjog(N.mig, N.rds, L.h5, 0, -24), {}],
  ['rollW', 'rds', '', 'tel', (g, N) => vline(N.rollW, N.rds), {}],
  ['escW', 'rds', '', 'plain', (g, N) => vjog(N.escW, N.rds, L.h5, 0, 24), {}],
  ['adminL', 'rds', '', 'admin', (g, N) => vjog(N.adminL, N.rds, L.h5, 0, 48), {}],

  ['adminL', 'cw', 'logs & metrics', 'admin', (g, N) => hline(N.adminL, N.cw), { t: 0.72 }],
  ['ops', 'cw', 'reads alarm state', 'admin',
    (g, N) => hjog(N.ops, N.cw, g.V(6), 'right', 'right', 14), { seg: 1, t: 0.84, side: 'left' }],
  ['cw', 'sns', 'on alarm', 'admin', (g, N) => vline(N.cw, N.sns), { t: 0.55 }],

  ['rollD', 'mb', 'ad-hoc queries', 'tel', (g, N) => hline(N.rollD, N.mb), { t: 0.5 }],
  ['mb', 'ebs', 'persists', 'tel', (g, N) => hline(N.mb, N.ebs), {}],
  ['mb', 'rds', 'care data', 'tel',
    (g, N) => [anchor(N.mb, 'bottom'), P(cx(N.mb), icy(N.rds)), anchor(N.rds, 'right')],
    { seg: 1, t: 0.6 }],
  ['adminui', 'mb', 'opens BI', 'ext', (g, N) => vline(N.adminui, N.mb), { t: 0.2 }],
  ['sns', 'oncall', 'notifies', 'ext', (g, N) => hline(N.sns, N.oncall), { t: 0.42 }],
];

// the shared caption for the five lines converging on the database
const RDS_CAPTION = ['reads & writes over 5432', 'plain'];

// nodes and connections that do not exist yet
const FUTURE_ONLY = new Set(['web', 'ampP', 'mb', 'ebs', 'oncall']);

// --- assembly --------------------------------------------------------------
function build({ file, title, colX, skip, variant }) {
  const g = geometry(colX);
  const N = {};
  for (const [id, c, r, icon, svc, desc, opt = {}] of NODES) {
    if (skip.has(id)) continue;
    // a node may sit in a different column when the drawing omits its neighbour
    const col = variant === 'current' && opt.curCol !== undefined ? opt.curCol : c;
    N[id] = { id, x: colX[col], y: ROW[r], icon, svc, desc, ...opt };
  }

  const edges = [];
  for (const [from, to, label, cls, route, lo] of EDGES) {
    if (skip.has(from) || skip.has(to)) continue;
    const pts = route(g, N, variant);
    const faded = FUTURE_ONLY.has(from) || FUTURE_ONLY.has(to);
    // a route that differs between the two drawings needs its label moved too
    const opts = variant === 'current' && lo.current ? { ...lo, ...lo.current } : lo;
    edges.push({ from, to, label, cls, pts, faded, ...place(pts, opts) });
  }

  const list = Object.values(N);
  const body = [
    group({ kind: 'cloud', icon: 'gCloud', label: 'AWS Cloud', label2: 'ap-east-2', ...g.cloud }),
    group({ kind: 'vpc', icon: 'gVpc', label: 'VPC', ...g.vpc }),
    group({ kind: 'subnet', icon: 'gSubnet', label: 'Private subnets · no route to the internet', ...g.sub }),
    ...edges.map(edge),
    text(colX[3] + 134, L.h5 + 18, RDS_CAPTION[0], { size: 11.5, fill: CLS[RDS_CAPTION[1]], anchor: 'start' }),
    ...list.map(node),
    legend(colX[0] - 56, CLOUD_BOT + 34, skip.size === 0),
  ].join('\n');

  const w = g.width, h = CLOUD_BOT + (skip.size === 0 ? 110 : 84);
  if (file) {
    writeFileSync(file, svg({
      w, h, title,
      iconKeys: [...list.map((n) => n.icon), 'gCloud', 'gVpc', 'gSubnet'],
      body,
    }));
  }
  return { g, N, edges, list, w, h };
}

/** colour key, plus the "not yet built" marker when the drawing has one */
function legend(x, y, withNew) {
  const keys = [
    ['tel', 'telemetry pipeline'],
    ['admin', 'admin & observability'],
    ['ext', 'leaves AWS'],
    ['plain', 'everything else'],
  ];
  let cur = x;
  const out = keys.map(([k, s]) => {
    const at = cur;
    cur += 34 + A.textWidth(s, 12, false) + 26;
    return `<path d="M ${at} ${y} L ${at + 26} ${y}" stroke="${CLS[k]}" stroke-width="1.7" fill="none"
      marker-end="url(#arw-${k})"/>`
      + text(at + 34, y + 4, s, { size: 12, fill: CLS[k], anchor: 'start' });
  });
  if (withNew) {
    out.push(`<rect x="${cur}" y="${y - 11}" width="24" height="22" rx="6" fill="none"
      stroke="${NEW}" stroke-width="1.8" stroke-dasharray="5 4"/>`
      + text(cur + 32, y + 4, 'not yet built',
          { size: 12, fill: NEW, anchor: 'start' }));
  }
  return `<g>${out.join('')}</g>`;
}

// --- run -------------------------------------------------------------------
const FUT_X = { 0: 110, 1: 322, 2: 534, 3: 746, 4: 958, 5: 1260, 6: 1472, 7: 1814 };
const CUR_X = { 0: 110, 1: 322, 2: 534, 3: 746, 4: 958, 6: 1220, 7: 1562 };

const DIAGRAMS = [
  ['future', 'tish-aws-future.svg', FUT_X, [],
    'Target Tish AWS architecture: the current system plus an Amplify-hosted patient web app, '
    + 'a Metabase BI server on EC2 with EBS storage, and an email subscription to the alarm topic.'],
  ['current', 'tish-aws-current.svg', CUR_X, [...FUTURE_ONLY],
    'Current Tish AWS architecture in ap-east-2: patient and admin API gateways, the telemetry '
    + 'pipeline through Firehose to S3 and Athena, VPC-private Lambdas writing to RDS, and CloudWatch alarms.'],
];

/** output sits beside the source tree, not in whatever directory node was run from */
const OUT = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));

/** both drawings; pass write: false to get the model without emitting files */
function buildAll({ write = true } = {}) {
  const out = {};
  for (const [variant, file, colX, skip, title] of DIAGRAMS) {
    out[variant] = build({
      file: write ? OUT(file) : null, title, colX, variant, skip: new Set(skip),
    });
    out[variant].file = file;
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const d of Object.values(buildAll())) {
    console.log(`${d.file.padEnd(24)} ${d.w}x${d.h}  ${d.list.length} nodes, ${d.edges.length} edges`);
  }
}

export { build, buildAll, NODES, EDGES, FUT_X, CUR_X, FUTURE_ONLY, ROW, L, geometry, RDS_CAPTION };
