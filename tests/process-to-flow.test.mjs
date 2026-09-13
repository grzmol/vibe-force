import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const p2f = require('../scripts/lib/process-to-flow.js');
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

/**
 * A record change process: processType Workflow, one decision with two criteria
 * nodes, a second decision behind the default connector, and a scheduled action.
 */
const PROCESS = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionCalls>
        <name>myRule_2_A1</name>
        <label>Notify owner</label>
        <locationX>500</locationX>
        <locationY>200</locationY>
        <actionName>Case_Notify_Owner</actionName>
        <actionType>emailAlert</actionType>
        <connector>
            <targetReference>myRule_2_A2</targetReference>
        </connector>
    </actionCalls>
    <decisions>
        <name>myDecision</name>
        <label>Case triage</label>
        <locationX>200</locationX>
        <locationY>50</locationY>
        <defaultConnector>
            <targetReference>myDecision2</targetReference>
        </defaultConnector>
        <defaultConnectorLabel>No</defaultConnectorLabel>
        <rules>
            <name>myRule_1</name>
            <conditionLogic>and</conditionLogic>
            <conditions>
                <leftValueReference>myVariable_current.Status</leftValueReference>
                <operator>EqualTo</operator>
                <rightValue>
                    <stringValue>New</stringValue>
                </rightValue>
            </conditions>
            <conditions>
                <leftValueReference>myVariable_current.OwnerId</leftValueReference>
                <operator>EqualTo</operator>
                <rightValue>
                    <elementReference>$User.Id</elementReference>
                </rightValue>
            </conditions>
            <connector>
                <targetReference>myRule_1_A1</targetReference>
            </connector>
            <label>New and mine</label>
        </rules>
        <rules>
            <name>myRule_2</name>
            <conditionLogic>and</conditionLogic>
            <conditions>
                <leftValueReference>myVariable_current.Priority</leftValueReference>
                <operator>IsNull</operator>
                <rightValue>
                    <booleanValue>true</booleanValue>
                </rightValue>
            </conditions>
            <connector>
                <targetReference>myRule_2_A1</targetReference>
            </connector>
            <label>Priority missing</label>
        </rules>
    </decisions>
    <decisions>
        <name>myDecision2</name>
        <label>Escalation</label>
        <locationX>200</locationX>
        <locationY>400</locationY>
        <rules>
            <name>myRule_3</name>
            <conditionLogic>and</conditionLogic>
            <conditions>
                <leftValueReference>myVariable_old.Status</leftValueReference>
                <operator>EqualTo</operator>
                <rightValue>
                    <stringValue>Escalated</stringValue>
                </rightValue>
            </conditions>
            <connector>
                <targetReference>myWait_1</targetReference>
            </connector>
            <label>Was escalated</label>
        </rules>
    </decisions>
    <interviewLabel>Case triage {!$Flow.CurrentDateTime}</interviewLabel>
    <label>Case triage</label>
    <processMetadataValues>
        <name>ObjectType</name>
        <value>
            <stringValue>Case</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>ObjectVariable</name>
        <value>
            <stringValue>myVariable_current</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>OldObjectVariable</name>
        <value>
            <stringValue>myVariable_old</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>TriggerType</name>
        <value>
            <stringValue>onAllChanges</stringValue>
        </value>
    </processMetadataValues>
    <processType>Workflow</processType>
    <recordCreates>
        <name>myRule_2_A2</name>
        <label>Log the gap</label>
        <locationX>700</locationX>
        <locationY>200</locationY>
        <object>Task</object>
    </recordCreates>
    <recordUpdates>
        <name>myRule_1_A1</name>
        <label>Stamp the case</label>
        <locationX>500</locationX>
        <locationY>50</locationY>
        <inputAssignments>
            <field>Priority</field>
            <value>
                <stringValue>High</stringValue>
            </value>
        </inputAssignments>
        <inputAssignments>
            <field>Subject</field>
            <value>
                <elementReference>myVariable_current.Origin</elementReference>
            </value>
        </inputAssignments>
        <inputReference>myVariable_current</inputReference>
    </recordUpdates>
    <startElementReference>myDecision</startElementReference>
    <status>Active</status>
    <variables>
        <name>myVariable_current</name>
        <dataType>SObject</dataType>
        <isCollection>false</isCollection>
        <isInput>true</isInput>
        <isOutput>false</isOutput>
        <objectType>Case</objectType>
    </variables>
    <variables>
        <name>myVariable_old</name>
        <dataType>SObject</dataType>
        <isCollection>false</isCollection>
        <isInput>true</isInput>
        <isOutput>false</isOutput>
        <objectType>Case</objectType>
    </variables>
    <waits>
        <name>myWait_1</name>
        <label>In 2 days</label>
        <locationX>500</locationX>
        <locationY>400</locationY>
        <defaultConnectorLabel>No time set</defaultConnectorLabel>
        <waitEvents>
            <name>myWaitEvent_1</name>
            <conditionLogic>and</conditionLogic>
            <connector>
                <targetReference>myRule_3_SA1</targetReference>
            </connector>
            <eventType>AlarmEvent</eventType>
            <label>2 days after</label>
        </waitEvents>
    </waits>
