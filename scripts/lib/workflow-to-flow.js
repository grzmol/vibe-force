'use strict';
/**
 * Workflow rule -> record-triggered Flow conversion.
 *
 * Two entry points, because the cheap one is the one worth running first:
 *   plan()    classifies every rule in a Workflow file. Tens of tokens per rule,
 *             no XML in the answer, and it says what a human still has to do.
 *   convert() emits the before-save flow for the rules that convert with no
 *             guesswork. Everything else stays a planned item; a converter that
 *             guesses at cross-object writes or formula rewriting produces files
 *             that deploy and then behave differently from the rule they replaced.
 *
 * Split policy: field updates on the triggering record go to a before-save flow
 * as assignments on $Record - never an Update Records element, which would save
 * the record a second time. Anything that cannot run before save is reported for
 * an after-save flow, where the number of Update Records elements is kept to a
 * minimum (one per target object, not one per field).
 *
 * Grounding: Metadata API Flow and Workflow type definitions plus their XSD
 * sequences; element order below follows that sequence, which the Metadata API
 * enforces. Shapes cross-checked against Salesforce-published before-save flows.
 *
 * Pure module: no filesystem access. Decomposed workflow directories are handled
 * by passing a resolveFieldUpdate callback.
 */

const xn = require('./xml-nodes');
const bsf = require('./before-save-flow');

/** WorkflowRule.triggerType -> FlowStart.recordTriggerType (+ the change gate). */
const TRIGGER_MAP = bsf.LEGACY_TRIGGER_MAP;

/** FilterItem operation -> FlowRecordFilterOperator. Unmapped values are blockers. */
const OPERATOR_MAP = {
  equals: 'EqualTo',
  notEqual: 'NotEqualTo',
  lessThan: 'LessThan',
  greaterThan: 'GreaterThan',
  lessOrEqual: 'LessThanOrEqualTo',
  greaterOrEqual: 'GreaterThanOrEqualTo',
  contains: 'Contains',
  startsWith: 'StartsWith'
};

/** FilterOperation values with no single-condition Flow equivalent. */
const UNMAPPED_OPERATORS = ['notContain', 'includes', 'excludes', 'within'];

const apiName = bsf.apiName;

/** Salesforce object a workflow file belongs to, from `<Object>.workflow-meta.xml`. */
function objectFromFileName(file) {
  const base = String(file || '').split(/[\\/]/).pop() || '';
  return base.replace(/\.workflow(-meta\.xml)?$/i, '');
}

const childValue = xn.childValue;
const childNodes = xn.children;

/**
 * A literal has no declared type in workflow metadata, so the type is inferred.
 * Wrong inference is caught by `sf project deploy validate`, and plan() prints
 * the inference so it can be checked before that round trip.
 */
function literalValueElement(literal) {
  const raw = String(literal == null ? '' : literal);
  if (/^(true|false)$/i.test(raw.trim())) return { tag: 'booleanValue', value: raw.trim().toLowerCase() };
  if (/^-?\d+(\.\d+)?$/.test(raw.trim())) return { tag: 'numberValue', value: raw.trim() };
  return { tag: 'stringValue', value: raw };
}

/** Parse every fieldUpdate defined inline in the Workflow file. */
function inlineFieldUpdates(doc) {
  const out = new Map();
  for (const i of xn.select(doc, 'Workflow/fieldUpdates')) {
    out.set(childValue(doc, i, 'fullName'), {
      fullName: childValue(doc, i, 'fullName'),
      field: childValue(doc, i, 'field'),
      operation: childValue(doc, i, 'operation'),
      literalValue: childValue(doc, i, 'literalValue'),
      formula: childValue(doc, i, 'formula'),
      targetObject: childValue(doc, i, 'targetObject'),
      reevaluateOnChange: childValue(doc, i, 'reevaluateOnChange') === 'true'
    });
  }
  return out;
}

/** Parse a standalone `.workflowFieldUpdate-meta.xml` (decomposed layout). */
function parseFieldUpdate(xml) {
  const doc = xn.index(xml);
  const roots = doc.childrenOf.get(-1) || [];
  if (!roots.length) return null;
  const i = roots[0];
  return {
    fullName: childValue(doc, i, 'fullName'),
    field: childValue(doc, i, 'field'),
    operation: childValue(doc, i, 'operation'),
    literalValue: childValue(doc, i, 'literalValue'),
    formula: childValue(doc, i, 'formula'),
    targetObject: childValue(doc, i, 'targetObject'),
    reevaluateOnChange: childValue(doc, i, 'reevaluateOnChange') === 'true'
  };
}

