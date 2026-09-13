'use strict';
/**
 * Process Builder process -> record-triggered Flow conversion.
 *
 * A process is not a separate metadata type: it is a Flow whose processType is
 * `Workflow` (a record change process), stored in flows/ like any other flow.
 * So the input here is `.flow-meta.xml` and the first job is to prove the file
 * is a process at all.
 *
 * Two entry points, cheap one first:
 *   plan()    classifies every criteria node: which conditions map to flow entry
 *             conditions, which actions are same-record field writes, what has to
 *             become an after-save flow or a scheduled path, and what a human has
 *             to decide. A few lines per criteria node, no XML in the answer.
 *   convert() emits the before-save flow for one criteria node, and only when
 *             nothing about it has to be guessed.
 *
 * Why the conversion is narrower than it looks: a process chains criteria nodes.
 * A node reached after another node runs only because the earlier criteria were
 * false (or, with EVALUATE THE NEXT CRITERIA, true), and Salesforce documents
 * that a continuing process evaluates "the values that the record had at the
 * beginning of the process" - whereas a flow Decision after an Assignment sees
 * the value the Assignment just wrote. Splitting a chain into independent flows
 * changes behaviour, so every guarded node is reported, never emitted.
 *
 * Grounding: Metadata API Developer Guide, Flow (FlowProcessType `Workflow`,
 * FlowStart, FlowRecordFilterOperator, FlowScheduledPath); "Automate Your
 * Business Processes" - Process Builder, Execute Actions for Multiple Criteria,
 * Reevaluate Records in the Process Builder, Migrate to Flow Tool Considerations.
 *
 * Pure module: no filesystem access.
 */

const xn = require('./xml-nodes');
const bsf = require('./before-save-flow');

/** FlowProcessType values a migration session can meet in flows/, annotated. */
const PROCESS_TYPES = {
  Workflow: 'record change process (Process Builder)',
  InvocableProcess: 'invocable process (Process Builder), started by another process or the Invocable Actions REST resource',
  CustomEvent: 'event process (Process Builder), started by a platform event message'
};

/**
 * processMetadataValues entries a retrieved record change process carries.
 * Matched case-insensitively. [unverified] These names are not in the Metadata
 * API reference - FlowMetadataValue is documented as an open name/value pair -
 * so a missing entry is reported as a blocker and never assumed.
 */
const PMV_KEYS = {
  object: 'objecttype',
  record: 'objectvariable',
  prior: 'oldobjectvariable',
  trigger: 'triggertype'
};

/** Element collection -> what the step is, for the plan report. */
const STEP_KINDS = {
  recordUpdates: 'Update Records',
  recordCreates: 'Create Records',
  recordLookups: 'Get Records',
  recordDeletes: 'Delete Records',
  actionCalls: 'Action',
  apexPluginCalls: 'Apex plug-in',
  subflows: 'Subflow',
  assignments: 'Assignment',
  loops: 'Loop',
  screens: 'Screen',
  waits: 'Scheduled actions',
  decisions: 'Decision'
};

/** Collections whose members are reachable by a connector targetReference. */
const ELEMENT_COLLECTIONS = Object.keys(STEP_KINDS);

const VALUE_TAGS = ['stringValue', 'numberValue', 'booleanValue', 'dateValue', 'dateTimeValue', 'elementReference'];

/** Process name from `<Name>.flow-meta.xml`. */
function processFromFileName(file) {
  const base = String(file || '').split(/[\\/]/).pop() || '';
  return base.replace(/\.flow(-meta\.xml)?$/i, '');
}

/** First typed child of a FlowElementReferenceOrValue node, as a descriptor. */
function valueDescriptor(doc, nodeIndex) {
  if (nodeIndex === undefined) return null;
  for (const tag of VALUE_TAGS) {
    const hit = xn.children(doc, nodeIndex, tag)[0];
    if (hit !== undefined) return { tag, value: xn.leafValue(doc, hit) };
  }
  return null;
}

