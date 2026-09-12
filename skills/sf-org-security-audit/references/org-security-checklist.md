# Org Security Audit Checklist

Every check, in audit order: what to ask, how to get the answer, what a healthy org looks like, and
the severity when it differs. Commands are read-only and safe against production. Replace
`vf-prod` with the alias being audited.

Severity scale, used throughout:

| Severity | Meaning |
| --- | --- |
| high | Data exposure or privilege escalation is available today |
| medium | A grant wider than the need, or a control with a gap |
| low | Hardening opportunity with no current exposure |

Paths under a retrieve `--output-dir` are located with `find`, never guessed: an `ls` against a
missing directory reads as zero findings. Field and object names used below are the ones confirmed
in this repository's skills. Anything else
is marked `[unverified]` - describe the object before relying on it.

## 1. Identity and access

| # | Check | How | Healthy | Severity if not |
| --- | --- | --- | --- | --- |
| I1 | Active user inventory | `sf org list users --target-org vf-prod` | Every account maps to a person or a documented integration | medium |
| I2 | Inactive users holding grants | `SELECT Assignee.Username, Assignee.IsActive, PermissionSet.Name FROM PermissionSetAssignment WHERE Assignee.IsActive = false` | No rows for administrative permission sets | medium |
| I3 | MFA coverage | Setup → Identity | Every interactive user | high |
| I4 | Session timeout and lock-to-IP | Setup → Session Settings | Timeout set, clickjack protection on | medium |
| I5 | Password policy | Setup → Password Policies | Expiry, history, complexity, lockout configured | medium |
| I6 | Login IP ranges on admin profiles | Setup → Profiles | Admin profiles restricted, or MFA compensating | medium |
| I7 | API Enabled on non-integration users | Permission set and profile review | Only integrations and tooling users | low |
| I8 | Certificates near expiry | Setup → Certificate and Key Management | Nothing expiring inside 90 days | medium |

## 2. Administrative grants

| # | Check | Query | Healthy | Severity if not |
| --- | --- | --- | --- | --- |
| G1 | `ModifyAllData` holders | `SELECT Assignee.Username, PermissionSet.Name FROM PermissionSetAssignment WHERE PermissionSet.PermissionsModifyAllData = true` | Named admins only | high |
| G2 | `ViewAllData` holders | Same with `PermissionsViewAllData` | Named admins, or a documented reporting role | high |
| G3 | Integration user with either | Cross-reference G1/G2 against integration accounts | No integration holds them | high |
| G4 | Object-level sharing bypass | `SELECT Parent.Name, SobjectType, PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE PermissionsModifyAllRecords = true` | Each row has a named reason | high |
| G5 | Author Apex outside release | `PermissionsAuthorApex` `[unverified field name]` | Release process only | medium |
| G6 | View Encrypted Data | `PermissionsViewEncryptedData` `[unverified field name]` | Nobody, unless a documented role needs it | high |
| G7 | Permission set groups used for personas | `find "$AUDIT/metadata" -path "*/permissionsetgroups/*" -type f` | Personas are groups, features are sets | low |
| G8 | Unassigned permission sets | `SELECT COUNT(Id) FROM PermissionSetAssignment WHERE PermissionSet.Name = '<name>'` | Zero only for staged sets with a note | low |

## 3. Object and field access

| # | Check | Query | Healthy | Severity if not |
| --- | --- | --- | --- | --- |
| A1 | Object matrix per permission set | `SELECT Parent.Name, SobjectType, PermissionsRead, PermissionsCreate, PermissionsEdit, PermissionsDelete FROM ObjectPermissions` | Matches the documented matrix | medium |
| A2 | Delete on transactional objects | Same query, filter `PermissionsDelete = true` | Restricted to roles that need it | medium |
| A3 | Field access on sensitive fields | `SELECT Parent.Name, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '<Object>'` | PII and financial fields read-restricted | high |
| A4 | Encrypted or classified fields exposed | A3 output against the field classification | No broad read on classified fields | high |
| A5 | Apex class access | `SELECT Parent.Name, SetupEntityId FROM SetupEntityAccess WHERE SetupEntityType = 'ApexClass'` | Only classes a persona needs | medium |

## 4. Record access

