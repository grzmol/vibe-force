#!/usr/bin/env node
'use strict';
/**
 * vibe-force Setup automation tool.
 *
 *   node "${CLAUDE_PLUGIN_ROOT}/scripts/vf-setup.js" <command> [destination] [options]
 *
 * Salesforce configuration that the Metadata API owns belongs in a branch and in a deploy. What
 * is left - an org preference with no metadata type, a feature whose enablement is a Setup switch
 * only - has no deploy route at all, and today a session either does it by hand or does not do it.
 *
 * This tool covers that remainder in three steps that stay honest:
 *
 *   check   refuse the browser when the org describes a metadata type that owns the destination
 *   serve   hand a browser one single-use authenticated session without printing a credential
 *   audit   read SetupAuditTrail back, so a click that happened is evidence rather than a claim
 *
 * Exit codes: 0 done, 1 the answer is "no" (a deploy route exists, or a hand-off went unused),
 * 2 misuse, missing `sf`, or a production target without VF_ALLOW_PROD=1.
 *
 * Zero npm dependencies: node: builtins only, Node 20 or later.
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseArgs } = require('node:util');

const { loadConfig, isProductionTarget } = require('./lib/config');
const sd = require('./lib/setup-destinations');
const ss = require('./lib/setup-session');

const EXIT = { OK: 0, NO: 1, MISUSE: 2 };

const USAGE = `vf-setup - configure Salesforce Setup when no Metadata API route exists

  list                                     destinations this project knows, and their deploy route
  check <dest|--path P> -o <alias>         metadata-first gate: is a browser even allowed here
  serve <dest|--path P> -o <alias>         one single-use authenticated hand-off for a browser
  audit -o <alias> [--since 2h]            SetupAuditTrail: what actually changed in Setup
  clean                                    drop cached org descriptions and gate records

Options
  -o, --target-org <alias>   org to act on; required by check, serve and audit
  --path <navigation path>   destination as a raw path, e.g. lightning/setup/ObjectManager/home
  --ttl <seconds>            how long a hand-off stays valid (default 120)
  --port <n>                 loopback port for the hand-off (default 0, kernel-assigned)
  --since <2h|3d>            audit window (default 1h)
  --limit <n>                audit rows (default 50)
  --section <name>           audit filter on SetupAuditTrail.Section
  --refresh                  re-describe the org instead of using the cached metadata types
  --json                     machine-readable result

A frontdoor URL is a credential: \`sf org open --url-only\` prints a security warning saying so.
\`serve\` never prints one. It binds 127.0.0.1, mints a token, and redirects once.
`;

const OPTIONS = {
  'target-org': { type: 'string', short: 'o' },
  path: { type: 'string' },
  ttl: { type: 'string' },
  port: { type: 'string' },
  since: { type: 'string' },
  limit: { type: 'string' },
  section: { type: 'string' },
  refresh: { type: 'boolean', default: false },
  'project-dir': { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false }
};

/** `config/vibe-force.defaults.json` `setup` owns both durations; these are the floors it falls to. */
const SETUP_FALLBACK = { handoffTtlSeconds: 120, describeCacheHours: 24 };

function setupConfig(config) {
  const setup = (config && config.setup) || {};
  return {
    handoffTtlSeconds: Number(setup.handoffTtlSeconds) > 0 ? Number(setup.handoffTtlSeconds) : SETUP_FALLBACK.handoffTtlSeconds,
    describeCacheHours: Number(setup.describeCacheHours) > 0 ? Number(setup.describeCacheHours) : SETUP_FALLBACK.describeCacheHours
  };
}

function fail(code, message) {
  process.stderr.write(`vf-setup: ${message}\n`);
  process.exit(code);
}