/** `<value>` child of an element, as a descriptor. */
function childValueDescriptor(doc, nodeIndex, name = 'value') {
  return valueDescriptor(doc, xn.children(doc, nodeIndex, name)[0]);
}

function connectorTarget(doc, nodeIndex, name = 'connector') {
  const c = xn.children(doc, nodeIndex, name)[0];
  return c === undefined ? '' : xn.childValue(doc, c, 'targetReference');
}

/** Index every named element once, so a connector target resolves in O(1). */
function elementIndex(doc, root) {
  const byName = new Map();
  for (const collection of ELEMENT_COLLECTIONS) {
    for (const i of xn.children(doc, root, collection)) {
      const name = xn.childValue(doc, i, 'name');
      if (name && !byName.has(name)) byName.set(name, { name, collection, kind: STEP_KINDS[collection], index: i, label: xn.childValue(doc, i, 'label') });
    }
  }
  return byName;
}

/**
 * Classify a reference the process stored, in terms of the flow that replaces it.
 * @returns {{kind:string, text:string, field?:string}}
 */
function classifyReference(ref, ctx) {
  const raw = String(ref || '');
  if (!raw) return { kind: 'empty', text: raw };
  if (raw.startsWith('$')) return { kind: 'global', text: raw };
  if (ctx.formulas.has(raw)) return { kind: 'formula', text: raw };
  const dot = raw.indexOf('.');
  const head = dot === -1 ? raw : raw.slice(0, dot);
  const tail = dot === -1 ? '' : raw.slice(dot + 1);
  if (head === ctx.priorVariable) return { kind: 'prior', text: raw, field: tail };
  if (head !== ctx.recordVariable) return { kind: 'other', text: raw };
  if (!tail) return { kind: 'record', text: '$Record' };
  if (tail.includes('.')) return { kind: 'cross-object', text: raw, field: tail };
  return { kind: 'field', text: `$Record.${tail}`, field: tail };
}

/** Turn a stored value into something a flow filter or assignment can carry. */
function convertValue(descriptor, ctx) {
  if (!descriptor) return { value: null, reason: 'no value stored' };
  if (descriptor.tag !== 'elementReference') return { value: descriptor };
  const ref = classifyReference(descriptor.value, ctx);
  if (ref.kind === 'field' || ref.kind === 'global' || ref.kind === 'record') return { value: { tag: 'elementReference', value: ref.text } };
  if (ref.kind === 'prior') return { value: null, reason: `references the record's prior value (${descriptor.value}); in a flow that is {!$Record__Prior.${ref.field}}, which entry conditions cannot use` };
  if (ref.kind === 'formula') return { value: null, reason: `references the process formula ${descriptor.value}; formula references have to be rewritten to {!$Record.Field}` };
  if (ref.kind === 'cross-object') return { value: null, reason: `traverses a related record (${descriptor.value}); a record-triggered flow needs a Get Records element for that` };
  return { value: null, reason: `references ${descriptor.value}, which has no equivalent in the generated flow` };
}

/** Field writes a recordUpdates element performs on the triggering record. */
function fieldWrites(doc, nodeIndex, ctx) {
  const before = [];
  const manual = [];
  for (const a of xn.children(doc, nodeIndex, 'inputAssignments')) {
    const field = xn.childValue(doc, a, 'field');
    const converted = convertValue(childValueDescriptor(doc, a), ctx);
    if (converted.value) before.push({ field, value: converted.value });
    else manual.push({ field, reason: converted.reason });
  }
  return { before, manual };
}

/**
 * Walk one action group: the connector chain that starts at a criteria node's
 * outcome. Stops at the next criteria node, which is reported, not followed.
 */
function walkActionGroup(doc, startName, ctx) {
  const steps = [];
  const seen = new Set();
  let nextCriteria = null;
  let name = startName;
  while (name && !seen.has(name)) {
    seen.add(name);
    const el = ctx.elements.get(name);
    if (!el) {
      steps.push({ name, kind: 'unknown', dangling: true });
      break;
    }
    if (el.collection === 'decisions') {
      nextCriteria = name;
      break;
    }
    steps.push(el);
    if (el.collection === 'waits') break; // scheduled actions: reported whole
    name = connectorTarget(doc, el.index);
  }
  return { steps, nextCriteria };
}

