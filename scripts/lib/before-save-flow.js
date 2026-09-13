'use strict';
/**
 * Target side of a legacy-automation migration: the before-save record-triggered
 * Flow both converters emit.
 *
 * One module owns three facts that are easy to get wrong and expensive to get
 * wrong twice:
 *   1. the Flow XSD child sequence - the Metadata API rejects a Flow whose
 *      children are out of order, and the order is not alphabetical by accident;
 *   2. the legacy trigger token -> FlowStart.recordTriggerType mapping, plus the
 *      "only when the record changed to meet the criteria" gate;
 *   3. which operators FlowRecordFilter actually accepts, which is a strict
 *      subset of FlowCondition's FlowComparisonOperator.
 *
 * Callers hand over value descriptors ({tag, value}) that are already typed.
 * Inferring a literal's type is the caller's problem, because the two legacy
 * sources differ: workflow field updates carry an untyped literal, while a
 * process already stores stringValue / numberValue / elementReference.
 *
 * Grounding: Metadata API Developer Guide, Flow (Flow, FlowStart,
 * FlowRecordFilter, FlowRecordFilterOperator, RecordTriggerType).
 *
 * Pure module: no filesystem access.
 */

const xn = require('./xml-nodes');

const INDENT = '    ';

/**
 * Legacy trigger token -> FlowStart configuration. Workflow rules store these in
 * WorkflowRule.triggerType; retrieved Process Builder metadata carries the same
 * tokens in a processMetadataValues entry.
 */
const LEGACY_TRIGGER_MAP = {
  onCreateOnly: { recordTriggerType: 'Create', requireChange: false },
  onAllChanges: { recordTriggerType: 'CreateAndUpdate', requireChange: false },
  onCreateOrTriggeringUpdate: { recordTriggerType: 'CreateAndUpdate', requireChange: true }
};

/**
 * FlowRecordFilterOperator. Entry conditions accept only these; FlowCondition
 * operators such as IsChanged, WasSet or In have no entry-condition form and
 * have to be rebuilt as a Decision or an entry formula.
 */
const FILTER_OPERATORS = new Set([
  'EqualTo',
  'NotEqualTo',
  'GreaterThan',
  'LessThan',
  'GreaterThanOrEqualTo',
  'LessThanOrEqualTo',
  'StartsWith',
  'EndsWith',
  'Contains',
  'IsNull'
]);

/** Value tags a FlowElementReferenceOrValue may carry. */
const VALUE_TAGS = new Set(['stringValue', 'numberValue', 'booleanValue', 'dateValue', 'dateTimeValue', 'elementReference']);

function el(name, value, depth) {
  return `${INDENT.repeat(depth)}<${name}>${xn.escapeText(value)}</${name}>`;
}