function out(json, payload, lines) {
  if (json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else process.stdout.write(`${lines.join('\n')}\n`);
}

/* ---------- state ---------- */

function stateDir(projectRoot) {
  return path.join(projectRoot, '.vibeforce', 'state');
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

/* ---------- sf ---------- */

/** Run `sf` and return parsed JSON. Exit 2 on a missing CLI: that is misconfiguration, not a no. */
function sf(args, { allowFailure = false } = {}) {
  const run = spawnSync('sf', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (run.error && run.error.code === 'ENOENT') {
    fail(EXIT.MISUSE, 'Salesforce CLI not found. Install it: https://developer.salesforce.com/tools/salesforcecli');
  }
  const stdout = run.stdout || '';
  let payload = null;
  try {
    payload = JSON.parse(stdout);
  } catch {
    payload = null;
  }
  if (run.status !== 0 && !allowFailure) {
    const detail =
      (payload && (payload.message || (payload.result && payload.result.message))) ||
      (run.stderr || '').trim().split('\n').slice(-3).join(' ') ||
      `sf ${args[0]} exited ${run.status}`;
    fail(EXIT.MISUSE, `sf ${args.slice(0, 3).join(' ')} failed: ${ss.redactUrl(detail)}`);
  }
  return { status: run.status, payload, stderr: run.stderr || '' };
}

function requireAlias(args) {
  const alias = args['target-org'];
  if (!alias) fail(EXIT.MISUSE, 'no target org: pass --target-org <alias>');
  return alias;
}

/**
 * Setup is written state. A production org gets the same treatment as a production deploy: the
 * user names it and sets VF_ALLOW_PROD=1, or nothing happens. Read-only work is exempt.
 */
function guardProduction(config, alias, { readOnly }) {
  if (readOnly) return;
  if (!isProductionTarget(config, alias)) return;
  if (process.env.VF_ALLOW_PROD === '1') {
    process.stderr.write(`vf-setup: ${alias} is a production alias; proceeding because VF_ALLOW_PROD=1\n`);
    return;
  }
  fail(
    EXIT.MISUSE,
    `${alias} is a production alias. A Setup change there is an unversioned production change.\n` +
      '  Do it in a sandbox, deploy the metadata, or re-run with VF_ALLOW_PROD=1 after saying why.'
  );
}

/* ---------- commands ---------- */

function cmdList(args, ctx) {
  const entries = sd.catalog(ctx.config);
  const rows = Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      key,
      path: value.path,
      route: value.metadata.length ? `deploy ${value.metadata.join('/')}` : value.readOnly ? 'read-only' : 'browser',
      summary: value.summary,
      source: value.source
    }));
  const keyWidth = Math.max(...rows.map((r) => r.key.length), 3);
  const routeWidth = Math.max(...rows.map((r) => r.route.length), 5);
  out(
    args.json,
    { destinations: rows },
    [
      `${'key'.padEnd(keyWidth)}  ${'route'.padEnd(routeWidth)}  path`,
      ...rows.map((r) => `${r.key.padEnd(keyWidth)}  ${r.route.padEnd(routeWidth)}  ${r.path}`),
      '',
      'Any other Setup page: --path <navigation path>, read out of the address bar in a real org.',
      'Persist one for the project under setup.destinations in .vibeforce/config.json.'
    ]
  );
  return EXIT.OK;
}

/** The org's own answer to "what can you deploy", cached because describeMetadata is a round trip. */
function orgTypes(ctx, alias, { refresh }) {
  const cache = path.join(stateDir(ctx.projectRoot), `metadata-types-${alias.replace(/[^\w.-]/g, '_')}.json`);
  const cached = refresh ? null : readJsonFile(cache);
  const maxAgeMs = setupConfig(ctx.config).describeCacheHours * 60 * 60 * 1000;
  if (cached && Array.isArray(cached.types) && Date.now() - Number(cached.at || 0) < maxAgeMs) {
    return { types: new Set(cached.types), fresh: false, apiVersion: cached.apiVersion || null };
  }
  const { payload } = sf(['org', 'list', 'metadata-types', '--target-org', alias, '--json']);
  const types = sd.describedTypes(payload);
  if (!types.size) fail(EXIT.MISUSE, `describeMetadata returned no types for ${alias}`);
  const result = (payload && payload.result) || {};
  writeJsonFile(cache, {
    alias,
    at: Date.now(),
    apiVersion: result.apiVersion || null,
    organizationNamespace: result.organizationNamespace || '',
    types: [...types].sort()
  });
  return { types, fresh: true, apiVersion: result.apiVersion || null };
}

function recordGate(ctx, entry) {
  const file = path.join(stateDir(ctx.projectRoot), 'setup-gate.json');
  const current = readJsonFile(file) || { entries: [] };
  const entries = Array.isArray(current.entries) ? current.entries : [];
  const kept = entries.filter((e) => !(e && e.path === entry.path && e.alias === entry.alias)).slice(-49);
  writeJsonFile(file, { entries: [...kept, entry] });
}

