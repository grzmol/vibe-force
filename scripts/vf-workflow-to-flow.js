#!/usr/bin/env node
'use strict';
/**
 * vibe-force workflow rule -> Flow converter.
 *
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/vf-workflow-to-flow.js" plan <file.workflow-meta.xml>
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/vf-workflow-to-flow.js" convert <file> --rule <name>
 *
 * `plan` costs tens of tokens per rule and says which rules convert, which need
 * an after-save flow, and what a human still has to do. `convert` writes the
 * before-save flow for one rule. Neither ever puts workflow or flow XML into the
 * session.
 *
 * Exit codes: 0 done, 1 the rule does not convert without human work,
 * 2 misuse or unreadable input.
 *
 * Zero npm dependencies: node: builtins only, Node 20 or later.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const w2f = require('./lib/workflow-to-flow');
const { lintXml } = require('./lib/xml-lint');
const { loadConfig } = require('./lib/config');

const EXIT = { OK: 0, BLOCKED: 1, MISUSE: 2 };

const USAGE = `vf-workflow-to-flow - convert workflow rules to record-triggered flows

  plan    <file.workflow-meta.xml> [--json]
  convert <file.workflow-meta.xml> --rule <fullName> [--out-dir <dir>] [--status Draft|Active]
          [--flow-name <ApiName>] [--stdout] [--json]

What converts automatically
  Field updates on the triggering record with operation Literal, and criteria
  built from criteriaItems, become one before-save flow with a single Assignment
  element on $Record.

What is reported instead of guessed
  Cross-object field updates, Formula/Null/NextValue/PreviousValue updates, email
  alerts, tasks, outbound messages and time-dependent actions. They belong in a
  separate after-save flow whose Update Records elements should be grouped one per
  target object. Salesforce's own Migrate to Flow in Setup covers some of these.
`;

const OPTIONS = {
  rule: { type: 'string' },
  'out-dir': { type: 'string' },
  'flow-name': { type: 'string' },
  status: { type: 'string', default: 'Draft' },
  stdout: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false }
};

function fail(code, message) {
  process.stderr.write(`vf-workflow-to-flow: ${message}\n`);
  process.exit(code);
}

/** Decomposed layouts keep field updates in a sibling directory. */
function fieldUpdateResolver(workflowFile) {
  const dir = path.join(path.dirname(workflowFile), 'workflowFieldUpdates');
  return (name) => {
    const file = path.join(dir, `${name}.workflowFieldUpdate-meta.xml`);
    try {
      return w2f.parseFieldUpdate(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      return null;
    }
  };
}

/** flows/ sits next to workflows/ in every package directory layout. */
function defaultOutDir(workflowFile) {
  const dir = path.dirname(path.resolve(workflowFile));
  const marker = `${path.sep}workflows`;
  const at = dir.lastIndexOf(marker);
  if (at === -1) return dir;
  return path.join(dir.slice(0, at), 'flows');
}

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    fail(EXIT.MISUSE, err.message);
  }
  const { values, positionals } = parsed;
  const [command, file] = positionals;
  if (values.help || !command) {
    process.stdout.write(USAGE);
    process.exit(values.help ? EXIT.OK : EXIT.MISUSE);
  }
  if (!file) fail(EXIT.MISUSE, `${command} needs a .workflow-meta.xml file`);

  let workflowXml;
  try {
    workflowXml = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail(EXIT.MISUSE, `cannot read ${file}: ${err.message}`);
  }
  const lint = lintXml(workflowXml);
  if (!lint.ok) fail(EXIT.MISUSE, `${file} is not well-formed: ${lint.errors.join('; ')}`);

  const object = w2f.objectFromFileName(file);
  if (!object) fail(EXIT.MISUSE, `cannot derive the object from ${file}; expected <Object>.workflow-meta.xml`);
  const shared = { workflowXml, object, resolveFieldUpdate: fieldUpdateResolver(file) };

  if (command === 'plan') {
    const result = w2f.plan(shared);
    process.stdout.write(values.json ? `${JSON.stringify(result, null, 2)}\n` : `${w2f.formatPlan(result)}\n`);
    process.exit(EXIT.OK);
  }

  if (command === 'convert') {
    if (!values.rule) fail(EXIT.MISUSE, 'convert needs --rule <fullName>; run plan first to see the names');
    const { config } = loadConfig(process.cwd());
    let out;
    try {
      out = w2f.convert(Object.assign({}, shared, {
        ruleName: values.rule,
        apiVersion: config.apiVersion,
        status: values.status,
        flowName: values['flow-name']
      }));
    } catch (err) {
      fail(EXIT.MISUSE, err.message);
    }

    if (!out.xml) {
      const report = { rule: values.rule, converted: false, blockers: out.blockers, manualTodo: out.manualTodo, afterSaveTodo: out.afterSaveTodo };
      if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else {
        process.stdout.write(`${values.rule}: not converted\n`);
        for (const b of out.blockers) process.stdout.write(`  blocked: ${b}\n`);
        for (const m of out.manualTodo) process.stdout.write(`  before-save by hand: ${m.name} - ${m.reason}\n`);
        for (const a of out.afterSaveTodo) process.stdout.write(`  after-save: ${a.name} - ${a.reason}\n`);
      }
      process.exit(EXIT.BLOCKED);
    }

    const emitted = lintXml(out.xml);
    if (!emitted.ok) fail(EXIT.MISUSE, `generated flow is not well-formed: ${emitted.errors.join('; ')} - nothing written`);

    if (values.stdout) {
      process.stdout.write(out.xml);
      process.exit(EXIT.OK);
    }
    const dir = values['out-dir'] || defaultOutDir(file);
    const target = path.join(dir, `${out.flowName}.flow-meta.xml`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, out.xml);
    } catch (err) {
      fail(EXIT.MISUSE, `cannot write ${target}: ${err.message}`);
    }

    const report = { rule: values.rule, converted: true, flow: target, status: values.status, manualTodo: out.manualTodo, afterSaveTodo: out.afterSaveTodo };
    if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      process.stdout.write(`wrote ${target} (status ${values.status})\n`);
      for (const m of out.manualTodo) process.stdout.write(`  still to do, before-save by hand: ${m.name} - ${m.reason}\n`);
      for (const a of out.afterSaveTodo) process.stdout.write(`  still to do, after-save: ${a.name} - ${a.reason}\n`);
      process.stdout.write(`  verify: sf project deploy validate --source-dir ${target} --target-org <alias>\n`);
      process.stdout.write(`  deactivate the workflow rule only after the flow is active and verified\n`);
    }
    process.exit(EXIT.OK);
  }

  fail(EXIT.MISUSE, `unknown command "${command}"\n\n${USAGE}`);
}

main(process.argv.slice(2));