</Flow>
`;

/**
 * A second process: formula criteria, a cross-object update, an action group that
 * continues to the next criteria node, and a FlowCondition operator that entry
 * conditions do not have.
 */
const CHAINED = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <decisions>
        <name>myDecision</name>
        <label>Large deal</label>
        <locationX>200</locationX>
        <locationY>50</locationY>
        <rules>
            <name>myRule_1</name>
            <conditionLogic>and</conditionLogic>
            <conditions>
                <leftValueReference>myFormula_1</leftValueReference>
                <operator>EqualTo</operator>
                <rightValue>
                    <booleanValue>true</booleanValue>
                </rightValue>
            </conditions>
            <connector>
                <targetReference>myRule_1_A1</targetReference>
            </connector>
            <label>Formula says so</label>
        </rules>
    </decisions>
    <decisions>
        <name>myDecision2</name>
        <label>Now closed</label>
        <locationX>200</locationX>
        <locationY>400</locationY>
        <rules>
            <name>myRule_2</name>
            <conditionLogic>and</conditionLogic>
            <conditions>
                <leftValueReference>myVariable_current.StageName</leftValueReference>
                <operator>IsChanged</operator>
                <rightValue>
                    <booleanValue>true</booleanValue>
                </rightValue>
            </conditions>
            <conditions>
                <leftValueReference>myVariable_current.Account.Industry</leftValueReference>
                <operator>EqualTo</operator>
                <rightValue>
                    <stringValue>Energy</stringValue>
                </rightValue>
            </conditions>
            <connector>
                <targetReference>myRule_2_A1</targetReference>
            </connector>
            <label>Stage changed</label>
        </rules>
    </decisions>
    <formulas>
        <name>myFormula_1</name>
        <dataType>Boolean</dataType>
        <expression>{!myVariable_current.Amount} &gt; 100000</expression>
    </formulas>
    <label>Opportunity governance</label>
    <processMetadataValues>
        <name>ObjectType</name>
        <value>
            <stringValue>Opportunity</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>ObjectVariable</name>
        <value>
            <stringValue>myVariable_current</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>TriggerType</name>
        <value>
            <stringValue>onCreateOrTriggeringUpdate</stringValue>
        </value>
    </processMetadataValues>
    <processMetadataValues>
        <name>RecursionAllowed</name>
        <value>
            <booleanValue>true</booleanValue>
        </value>
    </processMetadataValues>
    <processType>Workflow</processType>
    <recordUpdates>
        <name>myRule_1_A1</name>
        <label>Flag the account</label>
        <locationX>500</locationX>
        <locationY>50</locationY>
        <filterLogic>and</filterLogic>
        <filters>
            <field>Id</field>
            <operator>EqualTo</operator>
            <value>
                <elementReference>myVariable_current.AccountId</elementReference>
            </value>
        </filters>
        <inputAssignments>
            <field>Rating</field>
            <value>
                <stringValue>Hot</stringValue>
            </value>
        </inputAssignments>
        <object>Account</object>
        <connector>
            <targetReference>myDecision2</targetReference>
        </connector>
    </recordUpdates>
    <recordUpdates>
        <name>myRule_2_A1</name>
        <label>Stamp the opportunity</label>
        <locationX>500</locationX>
        <locationY>400</locationY>
        <inputAssignments>
            <field>Description</field>
            <value>
                <elementReference>myVariable_old.StageName</elementReference>
            </value>
        </inputAssignments>
        <inputReference>myVariable_current</inputReference>
    </recordUpdates>
    <startElementReference>myDecision</startElementReference>
    <status>Active</status>
    <variables>
        <name>myVariable_current</name>
        <dataType>SObject</dataType>
        <isInput>true</isInput>
        <objectType>Opportunity</objectType>
    </variables>
    <variables>
        <name>myVariable_old</name>
        <dataType>SObject</dataType>
        <isInput>true</isInput>
        <objectType>Opportunity</objectType>
    </variables>
</Flow>
`;

