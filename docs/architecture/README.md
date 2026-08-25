# AWS architecture diagrams

Two drawings of the Tish deployment in `ap-east-2`, generated from one model so
they stay comparable when you flip between them:

| File | What it shows |
| --- | --- |
| `tish-aws-current.svg` / `.png` | What is deployed today — 27 resources, 29 connections |
| `tish-aws-future.svg` / `.png` | The same, plus everything still to build — 32 resources, 37 connections |

`.drawio` versions of both sit alongside them for hand-editing; see
[Round-tripping through draw.io](#round-tripping-through-drawio).

## Reading them

**Connection colour** says which plane a call belongs to. The legend is drawn on
each diagram, and label text always matches its line:

| Colour | Meaning |
| --- | --- |
| Green | The telemetry pipeline, end to end — ingest → Firehose → S3 → Athena → rollup → RDS, and the BI server that reads from it |
| Red | The admin and observability plane |
| Blue | Anything crossing the AWS account boundary |
| Black | Everything else |

Where classes compete, **blue wins**: `Admin web browser → Metabase BI server`
is blue rather than green, because a call leaving the account is the more
important fact about it.

**Boxes.** The solid dark box is the account boundary; anything drawn outside it
(the two browsers, the phone, GitHub, Expo Push, the on-call inbox) is not ours.
The purple dashed box is the VPC and the teal one the private subnets — and that
inner boundary is the single most important thing on the diagram, because
**there is no NAT gateway and no VPC endpoints**. A Lambda inside it reaches RDS
and nothing else; a Lambda outside it reaches every AWS API but not RDS. That is
why escalation and rollup each appear twice, as a driver and a writer.

**Dashed red boxes** mark what does not exist yet. Those nodes and their
connections are drawn at half opacity, so the current-state picture is legible
by ignoring everything faded. The `tish-aws-current.svg` drawing simply omits
them.

## Regenerating

No dependencies, no install — plain Node with no imports outside `node:`.

```bash
node docs/architecture/src/build.mjs && node docs/architecture/src/check.mjs
```

`build.mjs` writes both SVGs; `check.mjs` verifies the layout and prints
`all clear` or a list of failures. Always run the checker — see below for why.

```bash
node docs/architecture/src/render.mjs
```

Rasterises to PNG using whatever Chrome or Edge is installed. Set `CHROME` to
override the executable.

```bash
node docs/architecture/src/export-drawio.mjs
```

Regenerates the two `.drawio` files from the same model.

## How the model works

Everything lives in `src/build.mjs`, in two tables.

**Nodes** are `[id, column, row, icon, service, description, opts]`, laid out on
an 8×7 grid. Column and row positions come from `FUT_X` / `CUR_X` and `ROW`, and
two gutters are deliberately wider than the rest: after column 5, so the VPC and
subnet boundaries have somewhere to sit, and after column 7, so the account
boundary does. `opts` carries `isNew` (not built yet) and `curCol` (sits in a
different column on the current-state drawing, where its neighbour is absent).

**Connections** are `[from, to, label, class, route, labelOpts]`. The route is a
function of the geometry, so both drawings share it even though their grids
differ; it returns a list of points. The builders cover the common shapes:

| Builder | Shape |
| --- | --- |
| `vline` / `hline` | straight down the column, or across the row |
| `vjog` | down, along a horizontal lane, down again |
| `hjog` | out sideways, along a vertical lane, back in sideways |
| `hvjog` / `vhjog` | the two mixed variants |

Anything else is written as an explicit list of points — the diagonal from
*Patient accounts* is just `[bottom of A, right edge of B]`.

A route may branch on the diagram it is being drawn for, and its label can move
with it:

```js
['cogP', 'apiP', 'authorises', 'plain',
  (g, N, v) => (v === 'current' ? /* drop then turn */ : /* diagonal */),
  { /* future placement */, current: { /* overrides */ } }],
```

**Attachment points** matter. Vertical connections attach outside the text
block, so they never run through a label. Horizontal ones attach at the icon's
edge instead: nothing is drawn at that height, and pulling out to the full block
width would leave only a 36px stub of visible line between adjacent columns.
Where two connections leave the same node on the same side they are offset from
centre so the lines read as two.

## The checker

`src/check.mjs` rebuilds the model without writing files and asserts nine
properties on each drawing:

1. No line passes through an icon or a word
2. No label overlaps an icon, a word, or another label
3. No label sits on a line it does not belong to *(warning only — labels are drawn with a white halo)*
4. Everything is inside the canvas
5. The private subnet contains exactly the VPC-attached Lambdas and RDS, and nothing outside the account boundary is drawn inside it
6. Two lines leaving the same node on the same side are at least 18px apart
7. No line crosses a boundary caption or badge
8. Nothing straddles a boundary line or a "not yet built" marker
9. The colour rules hold — restated independently of how the connections were written, so a mislabelled class is caught rather than confirmed

It also rejects non-finite coordinates up front. That is not theoretical: moving
a node into a column the current-state grid did not have produced `NaN`
positions, and every geometric test below silently passed them, because every
comparison against `NaN` is false.

The segment/rectangle test is Liang–Barsky clipping rather than a bounding-box
check. For horizontal and vertical lines the two agree, but the diagram has one
diagonal, and its bounding box covers most of the patient gateway's labels — a
box test reports collisions that are not there.

## Round-tripping through draw.io

`export-drawio.mjs` writes both diagrams as native mxGraph files using draw.io's
own AWS shape library, so every node is a real editable cell and dragging one
takes its connections with it. Boundaries are containers, so dragging the VPC
moves its contents.

`import-drawio.mjs` reads a hand-edited file back into the same node/edge model.
That is how a rearrangement gets folded back into the generator: parse the
edited file, diff its connections against `EDGES`, and fix up anything that
moved by accident before re-snapping to the grid. Dragging in draw.io very
easily re-anchors an arrow onto a node's *text cell* rather than its icon, or
detaches an endpoint entirely, and neither is visible on screen.

```js
import { parseDrawio } from './src/import-drawio.mjs';
const { nodes, edges, groups } = parseDrawio('some-edited-file.drawio');
```

## Icons

`icons/` holds the 22 files this drawing uses, copied from the official AWS
Architecture Icons package (`Icon-package_07312026`) under their original
names. The full package is ~31 MB; only these are needed.

Shape names for the draw.io export were read out of draw.io's own
`Sidebar-AWS4.js` rather than recalled — four of them would otherwise have been
wrong, and a wrong `resIcon` renders as a blank box with no error.
