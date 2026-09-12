# Ownership matrix

Parallel waves are safe only while no two agents can write the same file. This is the map the
`pre-edit-guard` hook enforces, plus the claim lifecycle and the conflict-resolution rules.

## Path to slice to agent

| Path glob | Slice | Owning agent | Notes |
| --- | --- | --- | --- |
| `**/classes/**` | apex | `sf-apex-engineer` | except `classes/integration/**` |
| `**/classes/integration/**` | integration | `sf-integration-engineer` | callout clients, webhook handlers, event publishers |
| `**/triggers/**` | apex | `sf-apex-engineer` | one trigger per object |
| `**/lwc/**` | lwc | `sf-lwc-engineer` | includes `__tests__/**` for that bundle |
| `**/aura/**` | lwc | `sf-lwc-engineer` | legacy surface |
| `**/staticresources/**` | lwc | `sf-lwc-engineer` | bundled assets, test data resources |
| `**/objects/**` | metadata | `sf-metadata-engineer` | fields, record types, validation rules, list views |
| `**/permissionsets/**`, `**/permissionsetgroups/**` | metadata | `sf-metadata-engineer` | permission-set-first policy |
| `**/profiles/**` | metadata | `sf-metadata-engineer` | hook prompts before every write |
| `**/flows/**` | metadata | `sf-metadata-engineer` | active version handling on deploy |
| `**/layouts/**`, `**/flexipages/**`, `**/tabs/**`, `**/applications/**` | metadata | `sf-metadata-engineer` | UI assembly |
| `**/labels/**`, `**/settings/**`, `**/globalValueSets/**` | metadata | `sf-metadata-engineer` | shared, high-collision: keep edits small |
| `**/namedCredentials/**`, `**/externalCredentials/**` | integration | `sf-integration-engineer` | secrets never in source |
| `**/externalServices/**`, `**/platformEventChannels/**`, `**/platformEventChannelMembers/**`, `**/remoteSiteSettings/**`, `**/connectedApps/**`, `**/authproviders/**` | integration | `sf-integration-engineer` | |
| `*Test.cls`, `**/__tests__/**` | tests | wave-1 owner in wave 1, `sf-test-engineer` in wave 2 | ownership hands over at the wave boundary |
| `.vibeforce/state/**`, `.sfdx/**`, `.sf/**`, `.localdevserver/**`, `node_modules/**` | none | nobody | hook denies all writes |
| `sfdx-project.json`, `.forceignore`, `package.json`, CI workflows | project | orchestrator only | changing them mid-wave invalidates every sibling's checks |

The same table lives in code at `scripts/lib/sf-paths.js` (`SLICES`). Change one, change both;
`tests/hooks.test.mjs` asserts the mapping for the common paths.

## Claim lifecycle

```
write attempt -> pre-edit-guard
                   |-- path generated?                  -> deny
                   |-- secret in content?               -> deny/ask
                   |-- claimed by another live agent?   -> deny (ownership-conflict)
                   |-- cross-slice for this agent type? -> deny (slice-boundary)
                   '-- otherwise                        -> pass (+ advisory notes)
write succeeds -> post-edit-check
                   |-- claim path for agent_id
                   |-- add path to session touch list
                   |-- lint metadata XML, check api version drift
                   '-- format with the project's prettier when hooks.autoFormat is on
agent finishes -> subagent-stop-release
                   '-- drop every claim held by that agent_id, record them in events.jsonl
```

Claims expire after 6 hours (`CLAIM_TTL_MS` in `scripts/lib/state.js`) so a crashed agent
cannot block the repository permanently. State file:

```bash
jq '.claims | to_entries | map({path: .key, agent: .value.agentType})' .vibeforce/state/ownership.json
```

## Conflict resolution

| Conflict | Resolution |
| --- | --- |
| Two slices genuinely need the same file (for example a shared label file) | Orchestrator serialises it: one agent owns the file for this story, the other requests the change in its hand-off |
| A wave-1 agent needs a field that another agent owns | Contract change request, not an edit. Orchestrator updates `contract.md` and the owning agent applies it |
| An LWC needs a new Apex method | Signature was already fixed in wave 0; if it was not, the wave pauses, the orchestrator publishes the signature, then both continue |
| A gate finding sits in another agent's slice | Route it to that agent in wave 2, or have the orchestrator apply a one-line fix and say so in the report |
| Two agents both add a permission set entry | Permission set is metadata-slice property: only `sf-metadata-engineer` writes it, from the entries the others list in their hand-off |
| A claim is stale but the agent is gone | `release` on session start, or delete the entry; claims older than 6h are ignored anyway |

## Splitting a story so ownership is disjoint

Split by **metadata type**, never by feature area, because metadata type is what the hook can
verify and what the deploy unit is. A story that cannot be split that way is a story that needs
the contract fixed first:

| Story shape | Split |
| --- | --- |
| New field surfaced in a component with server-side validation | metadata (field + permission set + validation rule), apex (service + test), lwc (component + jest) |
| New integration with retry and admin toggle | integration (named credential + client + event), apex (service + queueable), metadata (custom metadata toggle + permission set) |
| Refactor of a trigger into a domain layer | apex only, single agent, no parallelism to gain |
| Flow replacing Apex automation | metadata (flow + tests), apex (delete + regression tests) - serialise: the delete follows the flow |

## Files that must never be edited in parallel

Large, merge-hostile metadata. Assign a single owner for the whole story, or change them in a
dedicated serial step:

- `*.profile-meta.xml` (thousands of lines, unordered, deploy-fragile)
- `*.permissionset-meta.xml` when several stories add entries at once
- `CustomLabels.labels-meta.xml` (single file for all labels)
- `*.flexipage-meta.xml`, `*.layout-meta.xml` (generated ordering)
- `package.xml` manifests
- `*.flow-meta.xml` (single active version; concurrent edits produce two divergent versions)