function gateFor(args, ctx, { quiet = false } = {}) {
  const alias = requireAlias(args);
  const resolved = sd.resolveDestination(args.path || args._dest, ctx.config);
  if (!resolved.ok) fail(EXIT.MISUSE, resolved.error);
  const destination = resolved.destination;
  const described = orgTypes(ctx, alias, { refresh: args.refresh });
  const verdict = sd.metadataVerdict({ destination, orgTypes: described.types });
  const entry = {
    path: destination.path,
    key: destination.key || null,
    alias,
    verdict: verdict.verdict,
    types: verdict.types,
    at: new Date().toISOString()
  };
  recordGate(ctx, entry);
  if (!quiet) {
    const payload = { ...entry, reason: verdict.reason, apiVersion: described.apiVersion, cached: !described.fresh };
    const lines = [
      `destination : ${destination.path}${destination.key ? ` (${destination.key})` : ''}`,
      `org         : ${alias}${described.apiVersion ? ` @ API ${described.apiVersion}` : ''}`,
      `verdict     : ${verdict.verdict}`,
      `reason      : ${verdict.reason}`
    ];
    if (verdict.verdict === sd.VERDICT.DEPLOY) lines.push('', sd.deployInsteadHint(destination, verdict.types));
    if (verdict.verdict === sd.VERDICT.UNKNOWN) {
      lines.push(
        '',
        'Say what you are changing and check it against the Metadata Coverage Report:',
        '  https://developer.salesforce.com/docs/metadata-coverage',
        'If a type covers it, deploy that type instead of clicking.'
      );
    }
    out(args.json, payload, lines);
  }
  return { alias, destination, verdict };
}

function cmdCheck(args, ctx) {
  const { verdict } = gateFor(args, ctx);
  return verdict.verdict === sd.VERDICT.DEPLOY ? EXIT.NO : EXIT.OK;
}

/**
 * Mint one authenticated hand-off.
 *
 * The frontdoor URL lives in this process only. The browser gets a loopback URL with a one-shot
 * token; the redirect is served exactly once, then the server closes. A hand-off nobody used is
 * exit 1, because a frontdoor URL that was minted and abandoned is a live session left behind.
 */
async function cmdServe(args, ctx) {
  const { alias, destination, verdict } = gateFor(args, ctx, { quiet: true });
  guardProduction(ctx.config, alias, { readOnly: destination.readOnly });
  if (verdict.verdict === sd.VERDICT.DEPLOY) {
    process.stderr.write(`vf-setup: refusing a browser hand-off.\n${sd.deployInsteadHint(destination, verdict.types)}\n`);
    return EXIT.NO;
  }

  const ttl = Math.min(Math.max(Number(args.ttl || setupConfig(ctx.config).handoffTtlSeconds), 10), 900);
  const port = Number(args.port || 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(EXIT.MISUSE, `bad --port ${args.port}`);

  const { payload } = sf(['org', 'open', '--url-only', '--json', '--path', destination.path, '--target-org', alias]);
  const frontdoor = (payload && payload.result && payload.result.url) || '';
  if (!frontdoor) fail(EXIT.MISUSE, 'sf org open returned no URL');
  if (!ss.isCredentialUrl(frontdoor)) {
    // Not fatal - the UI Bridge response shape is Salesforce's to change - but worth saying.
    process.stderr.write('vf-setup: note: the URL sf returned does not look like a frontdoor URL\n');
  }

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + ttl * 1000;
  let consumed = false;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const refusal = ss.handoffRefusal({
      method: req.method,
      pathname: url.pathname,
      host: req.headers.host,
      token: ss.parseHandoffPath(url.pathname),
      expectedToken: token,
      consumed,
      expiresAt,
      now: Date.now()
    });
    if (refusal) {
      res.writeHead(ss.REFUSAL_STATUS[refusal] || 400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`vf-setup: ${ss.REFUSAL_REASON[refusal] || refusal}\n`);
      process.stderr.write(`vf-setup: hand-off refused (${refusal})\n`);
      return;
    }
    consumed = true;
    res.writeHead(302, {
      location: frontdoor,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-length': '0'
    });
    res.end();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  }).catch((err) => fail(EXIT.MISUSE, `cannot bind 127.0.0.1:${port}: ${err.message}`));

  const bound = server.address().port;
  const handoff = ss.handoffUrl(bound, token);
  const meta = {
    handoff,
    destination: destination.path,
    targetOrg: alias,
    verdict: verdict.verdict,
    expiresAt: new Date(expiresAt).toISOString(),
    ttlSeconds: ttl,
    singleUse: true,
    frontdoor: ss.redactUrl(frontdoor)
  };
  out(args.json, meta, [
    `hand-off    : ${handoff}`,
    `destination : ${destination.path}`,
    `org         : ${alias}`,
    `valid until : ${meta.expiresAt}  (single use)`,
    '',
    'Navigate a browser to the hand-off URL. It redirects once, then this process exits.'
  ]);

  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('expired'), ttl * 1000);
    const poll = setInterval(() => {
      if (consumed) {
        clearTimeout(timer);
        clearInterval(poll);
        // Give the redirect response time to flush before the socket closes.
        setTimeout(() => resolve('consumed'), 250);
      }
    }, 100);
  });
  server.close();

  if (result === 'consumed') {
    process.stderr.write('vf-setup: hand-off consumed; session handed to the browser\n');
    return EXIT.OK;
  }
  process.stderr.write(
    'vf-setup: hand-off expired unused. The frontdoor URL was minted and never spent - it stays ' +
      'valid until Salesforce expires it. Re-run when the browser is ready.\n'
  );
  return EXIT.NO;
}

