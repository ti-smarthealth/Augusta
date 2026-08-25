// Re-emit the editable .drawio files from the same tables the SVGs are built
// from, so a round trip through draw.io starts from the corrected grid rather
// than the hand-nudged one.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drawio } from './drawio.mjs';
import { NODES, EDGES, FUT_X, CUR_X, FUTURE_ONLY, ROW, geometry } from './build.mjs';

const IN_SUBNET = new Set(['apiL', 'mig', 'rollW', 'escW', 'adminL', 'rds']);
// the SVG grid is denser than draw.io's default 78px icon, so pull the rows in
const dy = (r) => ROW[r] - 20;

function emit(file, name, colX, skip) {
  const g = geometry(colX);
  const nodes = NODES
    .filter(([id]) => !skip.has(id))
    .map(([id, c, r, icon, svc, desc, opt = {}]) => ({
      id, x: colX[c] + 49, y: dy(r), icon, svc, desc,
      parent: IN_SUBNET.has(id) ? 'sub' : undefined,
      ...opt,
    }));

  const edges = EDGES
    .filter(([from, to]) => !skip.has(from) && !skip.has(to))
    .map(([from, to, label, cls]) => ({
      from, to, label: label.replace('\n', ' '), cls,
      accent: FUTURE_ONLY.has(from) || FUTURE_ONLY.has(to),
    }));

  const groups = [
    { id: 'cloud', kind: 'cloud', label: 'AWS Cloud — ap-east-2', ...g.cloud },
    { id: 'vpc', kind: 'vpc', label: 'VPC', ...g.vpc, parent: 'cloud' },
    { id: 'sub', kind: 'subnet', label: 'Private subnets — no route to the internet', ...g.sub, parent: 'vpc' },
  ];

  writeFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), drawio({ name, nodes, groups, edges }));
  console.log(`${file}  ${nodes.length} nodes, ${edges.length} edges`);
}

emit('tish-aws-future.drawio', 'Tish AWS — target', FUT_X, new Set());
emit('tish-aws-current.drawio', 'Tish AWS — current', CUR_X, new Set(FUTURE_ONLY));
