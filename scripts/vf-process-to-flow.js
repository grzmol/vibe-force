#!/usr/bin/env node
'use strict';
/**
 * vibe-force Process Builder -> Flow converter.
 *
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/vf-process-to-flow.js" plan <process.flow-meta.xml>
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/vf-process-to-flow.js" convert <file> --criteria <name>
 *
 * A process is a Flow with processType Workflow, so the input is a file in
 * flows/ and `plan` starts by proving the file is a process at all. `plan` costs
 * a few lines per criteria node and says what converts, what has to become an
 * after-save flow or a scheduled path, and what a human has to decide.
 * `convert` writes the before-save flow for one criteria node.
 *
 * Exit codes: 0 done, 1 the file or the node does not convert without human
 * work, 2 misuse or unreadable input.
 *
 * Zero npm dependencies: node: builtins only, Node 20 or later.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const p2f = require('./lib/process-to-flow');
const { lintXml } = require('./lib/xml-lint');
const { loadConfig } = require('./lib/config');

const EXIT = { OK: 0, BLOCKED: 1, MISUSE: 2 };

const USAGE = `vf-process-to-flow - convert Process Builder processes to record-triggered flows

  plan    <process.flow-meta.xml> [--json]
  convert <process.flow-meta.xml> --criteria <name> [--out-dir <dir>] [--status Draft|Active]
          [--flow-name <ApiName>] [--stdout] [--json]

Input
  A process is a Flow whose processType is Workflow, retrieved into flows/ like
  any other flow. Event and invocable processes are rejected: the Migrate to Flow
  tool supports record-triggered processes only, and so does this converter.

What converts automatically
  One criteria node whose conditions all map to flow entry conditions, whose
  action group only writes fields on the triggering record, and which no earlier
  criteria node guards. It becomes a before-save flow with one Assignment on
  $Record.

What is reported instead of guessed
  Guarded criteria nodes, EVALUATE THE NEXT CRITERIA chains, scheduled actions,
  prior-value and cross-object references, process formulas, record creates,
  email alerts, Apex, subflows and every other action. Salesforce's own Migrate
  to Flow in Setup migrates a whole process as an after-save flow; use it when
  that is what you want.
`;

const OPTIONS = {
  criteria: { type: 'string' },
  'out-dir': { type: 'string' },
  'flow-name': { type: 'string' },
  status: { type: 'string', default: 'Draft' },
  stdout: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false }
};

function fail(code, message) {
  process.stderr.write(`vf-process-to-flow: ${message}\n`);
  process.exit(code);
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
  if (!file) fail(EXIT.MISUSE, `${command} needs a .flow-meta.xml file holding a process`);

  let processXml;
  try {
    processXml = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail(EXIT.MISUSE, `cannot read ${file}: ${err.message}`);
  }
  const lint = lintXml(processXml);
  if (!lint.ok) fail(EXIT.MISUSE, `${file} is not well-formed: ${lint.errors.join('; ')}`);

  const processName = p2f.processFromFileName(file);
  const shared = { processXml, processName };

  if (command === 'plan') {
    const result = p2f.plan(shared);
    process.stdout.write(values.json ? `${JSON.stringify(result, null, 2)}\n` : `${p2f.formatPlan(result)}\n`);
    process.exit(result.blockers.length ? EXIT.BLOCKED : EXIT.OK);
  }

  if (command === 'convert') {
    if (!values.criteria) fail(EXIT.MISUSE, 'convert needs --criteria <name>; run plan first to see the names');
    const { config } = loadConfig(process.cwd());
    let out;
    try {
      out = p2f.convert(
        Object.assign({}, shared, {
          criteriaName: values.criteria,
          apiVersion: config.apiVersion,
          status: values.status,
          flowName: values['flow-name']
        })
      );
    } catch (err) {
      fail(EXIT.MISUSE, err.message);
    }

    if (!out.xml) {
      const report = { criteria: values.criteria, converted: false, blockers: out.blockers, manualTodo: out.manualTodo, afterSaveTodo: out.afterSaveTodo, scheduledTodo: out.scheduledTodo };
      if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else {
        process.stdout.write(`${values.criteria}: not converted\n`);
        for (const b of out.blockers) process.stdout.write(`  blocked: ${b}\n`);
        for (const m of out.manualTodo) process.stdout.write(`  before-save by hand: ${m.field || m.name} - ${m.reason}\n`);
        for (const a of out.afterSaveTodo) process.stdout.write(`  after-save: ${a.name} - ${a.reason}\n`);
        for (const s of out.scheduledTodo) process.stdout.write(`  scheduled path: ${s.name} - ${s.reason}\n`);
      }
      process.exit(EXIT.BLOCKED);
    }

    // A flow deployed under the process's own name becomes a new version of the
    // process. The generated flow is a different automation and needs its own
    // name, so refuse both the name collision and an accidental overwrite.
    if (out.flowName === processName) fail(EXIT.MISUSE, `the generated flow would reuse the process name ${processName}; deploying that creates a new version of the process instead of a new flow - pass --flow-name`);

    const emitted = lintXml(out.xml);
    if (!emitted.ok) fail(EXIT.MISUSE, `generated flow is not well-formed: ${emitted.errors.join('; ')} - nothing written`);

    if (values.stdout) {
      process.stdout.write(out.xml);
      process.exit(EXIT.OK);
    }
    const dir = values['out-dir'] || path.dirname(path.resolve(file));
    const target = path.join(dir, `${out.flowName}.flow-meta.xml`);
    if (fs.existsSync(target)) fail(EXIT.MISUSE, `${target} already exists; pass --flow-name or --out-dir rather than overwriting a flow`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(target, out.xml);
    } catch (err) {
      fail(EXIT.MISUSE, `cannot write ${target}: ${err.message}`);
    }

    const report = { criteria: values.criteria, converted: true, flow: target, status: values.status, manualTodo: out.manualTodo, afterSaveTodo: out.afterSaveTodo, scheduledTodo: out.scheduledTodo };
    if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      process.stdout.write(`wrote ${target} (status ${values.status})\n`);
      for (const m of out.manualTodo) process.stdout.write(`  still to do, before-save by hand: ${m.field || m.name} - ${m.reason}\n`);
      for (const a of out.afterSaveTodo) process.stdout.write(`  still to do, after-save: ${a.name} - ${a.reason}\n`);
      for (const s of out.scheduledTodo) process.stdout.write(`  still to do, scheduled path: ${s.name} - ${s.reason}\n`);
      process.stdout.write(`  verify: sf project deploy validate --source-dir ${target} --target-org <alias>\n`);
      process.stdout.write('  deactivate the process only after the flow is active and verified\n');
    }
    process.exit(EXIT.OK);
  }

  fail(EXIT.MISUSE, `unknown command "${command}"\n\n${USAGE}`);
}

main(process.argv.slice(2));