/** `2h`, `90m`, `3d` -> a SOQL-safe ISO datetime. */
function sinceIso(value) {
  const raw = String(value || '1h').trim();
  const m = /^(\d+)\s*([mhd])$/i.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const ms = unit === 'm' ? n * 60000 : unit === 'h' ? n * 3600000 : n * 86400000;
  return new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Read Setup changes back out of the org.
 *
 * SetupAuditTrail "[r]epresents changes you or other admins made in your org's Setup area for at
 * least the last 180 days" (Object Reference). `Action` is the category, `Display` the sentence,
 * `Section` the Setup area. Aggregates are not supported on it, so this stays a plain query.
 */
function cmdAudit(args, ctx) {
  const alias = requireAlias(args);
  const since = sinceIso(args.since);
  if (!since) fail(EXIT.MISUSE, `bad --since ${args.since}: use 30m, 2h or 3d`);
  const limit = Math.min(Math.max(Number(args.limit || 50), 1), 500);
  const section = args.section ? String(args.section).replace(/'/g, "\\'") : '';
  const where = [`CreatedDate > ${since}`, section ? `Section = '${section}'` : ''].filter(Boolean).join(' AND ');
  const query =
    'SELECT Id, Action, Section, Display, CreatedDate, CreatedBy.Username, DelegateUser ' +
    `FROM SetupAuditTrail WHERE ${where} ORDER BY CreatedDate DESC LIMIT ${limit}`;

  const { payload } = sf(['data', 'query', '--target-org', alias, '--result-format', 'json', '--query', query]);
  const records = (payload && payload.result && payload.result.records) || [];
  const rows = records.map((r) => ({
    at: r.CreatedDate,
    action: r.Action,
    section: r.Section,
    display: r.Display,
    by: (r.CreatedBy && r.CreatedBy.Username) || '',
    delegate: r.DelegateUser || ''
  }));
  out(
    args.json,
    { targetOrg: alias, since, count: rows.length, records: rows },
    rows.length
      ? [
          `${rows.length} Setup change(s) in ${alias} since ${since}`,
          ...rows.map((r) => `${r.at}  ${r.section || '-'}  ${r.action}  ${r.display || ''}  [${r.by}]`)
        ]
      : [`no Setup changes in ${alias} since ${since}`]
  );
  return rows.length ? EXIT.OK : EXIT.NO;
}

function cmdClean(args, ctx) {
  const dir = stateDir(ctx.projectRoot);
  const removed = [];
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    names = [];
  }
  for (const name of names) {
    if (!/^metadata-types-.*\.json$|^setup-gate\.json$/.test(name)) continue;
    fs.rmSync(path.join(dir, name), { force: true });
    removed.push(name);
  }
  out(args.json, { removed }, removed.length ? [`removed ${removed.length} file(s):`, ...removed] : ['nothing to remove']);
  return EXIT.OK;
}

/* ---------- entry ---------- */

const COMMANDS = {
  list: cmdList,
  check: cmdCheck,
  serve: cmdServe,
  audit: cmdAudit,
  clean: cmdClean
};

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    fail(EXIT.MISUSE, err.message);
  }
  const args = parsed.values;
  const [command, dest] = parsed.positionals;
  if (args.help || !command) {
    process.stdout.write(USAGE);
    process.exit(args.help ? EXIT.OK : EXIT.MISUSE);
  }
  const run = COMMANDS[command];
  if (!run) fail(EXIT.MISUSE, `unknown command ${command}. One of: ${Object.keys(COMMANDS).join(', ')}`);
  args._dest = dest || '';

  const startDir = args['project-dir'] ? path.resolve(args['project-dir']) : process.cwd();
  // loadConfig returns an envelope; `config` alone is what isProductionTarget and the catalog read.
  const { config, projectRoot } = loadConfig(startDir);
  const ctx = { config, projectRoot };
  process.exit(await run(args, ctx));
}

main(process.argv.slice(2)).catch((err) => {
  fail(EXIT.MISUSE, process.env.VF_DEBUG === '1' ? err.stack : err.message);
});