/**
 * Classify every rule in a Workflow file.
 *
 * @param {object} args
 * @param {string} args.workflowXml contents of `<Object>.workflow-meta.xml`
 * @param {string} args.object Salesforce object the workflow belongs to
 * @param {(name:string)=>(object|null)} [args.resolveFieldUpdate] for decomposed layouts
 * @returns {{object:string, rules:Array}}
 */
function plan(args) {
  const { workflowXml, object } = args;
  const resolve = args.resolveFieldUpdate || (() => null);
  const doc = xn.index(workflowXml);
  const inline = inlineFieldUpdates(doc);

  const rules = xn.select(doc, 'Workflow/rules').map((r) => {
    const name = childValue(doc, r, 'fullName');
    const triggerType = childValue(doc, r, 'triggerType');
    const formula = childValue(doc, r, 'formula');
    const booleanFilter = childValue(doc, r, 'booleanFilter');
    const blockers = [];

    const criteria = childNodes(doc, r, 'criteriaItems').map((c) => {
      const field = childValue(doc, c, 'field');
      const operation = childValue(doc, c, 'operation');
      const value = childValue(doc, c, 'value');
      const [prefix, ...rest] = field.split('.');
      const crossObject = rest.length > 0 && prefix !== object;
      const flowOperator = OPERATOR_MAP[operation] || null;
      if (!flowOperator) {
        blockers.push(
          UNMAPPED_OPERATORS.includes(operation)
            ? `criteria operation "${operation}" on ${field} has no single Flow condition operator; rebuild it as a Decision or a formula`
            : `criteria operation "${operation}" on ${field} is not in the conversion table`
        );
      }
      if (crossObject) blockers.push(`criteria field ${field} reads another object; a record-triggered flow filters only the triggering record`);
      return { field, flowField: rest.length ? rest.join('.') : field, operation, flowOperator, value, crossObject };
    });

    if (formula) blockers.push('rule uses a formula instead of criteriaItems; formula references need rewriting to {!$Record.Field} and cannot be derived from the workflow file alone');
    if (!TRIGGER_MAP[triggerType]) blockers.push(`unknown workflow triggerType "${triggerType}"`);
    if (childNodes(doc, r, 'workflowTimeTriggers').length) blockers.push('rule has time-dependent actions; they become scheduledPaths on the after-save flow and must be rebuilt by hand');

    const before = [];
    const after = [];
    const manual = [];
    for (const a of childNodes(doc, r, 'actions')) {
      const actionName = childValue(doc, a, 'name');
      const type = childValue(doc, a, 'type');
      if (type !== 'FieldUpdate') {
        after.push({ kind: type, name: actionName, reason: `${type} actions run after save; add them as actionCalls on the after-save flow` });
        continue;
      }
      const fu = inline.get(actionName) || resolve(actionName);
      if (!fu) {
        blockers.push(`field update ${actionName} is referenced but not defined in this file; pass the decomposed workflowFieldUpdates directory`);
        continue;
      }
      if (fu.targetObject) {
        after.push({ kind: 'FieldUpdate', name: actionName, field: fu.field, targetObject: fu.targetObject, reason: `writes ${fu.targetObject}.${fu.field} on another record; belongs in the after-save flow, grouped with every other write to ${fu.targetObject} into one Update Records element` });
        continue;
      }
      if (fu.operation !== 'Literal') {
        // Same record, so it still belongs before save - but the value cannot be
        // derived here: a Formula needs its references rewritten to {!$Record.X},
        // and Null/NextValue/PreviousValue need the field's type and picklist.
        manual.push({ kind: 'FieldUpdate', name: actionName, field: fu.field, operation: fu.operation, target: 'before-save', reason: `operation ${fu.operation} on the triggering record: add it to the before-save flow by hand (a Formula needs its field references rewritten to {!$Record.Field})` });
        continue;
      }
      const value = literalValueElement(fu.literalValue);
      before.push({ name: actionName, field: fu.field, literal: fu.literalValue, valueTag: value.tag, reevaluateOnChange: fu.reevaluateOnChange });
    }

    return {
      name,
      active: childValue(doc, r, 'active') === 'true',
      description: childValue(doc, r, 'description'),
      triggerType,
      recordTriggerType: (TRIGGER_MAP[triggerType] || {}).recordTriggerType || null,
      requireChange: Boolean((TRIGGER_MAP[triggerType] || {}).requireChange),
      booleanFilter,
      criteria,
      before,
      after,
      manual,
      blockers,
      convertible: blockers.length === 0 && before.length > 0
    };
  });

  return { object, rules };
}