/** Sort one action-group step into before-save, after-save, scheduled or manual. */
function classifyStep(doc, step, ctx, bucket) {
  if (step.dangling) {
    bucket.blockers.push(`action group points at "${step.name}", which is not an element in this file`);
    return;
  }
  if (step.collection === 'waits') {
    bucket.scheduled.push({ name: step.name, kind: step.kind, reason: 'scheduled actions become scheduledPaths on an after-save flow; a before-save flow cannot carry them' });
    return;
  }
  if (step.collection === 'recordUpdates') {
    const inputReference = xn.childValue(doc, step.index, 'inputReference');
    const ref = classifyReference(inputReference, ctx);
    const object = xn.childValue(doc, step.index, 'object');
    if (ref.kind !== 'record' || object) {
      bucket.after.push({ name: step.name, kind: step.kind, reason: `updates ${object || inputReference || 'related records'}; belongs in the after-save flow, with every write to one object grouped into a single Update Records element` });
      return;
    }
    const writes = fieldWrites(doc, step.index, ctx);
    for (const w of writes.before) bucket.before.push({ name: step.name, field: w.field, value: w.value });
    for (const m of writes.manual) bucket.manual.push({ name: step.name, field: m.field, target: 'before-save', reason: m.reason });
    if (!writes.before.length && !writes.manual.length) bucket.blockers.push(`${step.name} updates the triggering record but stores no field assignment`);
    return;
  }
  if (step.collection === 'actionCalls') {
    const actionType = xn.childValue(doc, step.index, 'actionType');
    const actionName = xn.childValue(doc, step.index, 'actionName');
    bucket.after.push({ name: step.name, kind: `${step.kind} (${actionType || 'unknown type'})`, reason: `${actionType || 'action'} ${actionName || ''} runs after save; add it as an actionCall on the after-save flow`.replace(/\s+/g, ' ') });
    return;
  }
  bucket.after.push({ name: step.name, kind: step.kind, reason: `${step.kind} cannot run before save; rebuild it on the after-save flow` });
}
/** Entry conditions for one criteria node, or the reasons there are none. */
function criteriaConditions(doc, ruleIndex, ctx) {
  const conditions = [];
  const blockers = [];
  for (const c of xn.children(doc, ruleIndex, 'conditions')) {
    const left = xn.childValue(doc, c, 'leftValueReference');
    const operator = xn.childValue(doc, c, 'operator');
    const ref = classifyReference(left, ctx);
    const right = convertValue(childValueDescriptor(doc, c, 'rightValue'), ctx);
    const entry = { left, operator, field: ref.kind === 'field' ? ref.field : left, value: right.value, refKind: ref.kind };
    conditions.push(entry);

    if (ref.kind === 'formula') blockers.push(`criteria uses the process formula ${left}; rewrite its references to {!$Record.Field} by hand (a cross-object reference in a formula cannot be migrated at all)`);
    else if (ref.kind === 'prior') blockers.push(`criteria reads the prior value ${left}; entry conditions cannot, so rebuild it as a Decision on {!$Record__Prior.${ref.field}}`);
    else if (ref.kind === 'cross-object') blockers.push(`criteria reads a related record (${left}); entry conditions filter the triggering record only`);
    else if (ref.kind !== 'field') blockers.push(`criteria left side ${left} is not a field on the triggering record`);
    if (!bsf.FILTER_OPERATORS.has(operator)) blockers.push(`operator ${operator} is a FlowCondition operator with no entry-condition form; rebuild the criteria as a Decision or an entry formula`);
    if (!right.value && right.reason) blockers.push(`criteria value on ${ref.field || left}: ${right.reason}`);
  }
  return { conditions, blockers };
}

function describeGuards(guards) {
  return guards.map((g) => `${g.criteria} is ${g.mustBe}`).join(' and ');
}

