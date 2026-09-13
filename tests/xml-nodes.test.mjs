import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const xn = require('../scripts/lib/xml-nodes.js');

const WORKFLOW = `<?xml version="1.0" encoding="UTF-8"?>
<Workflow xmlns="http://soap.sforce.com/2006/04/metadata">
    <fieldUpdates>
        <fullName>ChangePriorityToHigh</fullName>
        <field>Priority</field>
        <literalValue>High</literalValue>
        <operation>Literal</operation>
    </fieldUpdates>
    <fieldUpdates>
        <fullName>ChangePriorityToLow</fullName>
        <field>Priority</field>
        <literalValue>Low</literalValue>
        <operation>Literal</operation>
    </fieldUpdates>
    <rules>
        <fullName>Escalate</fullName>
        <active>true</active>
        <criteriaItems>
            <field>Case.Status</field>
            <operation>equals</operation>
            <value>New</value>
        </criteriaItems>
        <triggerType>onAllChanges</triggerType>
    </rules>
</Workflow>
`;

test('outline reports children without their contents', () => {
  const text = xn.outline(WORKFLOW);
  assert.match(text, /^Workflow {2}\d+ B {2}~\d+ tok$/m);
  assert.match(text, /fieldUpdates x2 {2}\[ChangePriorityToHigh, ChangePriorityToLow\]/);
  assert.match(text, /rules x1 {2}\[Escalate\]/);
  // the outline must be far smaller than the file it describes
  assert.ok(text.length < WORKFLOW.length / 3, `outline too large: ${text.length} vs ${WORKFLOW.length}`);
  // and it must not leak leaf values of the nodes it lists
  assert.doesNotMatch(text, /literalValue/);
});

test('get returns one whole element by ordinal', () => {
  const [first] = xn.get(WORKFLOW, 'Workflow/fieldUpdates[0]');
  assert.match(first, /^<fieldUpdates>/);
  assert.match(first, /<\/fieldUpdates>$/);
  assert.match(first, /ChangePriorityToHigh/);
  assert.doesNotMatch(first, /ChangePriorityToLow/);
});

test('get addresses a node by a child value, at any depth', () => {
  const hits = xn.get(WORKFLOW, '//fieldUpdates[fullName=ChangePriorityToLow]');
  assert.equal(hits.length, 1);
  assert.match(hits[0], /<literalValue>Low<\/literalValue>/);
});

test('get returns every match of an unanchored path suffix', () => {
  assert.equal(xn.get(WORKFLOW, '//criteriaItems/field').length, 1);
  assert.equal(xn.get(WORKFLOW, '//field').length, 3);
});

test('setText keeps every byte outside the patched range', () => {
  const { text, changed } = xn.setText(WORKFLOW, '//fieldUpdates[fullName=ChangePriorityToHigh]/literalValue', 'Critical');
  assert.equal(changed, 1);
  assert.match(text, /<literalValue>Critical<\/literalValue>/);
  assert.equal(text.length, WORKFLOW.length + 'Critical'.length - 'High'.length);
  // the untouched sibling is byte-identical
  assert.equal(xn.get(text, '//fieldUpdates[fullName=ChangePriorityToLow]')[0], xn.get(WORKFLOW, '//fieldUpdates[fullName=ChangePriorityToLow]')[0]);
});

test('setText escapes markup in the value', () => {
  const { text } = xn.setText(WORKFLOW, '//rules/fullName', 'A & B <x>');
  assert.match(text, /<fullName>A &amp; B &lt;x&gt;<\/fullName>/);
  assert.equal(xn.leafValue(xn.index(text), xn.select(xn.index(text), '//rules/fullName')[0]), 'A & B <x>');
});

test('setText refuses a node that has element children', () => {
  assert.throws(() => xn.setText(WORKFLOW, 'Workflow/rules', 'nope'), /element children/);
});

test('replaceNodes swaps a whole subtree', () => {
  const { text, changed } = xn.replaceNodes(WORKFLOW, '//fieldUpdates[fullName=ChangePriorityToLow]', '<fieldUpdates><fullName>X</fullName></fieldUpdates>');
  assert.equal(changed, 1);
  assert.equal(xn.get(text, '//fieldUpdates').length, 2);
  assert.doesNotMatch(text, /ChangePriorityToLow/);
});

test('remove takes the element and the blank line it would leave', () => {
  const { text, changed } = xn.remove(WORKFLOW, '//fieldUpdates[fullName=ChangePriorityToHigh]');
  assert.equal(changed, 1);
  assert.equal(xn.get(text, '//fieldUpdates').length, 1);
  assert.doesNotMatch(text, /^\s*$\n\s*<fieldUpdates>/m);
});

test('insert places a sibling at the parent indentation', () => {
  const { text } = xn.insert(WORKFLOW, '//fieldUpdates[1]', '<fieldUpdates><fullName>Third</fullName></fieldUpdates>', 'after');
  const hits = xn.get(text, '//fieldUpdates');
  assert.equal(hits.length, 3);
  assert.match(text, /\n {4}<fieldUpdates><fullName>Third<\/fullName><\/fieldUpdates>/);
});

test('insert adds a child into an existing element', () => {
  const { text } = xn.insert(WORKFLOW, 'Workflow/rules', '<description>why</description>', 'lastChild');
  assert.match(text, /<description>why<\/description>/);
  assert.equal(xn.get(text, '//rules/description').length, 1);
});

test('comments and CDATA never register as elements', () => {
  const src = '<?xml version="1.0"?>\n<A>\n  <!-- <fake>x</fake> -->\n  <b><![CDATA[<c>not an element</c>]]></b>\n</A>\n';
  assert.equal(xn.get(src, '//fake').length, 0);
  assert.equal(xn.get(src, '//c').length, 0);
  assert.equal(xn.get(src, 'A/b').length, 1);
});

test('self-closing elements index and set correctly', () => {
  const src = '<?xml version="1.0"?>\n<A>\n    <b/>\n</A>\n';
  assert.equal(xn.get(src, 'A/b').length, 1);
  const { text } = xn.setText(src, 'A/b', 'v');
  assert.match(text, /<b>v<\/b>/);
});

test('a predicate mid-path scopes the steps after it', () => {
  const [v] = xn.get(WORKFLOW, '//fieldUpdates[fullName=ChangePriorityToLow]/literalValue');
  assert.equal(v, '<literalValue>Low</literalValue>');
  assert.equal(xn.get(WORKFLOW, '//fieldUpdates[fullName=Nope]/literalValue').length, 0);
  assert.equal(xn.get(WORKFLOW, 'Workflow/rules[0]/criteriaItems').length, 1);
});

test('a malformed selector is rejected', () => {
  assert.throws(() => xn.get(WORKFLOW, '//a[b]'), /bad predicate/);
  assert.throws(() => xn.get(WORKFLOW, ''), /empty selector/);
});

test('an anchored selector does not match a deeper path', () => {
  assert.equal(xn.get(WORKFLOW, 'field').length, 0);
  assert.equal(xn.get(WORKFLOW, 'Workflow/fieldUpdates/field').length, 2);
});
