import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const w2f = require('../scripts/lib/workflow-to-flow.js');
const xn = require('../scripts/lib/xml-nodes.js');
const { lintXml } = require('../scripts/lib/xml-lint.js');

/** Flow XSD sequence; the Metadata API rejects children out of this order. */
const FLOW_ORDER = [
  'accessType', 'actionCalls', 'apexPluginCalls', 'apiVersion', 'areMetricsLoggedToDataCloud',
  'assignments', 'choices', 'collectionFilterCriteria', 'collectionProcessors', 'constants',
  'customErrors', 'customProperties', 'dataSpace', 'decisions', 'description', 'dynamicChoiceSets',
  'environments', 'exitRules', 'experiments', 'formulas', 'groups', 'interviewLabel',
  'isAdditionalPermissionRequiredToRun', 'isOverridable', 'isTemplate', 'label', 'loops',
  'migratedFromWorkflowRuleName', 'orchestratedStages', 'overriddenFlow', 'processMetadataValues',
  'processType', 'recordCreates', 'recordDeletes', 'recordLookups', 'recordRollbacks',
  'recordUpdates', 'runInMode', 'screens', 'sourceTemplate', 'stages', 'start',
  'startElementReference', 'status', 'steps', 'subflows', 'textTemplates', 'timeZoneSidKey',
  'transforms', 'triggerOrder', 'variables', 'waits'
];

/** FlowStart XSD sequence, after the inherited FlowNode location fields. */
const START_ORDER = [
  'locationX', 'locationY', 'connector', 'doesRequireRecordChangedToMeetCriteria', 'filterLogic',
  'filters', 'object', 'recordTriggerType', 'triggerType'
];

const WORKFLOW = `<?xml version="1.0" encoding="UTF-8"?>
<Workflow xmlns="http://soap.sforce.com/2006/04/metadata">
    <fieldUpdates>
        <fullName>SetPriorityHigh</fullName>
        <field>Priority</field>
        <literalValue>High</literalValue>
        <operation>Literal</operation>
    </fieldUpdates>
    <fieldUpdates>
        <fullName>FlagEscalated</fullName>
        <field>IsEscalated</field>
        <literalValue>true</literalValue>
        <operation>Literal</operation>
    </fieldUpdates>
    <fieldUpdates>
        <fullName>StampAccount</fullName>
        <field>Description</field>
        <literalValue>touched</literalValue>
        <operation>Literal</operation>
        <targetObject>Account</targetObject>
    </fieldUpdates>
    <fieldUpdates>
        <fullName>ComputeSla</fullName>
        <field>SLA_Due__c</field>
        <formula>NOW() + 1</formula>
        <operation>Formula</operation>
    </fieldUpdates>
    <rules>
        <fullName>Escalate urgent cases</fullName>
        <active>true</active>
        <criteriaItems>
            <field>Case.Status</field>
            <operation>equals</operation>
            <value>New</value>
        </criteriaItems>
        <description>Escalate cases that arrive urgent.</description>
        <triggerType>onCreateOrTriggeringUpdate</triggerType>
        <actions>
            <name>SetPriorityHigh</name>
            <type>FieldUpdate</type>
        </actions>
        <actions>
            <name>FlagEscalated</name>
            <type>FieldUpdate</type>
        </actions>
        <actions>
            <name>StampAccount</name>
            <type>FieldUpdate</type>
        </actions>
        <actions>
            <name>ComputeSla</name>
            <type>FieldUpdate</type>
        </actions>
        <actions>
            <name>NotifyOwner</name>
            <type>Alert</type>
        </actions>
    </rules>
</Workflow>
`;

const base = { workflowXml: WORKFLOW, object: 'Case', apiVersion: '67.0' };

function topLevelNames(xml) {
  const doc = xn.index(xml);
  const root = (doc.childrenOf.get(-1) || [])[0];
  return (doc.childrenOf.get(root) || []).map((i) => doc.nodes[i].name);
}

function isSubsequenceOf(names, order) {
  let at = -1;
  for (const n of names) {
    const next = order.indexOf(n, at + 1);
    if (next === -1) return `${n} is out of order or unknown`;
    at = next;
  }
  return null;
}

test('objectFromFileName reads the object off either naming style', () => {
  assert.equal(w2f.objectFromFileName('force-app/main/default/workflows/Case.workflow-meta.xml'), 'Case');
  assert.equal(w2f.objectFromFileName('workflows/My_Obj__c.workflow'), 'My_Obj__c');
});