/**
 * Classify every criteria node in a process.
 *
 * @param {object} args
 * @param {string} args.processXml contents of a `.flow-meta.xml` whose processType is Workflow
 * @param {string} [args.processName] normally the file name without its suffix
 * @returns {object} see the fields assembled at the end of this function
 */
function plan(args) {
  const doc = xn.index(args.processXml);
  const root = (doc.childrenOf.get(-1) || [])[0];
  const result = {
    processName: args.processName || '',
    label: '',
    status: '',
    processType: '',
    object: '',
    recordVariable: '',
    priorVariable: '',
    triggerType: '',
    recordTriggerType: null,
    requireChange: false,
    notes: [],
    blockers: [],
    criteria: []
  };
  if (root === undefined || doc.nodes[root].name !== 'Flow') {
    result.blockers.push('this file has no <Flow> root element, so it is not a process');
    return result;
  }

  result.label = xn.childValue(doc, root, 'label');
  result.status = xn.childValue(doc, root, 'status');
  result.processType = xn.childValue(doc, root, 'processType');

  const pmv = new Map();
  for (const i of xn.children(doc, root, 'processMetadataValues')) {
    const name = xn.childValue(doc, i, 'name');
    if (name) pmv.set(name.toLowerCase(), { name, value: childValueDescriptor(doc, i) });
  }
  const pmvValue = (key) => {
    const hit = pmv.get(key);
    return hit && hit.value ? String(hit.value.value) : '';
  };

  const variables = xn.children(doc, root, 'variables').map((i) => ({
    name: xn.childValue(doc, i, 'name'),
    dataType: xn.childValue(doc, i, 'dataType'),
    objectType: xn.childValue(doc, i, 'objectType'),
    isInput: xn.childValue(doc, i, 'isInput') === 'true'
  }));
  const sobjectVars = variables.filter((v) => v.dataType === 'SObject');

  result.object = pmvValue(PMV_KEYS.object) || (sobjectVars.find((v) => v.isInput) || sobjectVars[0] || {}).objectType || '';
  result.recordVariable = pmvValue(PMV_KEYS.record) || (sobjectVars.find((v) => v.isInput) || {}).name || '';
  result.priorVariable = pmvValue(PMV_KEYS.prior) || (sobjectVars.find((v) => v.name !== result.recordVariable) || {}).name || '';
  result.triggerType = pmvValue(PMV_KEYS.trigger);

  if (result.processType !== 'Workflow') {
    const known = PROCESS_TYPES[result.processType];
    result.blockers.push(
      known
        ? `processType ${result.processType}: ${known}. The Migrate to Flow tool supports record-triggered processes only, and so does this converter`
        : `processType ${result.processType || '(none)'} is not a Process Builder process; this file is a flow, not a process`
    );
    return result;
  }

  const trigger = bsf.LEGACY_TRIGGER_MAP[result.triggerType];
  if (trigger) {
    result.recordTriggerType = trigger.recordTriggerType;
    result.requireChange = trigger.requireChange;
  } else {
    result.blockers.push(`cannot read the trigger from this file (${PMV_KEYS.trigger} is ${result.triggerType || 'absent'}); confirm "The process starts when" in Setup before converting anything`);
  }
  if (!result.object) result.blockers.push('cannot read the process object from this file; confirm it in Setup');
  if (!result.recordVariable) result.blockers.push('cannot find the SObject variable that holds the triggering record, so no reference in this file can be rewritten');

  for (const [, entry] of pmv) {
    if (/recursi|reevaluat/i.test(entry.name) && entry.value && String(entry.value.value) === 'true') {
      result.notes.push(`${entry.name} is true: the process reevaluates the record up to five additional times in one save. A migrated flow evaluates the record once - test the difference deliberately`);
    }
  }

  const ctx = {
    recordVariable: result.recordVariable,
    priorVariable: result.priorVariable,
    elements: elementIndex(doc, root),
    formulas: new Set(xn.children(doc, root, 'formulas').map((i) => xn.childValue(doc, i, 'name')))
  };

  // Walk the decision graph so every criteria node carries the guards that
  // decide whether it is reached at all.
  const start = xn.childValue(doc, root, 'startElementReference');
  const queue = [{ name: start, guards: [] }];
  const visited = new Set();
  while (queue.length) {
    const { name, guards } = queue.shift();
    if (!name || visited.has(name)) continue;
    visited.add(name);
    const decision = ctx.elements.get(name);
    if (!decision) {
      result.blockers.push(`startElementReference or a connector points at "${name}", which is not an element in this file`);
      continue;
    }
    if (decision.collection !== 'decisions') {
      result.notes.push(`${name} is ${decision.kind}, not a criteria node; a process normally starts at a decision`);
      continue;
    }

    const rules = xn.children(doc, decision.index, 'rules');
    const earlier = [];
    for (const r of rules) {
      const ruleName = xn.childValue(doc, r, 'name');
      const bucket = { before: [], after: [], manual: [], scheduled: [], blockers: [] };
      const { conditions, blockers } = criteriaConditions(doc, r, ctx);
      bucket.blockers.push(...blockers);

      const group = walkActionGroup(doc, connectorTarget(doc, r), ctx);
      for (const step of group.steps) classifyStep(doc, step, ctx, bucket);

      const nodeGuards = guards.concat(earlier.map((n) => ({ criteria: n, mustBe: 'false' })));
      if (nodeGuards.length) {
        bucket.blockers.push(`this criteria node is only reached when ${describeGuards(nodeGuards)}; its flow needs that guard in its entry conditions, and negating criteria is not mechanical`);
      }
      if (group.nextCriteria) {
        bucket.blockers.push(`the action group continues to ${group.nextCriteria} (EVALUATE THE NEXT CRITERIA); a continuing process evaluates the values the record had at the start of the process, while a flow Decision after an Assignment sees the value just written`);
        queue.push({ name: group.nextCriteria, guards: nodeGuards.concat([{ criteria: ruleName, mustBe: 'true' }]) });
      }
      if (bucket.scheduled.length) bucket.blockers.push('this action group has scheduled actions; migrate the whole node as one after-save flow with scheduled paths instead');

      result.criteria.push({
        name: ruleName,
        label: xn.childValue(doc, r, 'label'),
        decision: name,
        conditionLogic: xn.childValue(doc, r, 'conditionLogic'),
        conditions,
        guards: nodeGuards,
        nextCriteria: group.nextCriteria,
        before: bucket.before,
        after: bucket.after,
        manual: bucket.manual,
        scheduled: bucket.scheduled,
        blockers: bucket.blockers,
        convertible: bucket.blockers.length === 0 && result.blockers.length === 0 && bucket.before.length > 0
      });
      earlier.push(ruleName);
    }

    const fallthrough = connectorTarget(doc, decision.index, 'defaultConnector');
    if (fallthrough) queue.push({ name: fallthrough, guards: guards.concat(earlier.map((n) => ({ criteria: n, mustBe: 'false' }))) });
  }

  // A blocker found during the walk - a dangling connector target - invalidates
  // every verdict, including the nodes already classified.
  if (result.blockers.length) for (const c of result.criteria) c.convertible = false;

  if (!result.criteria.length && !result.blockers.length) result.blockers.push('no criteria node is reachable from startElementReference');
  return result;
}