/** One-line-per-rule report. This is what a session should read, not the XML. */
function formatPlan(result) {
  const lines = [`object: ${result.object}  rules: ${result.rules.length}`];
  for (const r of result.rules) {
    const rest = r.after.length + r.manual.length;
    const verdict = r.convertible ? (rest ? `before-save: auto, ${rest} item(s) by hand` : 'before-save: auto, complete') : 'by hand';
    lines.push(`- ${r.name} [${r.active ? 'active' : 'inactive'}] ${r.triggerType} -> ${verdict}`);
    if (r.criteria.length) lines.push(`    criteria: ${r.criteria.map((c) => `${c.flowField} ${c.flowOperator || `!${c.operation}`} ${c.value}`).join(r.booleanFilter ? ' | ' : ' AND ')}${r.booleanFilter ? `  logic: ${r.booleanFilter}` : ''}`);
    for (const b of r.before) lines.push(`    before-save: ${b.field} = ${b.literal} (as ${b.valueTag})`);
    for (const m of r.manual) lines.push(`    before-save by hand: ${m.name} - ${m.reason}`);
    for (const a of r.after) lines.push(`    after-save: ${a.name} - ${a.reason}`);
    for (const b of r.blockers) lines.push(`    blocked: ${b}`);
  }
  return lines.join('\n');
}

/**
 * Emit the before-save flow for one rule.
 *
 * The Flow shape itself lives in before-save-flow.js; this function only turns
 * workflow metadata into the value descriptors that builder takes.
 *
 * @param {object} args
 * @param {object} args.rule a rule from plan()
 * @param {string} args.object
 * @param {string} args.apiVersion
 * @param {string} [args.status] Active or Draft; Draft by default, so a human activates it
 * @param {string} [args.flowName] API name override
 * @returns {{name:string, xml:string}}
 */
function beforeSaveFlow(args) {
  const { rule, object, apiVersion } = args;
  return bsf.buildBeforeSaveFlow({
    flowName: args.flowName || `${apiName(object)}_${apiName(rule.name)}_Before`,
    label: `${object} ${rule.name} (before save)`,
    description: rule.description || `Before-save conversion of workflow rule ${rule.name}.`,
    apiVersion,
    status: args.status || 'Draft',
    object,
    recordTriggerType: rule.recordTriggerType,
    requireChange: rule.requireChange,
    filterLogic: rule.booleanFilter || 'and',
    filters: rule.criteria.map((c) => ({ field: c.flowField, operator: c.flowOperator, value: literalValueElement(c.value) })),
    assignments: rule.before.map((b) => ({ field: b.field, value: literalValueElement(b.literal) })),
    migratedFromWorkflowRuleName: rule.name
  });
}

/**
 * Convert one named rule.
 * @returns {{flowName:string, xml:string, afterSaveTodo:Array, blockers:Array}}
 */
function convert(args) {
  const result = plan(args);
  const rule = result.rules.find((r) => r.name === args.ruleName);
  if (!rule) throw new Error(`rule "${args.ruleName}" not found in this workflow file`);
  if (rule.blockers.length) return { flowName: null, xml: null, afterSaveTodo: rule.after, manualTodo: rule.manual, blockers: rule.blockers };
  if (!rule.before.length) {
    return {
      flowName: null,
      xml: null,
      afterSaveTodo: rule.after,
      manualTodo: rule.manual,
      blockers: ['rule has nothing that converts to a before-save assignment; what it does belongs in an after-save flow or needs a hand-built step']
    };
  }
  const flow = beforeSaveFlow({ rule, object: result.object, apiVersion: args.apiVersion, status: args.status, flowName: args.flowName });
  return { flowName: flow.name, xml: flow.xml, afterSaveTodo: rule.after, manualTodo: rule.manual, blockers: [] };
}

module.exports = {
  TRIGGER_MAP,
  OPERATOR_MAP,
  UNMAPPED_OPERATORS,
  apiName,
  objectFromFileName,
  literalValueElement,
  parseFieldUpdate,
  plan,
  formatPlan,
  beforeSaveFlow,
  convert
};