| # | Check | How | Healthy | Severity if not |
| --- | --- | --- | --- | --- |
| R1 | Org-wide defaults | `grep -rh "<sharingModel>" force-app/main/default/objects/*/*.object-meta.xml \| sort \| uniq -c` | Sensitive objects `Private` or `Read` | high when a sensitive object is `ReadWrite` |
| R2 | Sharing rules widening access | `find "$AUDIT/metadata" -path "*/sharingRules/*" -type f` | Each rule traceable to a requirement | medium |
| R3 | `without sharing` inventory | `grep -rln "without sharing" force-app --include="*.cls"` | Few, narrow, documented, negative-tested | high when reachable from `@AuraEnabled` |
| R4 | Classes with no sharing keyword | `grep -rLn "with sharing\|without sharing\|inherited sharing" force-app/main/default/classes/*.cls` | None among user-reachable classes | high for `@AuraEnabled` classes |
| R5 | Apex managed sharing | `grep -rn "__Share\b" force-app --include="*.cls"` | Documented, with a rollback path | medium |
| R6 | Role hierarchy depth | Setup → Roles | Shallow enough to reason about | low |

## 5. Code and API exposure

| # | Check | How | Healthy | Severity if not |
| --- | --- | --- | --- | --- |
| C1 | `@AuraEnabled` inventory | `grep -rn "@AuraEnabled" force-app --include="*.cls"` | Each method narrow and user-mode | high for a generic query or DML endpoint |
| C2 | `@RestResource` and `webService` | `grep -rn "@RestResource\|webService" force-app --include="*.cls"` | Authenticated, scoped, rate-aware | high when unauthenticated |
| C3 | User-mode data access | Read each C1/C2 method: `WITH USER_MODE`, `as user`, `AccessLevel.USER_MODE`, or `stripInaccessible` | Present, or system mode with a written reason | high |
| C4 | Dynamic SOQL | `grep -rn "Database.query\|Database.queryWithBinds" force-app --include="*.cls"` | Bound variables or `escapeSingleQuotes` | high |
| C5 | Client-side authorisation | Grep LWC for hidden-button logic standing in for a control | Server enforces every decision | high |
| C6 | `innerHTML`-style injection in LWC | `grep -rn "innerHTML\|lwc:dom" force-app --include="*.js"` | Sanitised or absent | medium |
| C7 | Hardcoded ids in security decisions | `grep -rnE "'[a-zA-Z0-9]{15,18}'" force-app --include="*.cls"` | None | medium |

## 6. Public and guest surface

| # | Check | How | Healthy | Severity if not |
| --- | --- | --- | --- | --- |
| P1 | Sites and Experience Cloud present | `ls force-app/main/default/networks/ force-app/main/default/sites/` | Known and intentional | - |
| P2 | Guest user object access | Guest profile in Setup, plus A1 for the guest permission sets | Read-only, reference data only | high for any person data |
| P3 | Guest access to Apex classes | A5 filtered to guest permission sets | Only what the public flow needs | high |
| P4 | `without sharing` reachable by guest | Cross-reference R3 with P3 | None | high |
| P5 | Guest user sharing rules | `find "$AUDIT/metadata" -path "*/sharingRules/*" -type f` | Narrow, and only for public data | high |
| P6 | User object personal-information visibility | Setup → Sharing Settings | Restricted; user mode does not enforce it | medium |

## 7. Integrations and secrets

| # | Check | How | Healthy | Severity if not |
| --- | --- | --- | --- | --- |
| N1 | Named Credentials inventory | `find "$AUDIT/metadata" -path "*/namedCredentials/*" -type f` | One per external system, no inline credentials | medium |
| N2 | External Credentials and principals | `find "$AUDIT/metadata" -path "*/externalCredentials/*" -type f` | Principals mapped to permission sets | medium |
| N3 | Remote Site Settings without a Named Credential | `find "$AUDIT/metadata" -path "*/remoteSiteSettings/*" -type f`, versus N1 | None left over | medium |
| N4 | Secrets in source | `grep -rniE "password\|secret\|token\|api[_-]?key" force-app` | No literal values | high |
| N5 | Secrets in git history | `git log -p --all -S"<term>" -- force-app` | None; if found, rotate | high |
| N6 | Connected apps and OAuth scopes | Setup → Connected Apps | No `full` scope without a reason; approvals recorded | high |
| N7 | Integration user least privilege | G1-G4 filtered to integration accounts | Object-scoped permission sets only | high |
| N8 | Callout endpoints in code | `grep -rnE "https?://" force-app --include="*.cls"` | All through Named Credentials | medium |