/** One-line-per-node report. This is what a session should read, not the XML. */
function formatPlan(result) {
  const head = [`process: ${result.processName || result.label || '(unnamed)'}  object: ${result.object || '?'}  ${result.status || 'status unknown'}  trigger: ${result.triggerType || '?'}${result.recordTriggerType ? ` -> ${result.recordTriggerType}${result.requireChange ? ' + change gate' : ''}` : ''}`];
  for (const n of result.notes) head.push(`  note: ${n}`);
  for (const b of result.blockers) head.push(`  blocked: ${b}`);
  const lines = head.concat(result.criteria.length ? [`criteria nodes: ${result.criteria.length}`] : []);
  for (const c of result.criteria) {
    const rest = c.after.length + c.manual.length + c.scheduled.length;
    const verdict = c.convertible ? (rest ? `before-save: auto, ${rest} item(s) by hand` : 'before-save: auto, complete') : 'by hand';
    lines.push(`- ${c.name}${c.label && c.label !== c.name ? ` "${c.label}"` : ''} [${c.decision}] -> ${verdict}`);
    if (c.conditions.length) lines.push(`    criteria: ${c.conditions.map((x) => `${x.field} ${x.operator} ${x.value ? x.value.value : '?'}`).join(c.conditionLogic && !/^(and|or)$/i.test(c.conditionLogic) ? ' | ' : ` ${(c.conditionLogic || 'and').toUpperCase()} `)}${c.conditionLogic && !/^(and|or)$/i.test(c.conditionLogic) ? `  logic: ${c.conditionLogic}` : ''}`);
    else lines.push('    criteria: none - the action group runs on every save that matches the trigger');
    for (const b of c.before) lines.push(`    before-save: ${b.field} = ${b.value.value} (${b.value.tag})`);
    for (const m of c.manual) lines.push(`    before-save by hand: ${m.field || m.name} - ${m.reason}`);
    for (const a of c.after) lines.push(`    after-save: ${a.name} ${a.kind} - ${a.reason}`);
    for (const s of c.scheduled) lines.push(`    scheduled path: ${s.name} - ${s.reason}`);
    for (const b of c.blockers) lines.push(`    blocked: ${b}`);
  }
  return lines.join('\n');
}