/** Metadata API name: underscores and alphanumerics, no doubles, no edges. */
function apiName(text) {
  return String(text || '')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

function valueBlock(value, depth) {
  if (!value || !VALUE_TAGS.has(value.tag)) throw new Error(`unusable value descriptor: ${JSON.stringify(value)}`);
  return [`${INDENT.repeat(depth)}<value>`, el(value.tag, value.value, depth + 1), `${INDENT.repeat(depth)}</value>`].join('\n');
}

/**
 * Emit a before-save record-triggered flow with exactly one Assignment element.
 *
 * One Assignment carries every field write: fewer elements, one pass, and it is
 * the whole reason a before-save flow is cheaper than the automation it
 * replaces. An Update Records element on the triggering record would save the
 * record a second time and throw that away, so this builder cannot emit one.
 *
 * @param {object} args
 * @param {string} args.flowName Metadata API name, without the .flow-meta.xml suffix
 * @param {string} args.label Flow label
 * @param {string} args.description
 * @param {string} args.apiVersion
 * @param {string} [args.status] Draft by default, so a human activates it
 * @param {string} args.object triggering object
 * @param {string} args.recordTriggerType Create | Update | CreateAndUpdate
 * @param {boolean} [args.requireChange] sets doesRequireRecordChangedToMeetCriteria
 * @param {string} [args.filterLogic] and | or | custom logic string
 * @param {Array<{field:string, operator:string, value:object}>} [args.filters] entry conditions
 * @param {Array<{field:string, value:object}>} args.assignments $Record field writes
 * @param {string} [args.assignmentLabel]
 * @param {string} [args.migratedFromWorkflowRuleName] only set for workflow rules
 * @returns {{name:string, xml:string}}
 */
function buildBeforeSaveFlow(args) {
  const { flowName, label, apiVersion, object, recordTriggerType } = args;
  if (!flowName) throw new Error('flowName is required');
  if (!object) throw new Error('object is required');
  if (!recordTriggerType) throw new Error('recordTriggerType is required');
  const assignmentList = args.assignments || [];
  if (!assignmentList.length) throw new Error('a before-save flow with no assignment has nothing to do');
  const filters = args.filters || [];
  for (const f of filters) {
    if (!FILTER_OPERATORS.has(f.operator)) throw new Error(`operator ${f.operator} is not a FlowRecordFilterOperator`);
  }

  const assignmentName = 'Set_Fields';
  const items = assignmentList
    .map((a) =>
      [
        `${INDENT.repeat(2)}<assignmentItems>`,
        el('assignToReference', `$Record.${a.field}`, 3),
        el('operator', 'Assign', 3),
        valueBlock(a.value, 3),
        `${INDENT.repeat(2)}</assignmentItems>`
      ].join('\n')
    )
    .join('\n');

  const assignments = [
    `${INDENT}<assignments>`,
    el('name', assignmentName, 2),
    el('label', args.assignmentLabel || 'Set Fields', 2),
    el('locationX', '176', 2),
    el('locationY', '287', 2),
    items,
    `${INDENT}</assignments>`
  ].join('\n');

  const filterXml = filters
    .map((f) =>
      [
        `${INDENT.repeat(2)}<filters>`,
        el('field', f.field, 3),
        el('operator', f.operator, 3),
        valueBlock(f.value, 3),
        `${INDENT.repeat(2)}</filters>`
      ].join('\n')
    )
    .join('\n');

  const start = [
    `${INDENT}<start>`,
    el('locationX', '50', 2),
    el('locationY', '0', 2),
    `${INDENT.repeat(2)}<connector>`,
    el('targetReference', assignmentName, 3),
    `${INDENT.repeat(2)}</connector>`,
    ...(args.requireChange ? [el('doesRequireRecordChangedToMeetCriteria', 'true', 2)] : []),
    ...(filters.length ? [el('filterLogic', args.filterLogic || 'and', 2), filterXml] : []),
    el('object', object, 2),
    el('recordTriggerType', recordTriggerType, 2),
    el('triggerType', 'RecordBeforeSave', 2),
    `${INDENT}</start>`
  ].join('\n');

  // Element order follows the Flow XSD sequence; the Metadata API enforces it.
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Flow xmlns="http://soap.sforce.com/2006/04/metadata">',
    el('apiVersion', apiVersion, 1),
    assignments,
    el('description', args.description || '', 1),
    el('environments', 'Default', 1),
    el('interviewLabel', `${label} {!$Flow.CurrentDateTime}`, 1),
    el('label', label, 1),
    ...(args.migratedFromWorkflowRuleName ? [el('migratedFromWorkflowRuleName', args.migratedFromWorkflowRuleName, 1)] : []),
    el('processType', 'AutoLaunchedFlow', 1),
    start,
    el('status', args.status || 'Draft', 1),
    '</Flow>',
    ''
  ].join('\n');

  return { name: flowName, xml };
}

module.exports = {
  INDENT,
  LEGACY_TRIGGER_MAP,
  FILTER_OPERATORS,
  VALUE_TAGS,
  el,
  apiName,
  buildBeforeSaveFlow
};
