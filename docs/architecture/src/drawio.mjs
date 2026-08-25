// Emit a native .drawio (mxGraph) file.
//
// Every node is a real mxCell using draw.io's own AWS shape library, so the
// result is editable in place — drag a node and its edges follow. Shape names
// and category colours below were pulled out of draw.io's Sidebar-AWS4.js
// rather than recalled, because a wrong resIcon renders as a blank box with no
// error to tell you.

const GN = 'mxgraph.aws4';

// category -> fill, straight from each palette's own declaration
const CAT = {
  compute: '#ED7100',
  network: '#8C4FFF',
  analytics: '#8C4FFF',
  storage: '#7AA116',
  database: '#C925D1',
  security: '#DD344C',
  frontend: '#DD344C',
  integration: '#E7157B',
  management: '#E7157B',
  general: '#232F3D',
};

// key -> [resIcon, category]. Names verified against the sidebar source.
const SHAPE = {
  lambda:      ['lambda', 'compute'],
  ec2:         ['ec2', 'compute'],
  apigw:       ['api_gateway', 'network'],
  route53:     ['route_53', 'network'],
  cognito:     ['cognito', 'security'],
  amplify:     ['amplify', 'frontend'],
  rds:         ['rds', 'database'],
  s3:          ['s3', 'storage'],
  ebs:         ['elastic_block_store', 'storage'],
  firehose:    ['kinesis_data_firehose', 'analytics'],
  athena:      ['athena', 'analytics'],
  eventbridge: ['eventbridge', 'integration'],
  sns:         ['sns', 'integration'],
  cloudwatch:  ['cloudwatch_2', 'management'],
};

// non-AWS participants use the general resource shapes
// verified against the General Resources palette: it is email_2, not email,
// and GitHub gets a proper repository shape rather than a generic box
const GENERAL = {
  client:   'client',
  mobile:   'mobile_client',
  email:    'email_2',
  internet: 'internet_alt1',
  generic:  'git_repository',
};

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICON = 78;

/** the AWS resource-icon style, label below */
function iconStyle(key) {
  if (SHAPE[key]) {
    const [res, cat] = SHAPE[key];
    return `sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],`
      + `[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];`
      + `outlineConnect=0;fontColor=#232F3E;fillColor=${CAT[cat]};strokeColor=#ffffff;dashed=0;`
      + `verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=1;`
      + `aspect=fixed;shape=${GN}.resourceIcon;resIcon=${GN}.${res};`;
  }
  return `sketch=0;outlineConnect=0;gradientColor=none;fontColor=#545B64;strokeColor=none;`
    + `fillColor=#879196;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;`
    + `html=1;fontSize=12;fontStyle=1;aspect=fixed;shape=${GN}.${GENERAL[key] ?? 'client'};`;
}

const GROUP_STYLE = {
  cloud: `points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],`
    + `[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;`
    + `whiteSpace=wrap;fontSize=12;fontStyle=0;container=1;pointerEvents=0;collapsible=0;`
    + `recursiveResize=0;shape=${GN}.group;grIcon=${GN}.group_aws_cloud_alt;strokeColor=#232F3E;`
    + `fillColor=none;verticalAlign=top;align=left;spacingLeft=30;fontColor=#232F3E;dashed=0;`,
  vpc: `points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],`
    + `[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;`
    + `whiteSpace=wrap;fontSize=12;fontStyle=0;container=1;pointerEvents=0;collapsible=0;`
    + `recursiveResize=0;shape=${GN}.group;grIcon=${GN}.group_vpc2;strokeColor=#8C4FFF;fillColor=none;`
    + `verticalAlign=top;align=left;spacingLeft=30;fontColor=#8C4FFF;dashed=0;`,
  subnet: `points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],`
    + `[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]];outlineConnect=0;gradientColor=none;html=1;`
    + `whiteSpace=wrap;fontSize=12;fontStyle=0;container=1;pointerEvents=0;collapsible=0;`
    + `recursiveResize=0;shape=${GN}.group;grIcon=${GN}.group_security_group;grStroke=0;`
    + `strokeColor=#00A4A6;fillColor=#E6F6F7;verticalAlign=top;align=left;spacingLeft=30;`
    + `fontColor=#147EBA;dashed=0;`,
};