/**
 * Convert one criteria node into a before-save flow.
 *
 * @param {object} args plan() arguments plus:
 * @param {string} args.criteriaName rule name, or its label
 * @param {string} args.apiVersion
 * @param {string} [args.status] Draft by default
 * @param {string} [args.flowName]
 * @returns {{flowName:string|null, xml:string|null, afterSaveTodo:Array, manualTodo:Array, scheduledTodo:Array, blockers:Array}}
 */
function convert(args) {
  const result = plan(args);
  const node = result.criteria.find((c) => c.name === args.criteriaName) || result.criteria.find((c) => c.label === args.criteriaName);
  if (!node) {
    if (result.blockers.length) return { flowName: null, xml: null, afterSaveTodo: [], manualTodo: [], scheduledTodo: [], blockers: result.blockers };
    throw new Error(`criteria node "${args.criteriaName}" not found in this process`);
  }
  const todo = { afterSaveTodo: node.after, manualTodo: node.manual, scheduledTodo: node.scheduled };
  const blockers = result.blockers.concat(node.blockers);
  if (blockers.length) return Object.assign({ flowName: null, xml: null, blockers }, todo);
  if (!node.before.length) {
    return Object.assign({ flowName: null, xml: null, blockers: ['this criteria node writes no field on the triggering record; what it does belongs in an after-save flow'] }, todo);
  }

  const criteriaLabel = node.label || node.name;
  const flow = bsf.buildBeforeSaveFlow({
    flowName: args.flowName || `${bsf.apiName(result.object)}_${bsf.apiName(criteriaLabel)}_Before`,
    label: `${result.object} ${criteriaLabel} (before save)`,
    description: `Before-save conversion of criteria "${criteriaLabel}" from the Process Builder process ${result.processName || result.label}.`,
    apiVersion: args.apiVersion,
    status: args.status || 'Draft',
    object: result.object,
    recordTriggerType: result.recordTriggerType,
    requireChange: result.requireChange,
    filterLogic: node.conditionLogic || 'and',
    filters: node.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value })),
    assignments: node.before.map((b) => ({ field: b.field, value: b.value }))
  });
  return Object.assign({ flowName: flow.name, xml: flow.xml, blockers: [] }, todo);
}

module.exports = {
  PROCESS_TYPES,
  PMV_KEYS,
  STEP_KINDS,
  processFromFileName,
  classifyReference,
  plan,
  formatPlan,
  convert
};
