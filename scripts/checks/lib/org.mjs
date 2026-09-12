/**
 * Target-org resolution and the production guard.
 *
 * `--target-org` wins; otherwise `--env <key>` selects `config.orgs[key]`, and finally
 * `config.orgs[config.defaultOrgKey]`. Aliases listed in `config.productionAliases` are treated as
 * production: mutating checks refuse to run unless `VF_ALLOW_PROD=1`, while the deploy family and
 * the read-only smoke probes run but print a production banner.
 */

import { EXIT, VfError } from './result.mjs';
import { envFlag } from './config.mjs';
import { execJson, isToolMissing, installHint, resolveBin } from './run.mjs';

export function resolveTargetOrg(ctx) {
  const explicit = ctx.args['target-org'];
  if (explicit) return String(explicit);

  const orgs = ctx.config.orgs ?? {};
  const envKey = ctx.args.env || ctx.config.defaultOrgKey || 'dev';
  const alias = orgs[envKey];
  if (alias) return String(alias);

  throw new VfError(
    `No target org resolved for check "${ctx.check}"`,
    EXIT.CONFIG,
    `Pass --target-org <alias>, or set orgs.${envKey} in ${ctx.config.__sources?.project ?? '.vibeforce/config.json'}.`,
  );
}

export function isProduction(alias, config) {
  const list = (config.productionAliases ?? []).map((value) => String(value).toLowerCase());
  return list.includes(String(alias).toLowerCase());
}

/**
 * @param {'refuse'|'banner'} policy `refuse` blocks mutating checks, `banner` warns loudly for
 *   deploy and read-only verification checks that legitimately target production.
 */
export function guardProduction(ctx, targetOrg, policy) {
  if (!isProduction(targetOrg, ctx.config)) return { production: false, overridden: false };

  const allowed = envFlag(ctx.env, 'VF_ALLOW_PROD');
  if (policy === 'refuse' && !allowed) {
    throw new VfError(
      `Refusing to run "${ctx.check}" against production org "${targetOrg}"`,
      EXIT.CONFIG,
      'Target a sandbox or scratch org, or set VF_ALLOW_PROD=1 to override deliberately.',
    );
  }

  ctx.log.banner(
    `PRODUCTION ORG: ${targetOrg} - check "${ctx.check}"${allowed ? ' (VF_ALLOW_PROD=1)' : ''}`,
  );
  return { production: true, overridden: allowed };
}

/**
 * `sf org display --json` without `--verbose`: the verbose form prints sfdxAuthUrl, which is a
 * refresh-token-bearing secret that must never reach a report file.
 */
export async function describeOrg(ctx, targetOrg) {
  const res = await execJson(resolveBin(ctx.config, 'sf'), ['org', 'display', '--target-org', targetOrg, '--json'], {
    cwd: ctx.projectRoot,
    env: ctx.env,
    timeoutMs: 120000,
  });

  if (isToolMissing(res)) {
    throw new VfError('Salesforce CLI (sf) is not installed', EXIT.CONFIG, installHint('sf'));
  }
  if (res.code !== 0 || !res.json?.result) {
    const message = res.json?.message || res.stderr.trim() || `sf org display exited ${res.code}`;
    throw new VfError(
      `Cannot reach org "${targetOrg}": ${message}`,
      EXIT.ORG,
      `Authenticate with: sf org login web --alias ${targetOrg}`,
    );
  }

  const result = res.json.result;
  return {
    alias: result.alias ?? targetOrg,
    username: result.username,
    orgId: result.id,
    instanceUrl: result.instanceUrl,
    apiVersion: result.apiVersion,
    connectedStatus: result.connectedStatus,
  };
}

/** Shared argument tail for every org-touching sf invocation. */
export function orgArgs(targetOrg) {
  return ['--target-org', targetOrg];
}