const FLOW_NOT_PROCESS = PROCESS.replace('<processType>Workflow</processType>', '<processType>AutoLaunchedFlow</processType>');
const INVOCABLE = PROCESS.replace('<processType>Workflow</processType>', '<processType>InvocableProcess</processType>');

const base = { processXml: PROCESS, processName: 'Case_triage', apiVersion: '67.0' };
const chained = { processXml: CHAINED, processName: 'Opportunity_governance', apiVersion: '67.0' };

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

function node(result, name) {
  const hit = result.criteria.find((c) => c.name === name);
  assert.ok(hit, `criteria node ${name} missing from the plan`);
  return hit;
}

test('processFromFileName reads the process name off either naming style', () => {
  assert.equal(p2f.processFromFileName('force-app/main/default/flows/Case_triage.flow-meta.xml'), 'Case_triage');
  assert.equal(p2f.processFromFileName('Case_triage.flow'), 'Case_triage');
});

test('plan reads the object, the trigger and both record variables', () => {
  const result = p2f.plan(base);
  assert.equal(result.object, 'Case');
  assert.equal(result.recordVariable, 'myVariable_current');
  assert.equal(result.priorVariable, 'myVariable_old');
  assert.equal(result.triggerType, 'onAllChanges');
  assert.equal(result.recordTriggerType, 'CreateAndUpdate');
  assert.equal(result.requireChange, false);
  assert.deepEqual(result.blockers, []);
});

test('the change gate comes from the trigger token, not from a guess', () => {
  const result = p2f.plan(chained);
  assert.equal(result.recordTriggerType, 'CreateAndUpdate');
  assert.equal(result.requireChange, true);
});

test('a flow that is not a process is refused, and the reason names the type', () => {
  const result = p2f.plan({ processXml: FLOW_NOT_PROCESS, processName: 'Case_triage' });
  assert.equal(result.criteria.length, 0);
  assert.match(result.blockers.join(' '), /AutoLaunchedFlow.*not a Process Builder process/);
});

test('an invocable process is refused with the supported-scope reason', () => {
  const result = p2f.plan({ processXml: INVOCABLE, processName: 'Case_triage' });
  assert.match(result.blockers.join(' '), /InvocableProcess/);
  assert.match(result.blockers.join(' '), /record-triggered processes only/);
});

test('a missing trigger token blocks the whole process instead of defaulting', () => {
  const xml = PROCESS.replace(/<processMetadataValues>\s*<name>TriggerType<\/name>[\s\S]*?<\/processMetadataValues>/, '');
  const result = p2f.plan({ processXml: xml, processName: 'Case_triage' });
  assert.equal(result.recordTriggerType, null);
  assert.match(result.blockers.join(' '), /cannot read the trigger/);
  assert.equal(result.criteria.every((c) => !c.convertible), true);
});

test('the reevaluation option is reported, because a flow evaluates the record once', () => {
  // Detection is on the name pattern: the process metadata key is not documented.
  const result = p2f.plan(chained);
  assert.match(result.notes.join(' '), /RecursionAllowed is true/);
  assert.match(result.notes.join(' '), /five additional times/);
});