## 8. Monitoring and change control

| # | Check | How | Healthy | Severity if not |
| --- | --- | --- | --- | --- |
| M1 | Setup Audit Trail review | Setup → View Setup Audit Trail `[unverified: API queryability]` | Security changes explained and attributed | medium |
| M2 | Recent permission changes | M1 output filtered to permission and profile entries | Each matches a ticket | medium |
| M3 | Event Monitoring availability | Licensing | Known either way; used if licensed | low |
| M4 | Shield Platform Encryption | Licensing and field classification | Classified fields encrypted where required | medium |
| M5 | Login history anomalies | Setup → Login History | No unexplained geographies or API spikes | medium |
| M6 | Debug logs holding sensitive data | `sf apex list log --target-org vf-prod` and the retention policy | Logs short-lived, no secrets logged | medium |

## 9. Findings that are almost always mis-filed

| Symptom | Wrong finding | Right finding |
| --- | --- | --- |
| 40 profiles in the org | "Too many profiles" | Name the grants they carry that a permission set should carry, with evidence from A1 |
| A class with `without sharing` | "Insecure sharing" | Say who can reach it and what records that exposes |
| Analyzer security rule hit | "Vulnerability" | Read the code; report the reachable path or downgrade to low |
| A permission set nobody is assigned | "Unused permission set" | Debt, not exposure - file it in the debt register instead |
| Guest user exists | "Public exposure" | Enumerate what the guest can actually read and run |
| `ModifyAllData` on the admin profile | "Privilege escalation" | Expected for admins; the finding is who else is in that profile |

## 10. Re-running the audit

| Trigger | Scope |
| --- | --- |
| Quarterly | The full checklist, diffed against the previous report |
| Before a release that changes permissions or sharing | Sections 2, 3, 4 |
| After an incident | Sections 1, 7, 8, plus the Setup Audit Trail window around the event |
| On a new integration | Section 7 only |
| On new public surface (a Site, an Experience) | Section 6 in full |

The value is in the diff. Keep every report in `.vibeforce/reports/`, and open each new one by
listing what changed since the last: new grants, new public surface, new integrations, and findings
that were accepted rather than fixed.

## 11. Evidence handling

The report describes exposures, so the report is itself sensitive.

| Rule | Practice |
| --- | --- |
| Redact identities | Reference "3 integration accounts", not usernames; keep the mapping in a separate access-controlled file |
| Never paste tokens, session ids, or auth URLs | `sf org display --verbose` and `org auth show-*` print secrets - keep them out of the report entirely |
| Store raw query output beside the report | `.vibeforce/reports/audit/` is gitignored in the consumer project; keep it that way |
| Name the auditing user | Findings depend on what that user can see; an audit run as a restricted user understates exposure |
| Time-box the sensitive artefacts | Delete raw dumps once the report is accepted |

## 12. Severity calibration

Three worked calls, so the scale means the same thing across audits:

| Situation | Severity | Reasoning |
| --- | --- | --- |
| Guest user has read on a custom object holding contact email addresses | high | Unauthenticated read of person data, exploitable today |
| A `without sharing` selector reachable only from a scheduled job | low | No user-facing path; document the elevation and move on |
| Integration user holds `ViewAllData` where three object permissions would do | high | Credential compromise becomes full data read; the fix is scoped and cheap |

When two auditors disagree, the tie-breaker is reachability: can someone exercise this today, with
credentials they already have? If yes, it is high.

## References

- Skill `sf-security-model` - enforcement in code, permission architecture, sharing and record access, the CRUD/FLS catalogue.
- Skill `sf-technical-debt-audit` - the maintainability sweep that shares this audit's inventory step.
- Skill `sf-integration-patterns` - Named and External Credentials in depth.
- Agent `sf-security-reviewer` - the per-diff review this checklist does not replace.