test('plan splits actions into before-save, after-save and by-hand', () => {
  const [rule] = w2f.plan(base).rules;
  assert.equal(rule.convertible, true);
  assert.deepEqual(rule.before.map((b) => b.field), ['Priority', 'IsEscalated']);
  // cross-object write cannot run before save
  assert.deepEqual(rule.after.map((a) => a.name), ['StampAccount', 'NotifyOwner']);
  // same record, but the value is not derivable here
  assert.deepEqual(rule.manual.map((m) => m.name), ['ComputeSla']);
  assert.equal(rule.blockers.length, 0);
});

test('plan maps the workflow trigger type and the change gate', () => {
  const [rule] = w2f.plan(base).rules;
  assert.equal(rule.recordTriggerType, 'CreateAndUpdate');
  assert.equal(rule.requireChange, true);
  const onCreate = w2f.plan({ ...base, workflowXml: WORKFLOW.replace('onCreateOrTriggeringUpdate', 'onCreateOnly') }).rules[0];
  assert.equal(onCreate.recordTriggerType, 'Create');
  assert.equal(onCreate.requireChange, false);
  const onAll = w2f.plan({ ...base, workflowXml: WORKFLOW.replace('onCreateOrTriggeringUpdate', 'onAllChanges') }).rules[0];
  assert.equal(onAll.recordTriggerType, 'CreateAndUpdate');
  assert.equal(onAll.requireChange, false);
});

test('plan strips the object prefix from criteria fields and maps the operator', () => {
  const [rule] = w2f.plan(base).rules;
  assert.deepEqual(rule.criteria.map((c) => [c.flowField, c.flowOperator]), [['Status', 'EqualTo']]);
});

test('an operator with no Flow equivalent blocks the rule', () => {
  for (const op of w2f.UNMAPPED_OPERATORS) {
    const [rule] = w2f.plan({ ...base, workflowXml: WORKFLOW.replace('<operation>equals</operation>', `<operation>${op}</operation>`) }).rules;
    assert.equal(rule.convertible, false, `${op} should block`);
    assert.match(rule.blockers.join(' '), new RegExp(op));
  }
});

test('cross-object criteria block the rule', () => {
  const [rule] = w2f.plan({ ...base, workflowXml: WORKFLOW.replace('<field>Case.Status</field>', '<field>Account.Rating</field>') }).rules;
  assert.equal(rule.convertible, false);
  assert.match(rule.blockers.join(' '), /reads another object/);
});

test('a formula-based rule is never converted silently', () => {
  const withFormula = WORKFLOW.replace('<description>Escalate', '<formula>ISNEW()</formula>\n        <description>Escalate');
  const [rule] = w2f.plan({ ...base, workflowXml: withFormula }).rules;
  assert.equal(rule.convertible, false);
  assert.match(rule.blockers.join(' '), /formula/);
});

test('time-dependent actions block the rule', () => {
  const withTimer = WORKFLOW.replace('    </rules>', `        <workflowTimeTriggers>
            <actions>
                <name>SetPriorityHigh</name>
                <type>FieldUpdate</type>
            </actions>
            <timeLength>1</timeLength>
            <workflowTimeTriggerUnit>Days</workflowTimeTriggerUnit>
        </workflowTimeTriggers>
    </rules>`);
  const [rule] = w2f.plan({ ...base, workflowXml: withTimer }).rules;
  assert.equal(rule.convertible, false);
  assert.match(rule.blockers.join(' '), /time-dependent/);
});

test('a field update defined outside the file resolves through the callback', () => {
  const standalone = `<?xml version="1.0" encoding="UTF-8"?>
<WorkflowFieldUpdate xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Decomposed</fullName>
    <field>Subject</field>
    <literalValue>fixed</literalValue>
    <operation>Literal</operation>
</WorkflowFieldUpdate>
`;
  const xml = WORKFLOW.replace('<name>NotifyOwner</name>\n            <type>Alert</type>', '<name>Decomposed</name>\n            <type>FieldUpdate</type>');
  const withResolver = w2f.plan({ ...base, workflowXml: xml, resolveFieldUpdate: (n) => (n === 'Decomposed' ? w2f.parseFieldUpdate(standalone) : null) });
  assert.ok(withResolver.rules[0].before.some((b) => b.field === 'Subject'));
  const without = w2f.plan({ ...base, workflowXml: xml });
  assert.match(without.rules[0].blockers.join(' '), /not defined in this file/);
});