test('the first criteria node converts, the later ones are reported', () => {
  const result = p2f.plan(base);
  assert.deepEqual(result.criteria.map((c) => c.name), ['myRule_1', 'myRule_2', 'myRule_3']);
  assert.equal(node(result, 'myRule_1').convertible, true);
  assert.equal(node(result, 'myRule_2').convertible, false);
  assert.equal(node(result, 'myRule_3').convertible, false);
});

test('a criteria node reached only when an earlier one is false carries that guard', () => {
  const two = node(p2f.plan(base), 'myRule_2');
  assert.deepEqual(two.guards, [{ criteria: 'myRule_1', mustBe: 'false' }]);
  assert.match(two.blockers.join(' '), /only reached when myRule_1 is false/);
});

test('a node behind the default connector inherits every earlier criteria as a guard', () => {
  const three = node(p2f.plan(base), 'myRule_3');
  assert.deepEqual(three.guards.map((g) => g.criteria), ['myRule_1', 'myRule_2']);
});

test('same-record field writes become before-save assignments, references rewritten', () => {
  const one = node(p2f.plan(base), 'myRule_1');
  assert.deepEqual(one.before, [
    { name: 'myRule_1_A1', field: 'Priority', value: { tag: 'stringValue', value: 'High' } },
    { name: 'myRule_1_A1', field: 'Subject', value: { tag: 'elementReference', value: '$Record.Origin' } }
  ]);
});

test('a global variable in a condition survives as an element reference', () => {
  const one = node(p2f.plan(base), 'myRule_1');
  assert.deepEqual(one.conditions.map((c) => c.value), [
    { tag: 'stringValue', value: 'New' },
    { tag: 'elementReference', value: '$User.Id' }
  ]);
});

test('email alerts and record creates are after-save work, named by action type', () => {
  const two = node(p2f.plan(base), 'myRule_2');
  assert.deepEqual(two.after.map((a) => a.name), ['myRule_2_A1', 'myRule_2_A2']);
  assert.match(two.after[0].kind, /emailAlert/);
  assert.match(two.after[1].reason, /Create Records/);
});

test('scheduled actions are reported as scheduled paths, never as before-save work', () => {
  const three = node(p2f.plan(base), 'myRule_3');
  assert.deepEqual(three.scheduled.map((s) => s.name), ['myWait_1']);
  assert.match(three.scheduled[0].reason, /scheduledPaths/);
  assert.match(three.blockers.join(' '), /scheduled actions/);
  assert.equal(three.before.length, 0);
});

test('a prior-value criteria is blocked with the flow equivalent named', () => {
  const three = node(p2f.plan(base), 'myRule_3');
  assert.match(three.blockers.join(' '), /prior value myVariable_old\.Status/);
  assert.match(three.blockers.join(' '), /\$Record__Prior\.Status/);
});

test('a formula criteria is blocked, and the cross-object caveat is stated', () => {
  const one = node(p2f.plan(chained), 'myRule_1');
  assert.match(one.blockers.join(' '), /process formula myFormula_1/);
  assert.match(one.blockers.join(' '), /cross-object reference in a formula cannot be migrated/);
});

test('EVALUATE THE NEXT CRITERIA blocks the node and names the value semantics', () => {
  const one = node(p2f.plan(chained), 'myRule_1');
  assert.equal(one.nextCriteria, 'myDecision2');
  assert.match(one.blockers.join(' '), /continues to myDecision2/);
  assert.match(one.blockers.join(' '), /values the record had at the start of the process/);
});

test('an update with an object and filters is after-save work, grouped per object', () => {
  const one = node(p2f.plan(chained), 'myRule_1');
  assert.deepEqual(one.after.map((a) => a.name), ['myRule_1_A1']);
  assert.match(one.after[0].reason, /updates Account/);
  assert.match(one.after[0].reason, /single Update Records element/);
});

test('a FlowCondition operator with no entry-condition form is blocked', () => {
  const two = node(p2f.plan(chained), 'myRule_2');
  assert.match(two.blockers.join(' '), /operator IsChanged/);
  assert.match(two.blockers.join(' '), /Decision or an entry formula/);
});

