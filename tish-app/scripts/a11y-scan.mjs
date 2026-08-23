// Flags interactive elements that will reach the accessibility tree with no name.
//
// Only primitives are checked. Wrapper components (Chip, Menu.Item, List.Item,
// and the app's own MetricItem / RailLink) either derive a name from a prop or
// set one internally, so flagging their call sites would be noise.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Primitives that expose exactly what we give them.
const PRIMITIVE = new Set([
  'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'Pressable',
  'TouchableNativeFeedback', 'IconButton', 'FAB', 'Switch', 'TextInput',
  'Appbar.Action', 'Appbar.BackAction', 'Button',
]);
// Self-naming or delegating — not our problem at the call site.
const DELEGATES = new Set(['Chip', 'Menu.Item', 'List.Item', 'MetricItem', 'RailLink', 'Appbar.Content']);

// Styles that make a Text look like a heading. Anything wearing one of these
// has to say so programmatically too, or screen reader users lose the ability
// to navigate the screen by heading and can only read it top to bottom.
// Paper's Appbar.Content already marks its own title, so it is not listed.
const HEADING_STYLES = ['pageTitle', 'sectionTitle', 'sectionHeaderText'];

function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walkFiles(p, out); }
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const unnamed = [];
let named = 0;
let byText = 0;

for (const file of [...walkFiles(path.join(ROOT, 'app')), ...walkFiles(path.join(ROOT, 'components'))]) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rel = path.relative(ROOT, file).split(path.sep).join('/');

  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const open = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = open.tagName.getText(sf);
      const props = new Map();
      for (const a of open.attributes.properties) if (ts.isJsxAttribute(a)) props.set(a.name.getText(sf), a);
      const line = sf.getLineAndCharacterOfPosition(open.getStart(sf)).line + 1;

      // Deliberately kept out of the accessibility tree (scrims, tap-swallowers).
      const hidden =
        (props.has('accessible') && /false/.test(props.get('accessible').getText(sf))) ||
        (props.has('importantForAccessibility') && /"no/.test(props.get('importantForAccessibility').getText(sf)));

      const isInteractive = props.has('onPress') || props.has('onValueChange') || tag === 'TextInput';
      if (isInteractive && !hidden && PRIMITIVE.has(tag) && !DELEGATES.has(tag)) {
        const hasName = props.has('accessibilityLabel') || props.has('aria-label') || props.has('accessibilityLabelledBy');
        // Any non-whitespace child renders as content, and React Native builds
        // the implicit name from it — whether it is <Text> or a bare {t(...)}.
        const hasContent =
          ts.isJsxElement(node) &&
          node.children.some((c) => {
            if (ts.isJsxText(c)) return c.getText(sf).trim().length > 0;
            if (ts.isJsxExpression(c)) return !!c.expression;
            return true;
          });

        if (hasName) {
          named++;
        } else if (tag !== 'TextInput' && hasContent) {
          // A text child gives React Native an implicit name. Fine for a name,
          // but a bare Pressable still announces without a role.
          byText++;
          if (tag === 'Pressable' || tag.startsWith('Touchable')) {
            if (!props.has('accessibilityRole')) unnamed.push({ rel, line, tag, why: 'text child, but no role' });
          }
        } else {
          unnamed.push({ rel, line, tag, why: 'NO NAME' });
        }
      }

      // A Text wearing a heading style has to be marked as a heading.
      if (tag === 'Text' && props.has('style')) {
        const styleText = props.get('style').getText(sf);
        const looksLikeHeading = HEADING_STYLES.some((s) => styleText.includes('.' + s));
        const marked =
          props.has('accessibilityRole') ||
          props.has('role') ||
          open.attributes.properties.some((a) => ts.isJsxSpreadAttribute(a) && /heading\(/.test(a.getText(sf)));
        if (looksLikeHeading && !marked) {
          unnamed.push({ rel, line, tag, why: 'heading style, not marked as a heading' });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

console.log('explicitly named : ' + named);
console.log('named by text    : ' + byText);
console.log('outstanding      : ' + unnamed.length);

const noName = unnamed.filter((u) => u.why === 'NO NAME');
const noHeading = unnamed.filter((u) => u.why.startsWith('heading style'));
const noRole = unnamed.filter((u) => u.why !== 'NO NAME' && !u.why.startsWith('heading style'));

console.log('\n--- NO ACCESSIBLE NAME (' + noName.length + ') ---');
for (const u of noName) console.log('  ' + u.rel + ':' + u.line + '  ' + u.tag);
console.log('\n--- named, but no button role (' + noRole.length + ') ---');
for (const u of noRole) console.log('  ' + u.rel + ':' + u.line + '  ' + u.tag);
console.log('\n--- heading style, not marked as a heading (' + noHeading.length + ') ---');
for (const u of noHeading) console.log('  ' + u.rel + ':' + u.line + '  add {...heading(n)}');

if (unnamed.length > 0) process.exit(1);