test('the emitted flow is well-formed and in XSD order', () => {
  const out = w2f.convert({ ...base, ruleName: 'Escalate urgent cases' });
  assert.ok(out.xml, 'expected a flow');
  assert.equal(lintXml(out.xml).ok, true, lintXml(out.xml).errors.join('; '));
  assert.equal(isSubsequenceOf(topLevelNames(out.xml), FLOW_ORDER), null);
  const startNames = xn.get(out.xml, 'Flow/start').length === 1
    ? (() => {
        const doc = xn.index(out.xml);
        const s = xn.select(doc, 'Flow/start')[0];
        return (doc.childrenOf.get(s) || []).map((i) => doc.nodes[i].name);
      })()
    : [];
  assert.equal(isSubsequenceOf(startNames, START_ORDER), null);
});

test('the emitted flow is a before-save flow that assigns, never updates', () => {
  const out = w2f.convert({ ...base, ruleName: 'Escalate urgent cases' });
  assert.deepEqual(xn.get(out.xml, 'Flow/start/triggerType'), ['<triggerType>RecordBeforeSave</triggerType>']);
  // a before-save flow must not save the triggering record a second time
  assert.equal(xn.get(out.xml, 'Flow/recordUpdates').length, 0);
  assert.equal(xn.get(out.xml, '//inputReference').length, 0);
  // one Assignment element carries every field, not one element per field
  assert.equal(xn.get(out.xml, 'Flow/assignments').length, 1);
  assert.equal(xn.get(out.xml, '//assignmentItems').length, 2);
  assert.deepEqual(xn.get(out.xml, '//assignToReference'), [
    '<assignToReference>$Record.Priority</assignToReference>',
    '<assignToReference>$Record.IsEscalated</assignToReference>'
  ]);
  assert.deepEqual(new Set(xn.get(out.xml, '//operator').filter((o) => o.includes('Assign'))), new Set(['<operator>Assign</operator>']));
});

test('a literal is typed by inference, and the inference is reported', () => {
  assert.deepEqual(w2f.literalValueElement('true'), { tag: 'booleanValue', value: 'true' });
  assert.deepEqual(w2f.literalValueElement('12.5'), { tag: 'numberValue', value: '12.5' });
  assert.deepEqual(w2f.literalValueElement('High'), { tag: 'stringValue', value: 'High' });
  const out = w2f.convert({ ...base, ruleName: 'Escalate urgent cases' });
  assert.match(out.xml, /<booleanValue>true<\/booleanValue>/);
  assert.match(out.xml, /<stringValue>High<\/stringValue>/);
});

test('the change gate only appears when the rule asked for it', () => {
  const gated = w2f.convert({ ...base, ruleName: 'Escalate urgent cases' });
  assert.equal(xn.get(gated.xml, '//doesRequireRecordChangedToMeetCriteria').length, 1);
  const plain = w2f.convert({ ...base, workflowXml: WORKFLOW.replace('onCreateOrTriggeringUpdate', 'onAllChanges'), ruleName: 'Escalate urgent cases' });
  assert.equal(xn.get(plain.xml, '//doesRequireRecordChangedToMeetCriteria').length, 0);
});

test('the flow is generated inactive and names the rule it came from', () => {
  const out = w2f.convert({ ...base, ruleName: 'Escalate urgent cases' });
  assert.deepEqual(xn.get(out.xml, 'Flow/status'), ['<status>Draft</status>']);
  assert.deepEqual(xn.get(out.xml, 'Flow/migratedFromWorkflowRuleName'), ['<migratedFromWorkflowRuleName>Escalate urgent cases</migratedFromWorkflowRuleName>']);
  assert.equal(out.flowName, 'Case_Escalate_urgent_cases_Before');
  assert.deepEqual(xn.get(out.xml, 'Flow/status'), xn.get(w2f.convert({ ...base, ruleName: 'Escalate urgent cases', status: 'Draft' }).xml, 'Flow/status'));
});

test('a blocked rule yields no XML at all', () => {
  const out = w2f.convert({ ...base, workflowXml: WORKFLOW.replace('<operation>equals</operation>', '<operation>within</operation>'), ruleName: 'Escalate urgent cases' });
  assert.equal(out.xml, null);
  assert.ok(out.blockers.length);
});

test('an unknown rule name is an error, not an empty flow', () => {
  assert.throws(() => w2f.convert({ ...base, ruleName: 'Nope' }), /not found/);
});

test('the plan report stays small and carries no XML', () => {
  const text = w2f.formatPlan(w2f.plan(base));
  assert.ok(text.length < WORKFLOW.length / 2, `plan too large: ${text.length} vs ${WORKFLOW.length}`);
  assert.doesNotMatch(text, /<\/?[a-zA-Z]/, 'the plan must never quote metadata XML');
});