test('a condition on a related record is blocked', () => {
  const two = node(p2f.plan(chained), 'myRule_2');
  assert.match(two.blockers.join(' '), /related record \(myVariable_current\.Account\.Industry\)/);
});

test('a prior-value field write is reported as before-save work by hand', () => {
  const two = node(p2f.plan(chained), 'myRule_2');
  assert.deepEqual(two.manual.map((m) => m.field), ['Description']);
  assert.equal(two.manual[0].target, 'before-save');
  assert.match(two.manual[0].reason, /\$Record__Prior\.StageName/);
});

test('the emitted flow is well-formed and in XSD order', () => {
  const out = p2f.convert({ ...base, criteriaName: 'myRule_1' });
  assert.equal(lintXml(out.xml).ok, true);
  assert.equal(isSubsequenceOf(topLevelNames(out.xml), FLOW_ORDER), null);
});

test('the emitted flow is a before-save flow that assigns, never updates', () => {
  const out = p2f.convert({ ...base, criteriaName: 'myRule_1' });
  assert.match(out.xml, /<triggerType>RecordBeforeSave<\/triggerType>/);
  assert.match(out.xml, /<recordTriggerType>CreateAndUpdate<\/recordTriggerType>/);
  assert.match(out.xml, /<assignToReference>\$Record\.Priority<\/assignToReference>/);
  assert.match(out.xml, /<assignToReference>\$Record\.Subject<\/assignToReference>/);
  assert.match(out.xml, /<elementReference>\$Record\.Origin<\/elementReference>/);
  assert.equal(/<recordUpdates>/.test(out.xml), false);
  assert.equal((out.xml.match(/<assignments>/g) || []).length, 1);
});

test('the entry conditions come from the criteria node, with its logic', () => {
  const out = p2f.convert({ ...base, criteriaName: 'myRule_1' });
  assert.equal((out.xml.match(/<filters>/g) || []).length, 2);
  assert.match(out.xml, /<filterLogic>and<\/filterLogic>/);
  assert.match(out.xml, /<field>Status<\/field>/);
  assert.match(out.xml, /<elementReference>\$User\.Id<\/elementReference>/);
});

test('the flow is generated inactive and never claims a workflow rule origin', () => {
  const out = p2f.convert({ ...base, criteriaName: 'myRule_1' });
  assert.match(out.xml, /<status>Draft<\/status>/);
  assert.equal(/migratedFromWorkflowRuleName/.test(out.xml), false);
  assert.match(out.xml, /Process Builder process Case_triage/);
  assert.equal(out.flowName, 'Case_New_and_mine_Before');
});

test('convert accepts the criteria label as well as its name', () => {
  const out = p2f.convert({ ...base, criteriaName: 'New and mine' });
  assert.equal(out.flowName, 'Case_New_and_mine_Before');
});

test('a blocked node yields no XML at all, and hands back the work', () => {
  const out = p2f.convert({ ...base, criteriaName: 'myRule_2' });
  assert.equal(out.xml, null);
  assert.equal(out.flowName, null);
  assert.ok(out.blockers.length);
  assert.deepEqual(out.afterSaveTodo.map((a) => a.name), ['myRule_2_A1', 'myRule_2_A2']);
});

test('a process-level blocker stops conversion even for a named node', () => {
  const out = p2f.convert({ processXml: INVOCABLE, processName: 'Case_triage', apiVersion: '67.0', criteriaName: 'myRule_1' });
  assert.equal(out.xml, null);
  assert.match(out.blockers.join(' '), /InvocableProcess/);
});

test('an unknown criteria name is an error, not an empty flow', () => {
  assert.throws(() => p2f.convert({ ...base, criteriaName: 'nope' }), /not found/);
});

test('the plan report stays small and carries no XML', () => {
  const report = p2f.formatPlan(p2f.plan(base));
  assert.equal(report.includes('<'), false);
  assert.ok(report.length < 2600, `plan report is ${report.length} bytes`);
  assert.match(report, /object: Case/);
  assert.match(report, /before-save: Priority = High/);
});