const EDGE_STYLE = 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;jettySize=auto;orthogonalLoop=1;'
  + 'strokeColor=#4B5A65;strokeWidth=1.6;fontSize=11;fontColor=#5A6B77;labelBackgroundColor=#FFFFFF;'
  + 'endArrow=blockThin;endFill=1;';

// telemetry / admin / leaves-AWS / everything else, matching the SVG legend
const CLS = { tel: '#1D8348', admin: '#C0392B', ext: '#1A6FC4', plain: '#232F3E' };
const edgeStyle = (cls, accent) => {
  const c = CLS[cls] ?? CLS.plain;
  return EDGE_STYLE.replace('strokeColor=#4B5A65', `strokeColor=${c}`)
    .replace('fontColor=#5A6B77', `fontColor=${c}`)
    + (accent ? 'dashed=1;dashPattern=6 4;opacity=60;' : '');
};

/**
 * Build the file.
 *
 * `nodes` carry the same descriptions the SVGs use; the AWS service name goes
 * in a separate label cell above the icon, which keeps both independently
 * editable rather than fusing them into one string.
 */
export function drawio({ name, nodes, groups = [], edges = [] }) {
  const cells = [];
  let uid = 0;
  const id = (p) => `${p}-${++uid}`;
  const ids = {};

  // Groups are real containers, and nodes inside one become its children —
  // so dragging the VPC takes its contents with it. Child geometry is relative
  // to the parent, which is why the offsets below are subtracted.
  const gids = {};
  for (const g of groups) {
    const gid = id('grp');
    gids[g.id] = { id: gid, x: g.x, y: g.y };
    const p = g.parent ? gids[g.parent] : null;
    const gx = p ? g.x - p.x : g.x;
    const gy = p ? g.y - p.y : g.y;
    cells.push(`<mxCell id="${gid}" value="${esc(g.label)}" style="${GROUP_STYLE[g.kind]}" vertex="1" parent="${p ? p.id : '1'}">
          <mxGeometry x="${gx}" y="${gy}" width="${g.w}" height="${g.h}" as="geometry"/>
        </mxCell>`);
  }

  for (const n of nodes) {
    const nid = id('n');
    ids[n.id] = nid;
    const p = n.parent ? gids[n.parent] : null;
    const px = p ? n.x - p.x : n.x;
    const py = p ? n.y - p.y : n.y;
    const pid = p ? p.id : '1';
    // icon, with the purpose as its label (draw.io puts it below the shape)
    cells.push(`<mxCell id="${nid}" value="${esc(n.desc)}" style="${iconStyle(n.icon)}${n.isNew ? 'opacity=50;' : ''}" vertex="1" parent="${pid}">
          <mxGeometry x="${px}" y="${py}" width="${ICON}" height="${ICON}" as="geometry"/>
        </mxCell>`);
    // service name, sitting above the icon as its own editable text cell
    cells.push(`<mxCell id="${id('t')}" value="${esc(n.svc)}" style="text;html=1;align=center;verticalAlign=middle;fontSize=11;fontColor=#5A6B77;resizable=1;" vertex="1" parent="${pid}">
          <mxGeometry x="${px - 46}" y="${py - 26}" width="${ICON + 92}" height="20" as="geometry"/>
        </mxCell>`);
  }

  for (const e of edges) {
    const src = ids[e.from], dst = ids[e.to];
    if (!src || !dst) throw new Error(`edge references unknown node: ${e.from} -> ${e.to}`);
    cells.push(`<mxCell id="${id('e')}" value="${esc(e.label)}" style="${edgeStyle(e.cls, e.accent)}" edge="1" parent="1" source="${src}" target="${dst}">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>`);
  }

  return `<mxfile host="app.diagrams.net" type="device">
  <diagram name="${esc(name)}" id="${esc(name.replace(/\s+/g, '-'))}">
    <mxGraphModel dx="1800" dy="1200" grid="1" gridSize="10" guides="1" tooltips="1" connect="1"
      arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="2000"
      math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}

export { SHAPE, GENERAL, ICON };
