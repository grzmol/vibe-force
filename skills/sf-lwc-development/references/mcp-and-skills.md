# Salesforce DX MCP Tools and LWC Skills

Agent-facing Salesforce tooling for LWC work: what the `lwc-experts`, `aura-experts` and
`experts-validation` MCP toolsets contain, how to configure them, which tools are generally
available, and which Agentforce Vibes skill superseded each one. Everything here is assistive - it
generates guidance and code, never a verdict. `vf-check` remains the gate.

Status as of the documentation fetched in September 2026:

| Surface | Status | Where it runs |
| --- | --- | --- |
| MCP Tools for LWC (`lwc-experts`, `aura-experts`) | Beta, and "as of August 2026 superseded by LWC skills" | Any MCP client: Claude Code, Agentforce Vibes, Cursor, VS Code with Copilot |
| Validation tools (`experts-validation`) | Developer preview - explicitly not for production use | Same |
| LWC skills (`experience-lwc-*`, `experience-lds-*`) | Enabled by default in Agentforce Vibes | Agentforce Vibes; sources published in `forcedotcom/afv-library` |

Superseded does not mean removed: the MCP tools are still the surface an MCP client other than
Agentforce Vibes can use, and the tool tables below carry the mapping so a prompt written against
a skill name can be traced back to the tool that does the work.

## 1. Configuration

The server is the Salesforce DX MCP Server, run through `npx`. Toolsets are opt-in.

```json
{
  "mcpServers": {
    "Salesforce DX": {
      "command": "npx",
      "args": ["-y", "@salesforce/mcp@latest", "--orgs", "DEFAULT_TARGET_ORG", "--toolsets", "lwc-experts,aura-experts,experts-validation"]
    }
  }
}
```

| Flag | Effect |
| --- | --- |
| `--toolsets <names>` | Enables whole toolsets. Some tools call other tools in the same toolset, so enabling the full set is the documented recommendation |
| `--tools <names>` | Enables individual tools instead, for example `guide_figma_to_lwc_conversion,create_lwc_component_from_prd` |
| `--orgs <alias or DEFAULT_TARGET_ORG>` | Org access for the tools that reach an org (`test_lds_graphql_query`, schema exploration) |
| `--allow-non-ga-tools` | Required for every tool marked NON-GA below |

Org safety: the same rules as the rest of this plugin apply to an MCP-driven session. Point
`--orgs` at a scratch org or sandbox alias, never a production alias, and keep production work
behind `deploy-validate` plus `deploy-quick` (skill `sf-deployment-strategies`).

In Agentforce Vibes specifically, the documentation requires the `a4d-general-rules-no-edit.md`
and `a4d-lwc-rules-no-edit.md` global rules to be enabled when using these tools.

## 2. Development tools (`lwc-experts`)

| Tool | GA | What it returns | Superseded by skill |
| --- | --- | --- | --- |
| `guide_lwc_development` | GA | Development workflow and implementation guidelines | `experience-lwc-generate` |
| `guide_lwc_best_practices` | GA | Best practices and coding standards guidance | `experience-lwc-generate` |
| `create_lwc_component_from_prd` | GA | A complete component from a PRD specification | `experience-lwc-design-generate` |
| `orchestrate_lwc_component_creation` | GA | Step-by-step component creation guidance | `experience-lwc-design-generate` |
| `orchestrate_lwc_component_optimization` | GA | Performance and best-practice optimisation passes | `experience-lwc-design-generate` |
| `guide_component_accessibility` | GA | Accessibility guidelines and testing instructions | `experience-lwc-accessibility-validate` |
| `guide_lwc_rtl_support` | GA | Right-to-left internationalisation guidance | `experience-lwc-rtl-validate` |
| `reference_lwc_compilation_error` | GA | Error patterns, causes and fixes for LWC compilation errors | N/A |
| `explore_slds_blueprints` | NON-GA | Guidelines for the SLDS component blueprints you name | `design-systems-slds-apply` |
| `explore_slds_styling` | NON-GA | Usage patterns, accessibility notes and validation checklists for styling hooks | `design-systems-slds-validate` |
| `guide_slds_blueprints` | NON-GA | Blueprint guidelines and the full blueprint index by category | `design-systems-slds-apply` |
| `guide_slds_styling` | NON-GA | Styling hook guidelines, principles, patterns, accessibility notes | `design-systems-slds-apply` |
| `orchestrate_lwc_slds2_uplift` | NON-GA | Migration guidance for upgrading to SLDS 2 | `design-systems-slds2-migrate` |

`guide_lwc_development`, `orchestrate_lwc_component_creation`, `guide_component_accessibility` and
`create_lwc_component` are the tools enabled by default in Agentforce Vibes.

## 3. Testing tools (`lwc-experts`)

| Tool | GA | What it returns | Superseded by skill |
| --- | --- | --- | --- |
| `orchestrate_lwc_component_testing` | GA | A testing workflow: render states, user events, wires, errors | `experience-lwc-test` |
| `create_lwc_jest_tests` | GA | Jest suites covering load, success, empty and error states | `experience-lwc-generate` |
| `review_lwc_jest_tests` | GA | Review of existing specs: cleanup, async handling, coverage gaps | `experience-lwc-generate` |
| `run_lwc_accessibility_jest_tests` | GA | Accessibility testing utilities and their Jest integration | N/A |
| `guide_utam_generation` | NON-GA | UTAM page-object generation guidelines | `experience-lwc-test` |

Generated specs are input to `vf-check jest`, not a substitute for it: the mocking rules, the
coverage gate and the `__tests__` layout this plugin enforces live in skill `sf-lwc-jest-testing`.
A generated suite that mocks a wire adapter the wrong way fails the same gate a hand-written one
would.

## 4. Base components and Lightning Data Service

| Tool | GA | What it returns | Superseded by skill |
| --- | --- | --- | --- |
| `guide_lbc_usage` | GA | Index of base components, to pick the right `lightning-*` | `experience-lwc-base-components-integrate` |
| `explore_lbc_components` | GA | Usage guidance for a specific base component | `design-systems-slds-apply` |
| `guide_lds_development` | GA | LDS development guidelines and component integration | `experience-lds-best-practices-apply` |
| `guide_lds_data_consistency` | GA | Data consistency patterns for LDS-based components | `experience-lds-best-practices-apply` |
| `guide_lds_referential_integrity` | GA | Referential integrity patterns for LDS data management | `experience-lds-best-practices-apply` |
| `explore_lds_uiapi` | GA | UI API capabilities and type definitions | `experience-lds-best-practices-apply` |
| `orchestrate_lds_data_requirements` | GA | A PRD-ready data specification from a vague data need | `experience-lds-data-requirements-generate` |
| `guide_lds_graphql` | GA | GraphQL patterns for the `lightning/graphql` wire adapter | `experience-lds-graphql-generate` |
| `fetch_lds_graphql_schema` | GA | Static GraphQL schema information and common types | N/A |
| `create_lds_graphql_read_query` | GA | Guidelines for a GraphQL read query | `experience-lds-graphql-generate` |
| `create_lds_graphql_mutation_query` | GA | Guidelines for a GraphQL mutation | `experience-lds-graphql-generate` |
| `test_lds_graphql_query` | GA | Runs a query against the connected org; invoked only by the two query tools | N/A |

`test_lds_graphql_query` is the one tool in this group that touches an org. Treat it like any other
org call: sandbox or scratch alias only.

## 5. Design, SLDS, migration and security

| Tool | GA | Toolset | What it returns | Superseded by skill |
| --- | --- | --- | --- | --- |
| `guide_figma_to_lwc_conversion` | GA | `lwc-experts` | Figma design to LWC specification; it does not fetch from Figma itself | `experience-lwc-design-generate` |
| `verify_aura_migration_completeness` | GA | `lwc-experts` | Migration completeness checklist and validation | N/A |
| `guide_lo_migration` | GA | `lwc-experts` | Lightning Out host page to Lightning Out 2.0 | N/A |
| `guide_lws_security` | GA | `lwc-experts` | Analysis against Lightning Web Security and product security guidelines | `experience-lwc-security-validate` |
| `create_aura_blueprint_draft` | GA | `aura-experts` | PRD blueprint for an Aura bundle being migrated | `experience-aura-lwc-migrate` |
| `enhance_aura_blueprint_draft` | GA | `aura-experts` | Expert analysis of a draft PRD, naming migration unknowns | `experience-aura-lwc-migrate` |
| `transition_prd_to_lwc` | GA | `aura-experts` | Migration guidance from Aura specification to LWC | `experience-aura-lwc-migrate` |
| `orchestrate_aura_migration` | GA | `aura-experts` | The full Aura-to-LWC migration workflow | `experience-aura-lwc-migrate` |
| `validate_and_optimize` | GA tool, developer-preview toolset | `experts-validation` | One-time analysis across Code Analyzer, accessibility, security, data and best-practice validators | N/A |
| `score_issues` | GA tool, developer-preview toolset | `experts-validation` | Readiness score 0-100 and a quality grade, weighted so security dominates | N/A |

The validation toolset is a developer preview: "Don't implement functionality in production with
these commands or tools." A readiness score is a second opinion, never a release gate - the gate is
`vf-check local` then `vf-check verify`, and a score of 100 changes nothing about that.

## 6. LWC skills catalogue (Agentforce Vibes)

Skills are invoked by describing the work in natural language; Agentforce Vibes routes to them.
Sources: `forcedotcom/afv-library`.

| Skill | Scope |
| --- | --- |
| `experience-lwc-generate` | Builds a component, or brings an existing one up to current practice: structure, `@api`, custom events, LMS, lifecycle, reactivity, templates, styling, `.js-meta.xml` |
| `experience-lwc-design-generate` | Component from a Figma design or PRD, through generation, optimisation, linting and testing |
| `experience-lwc-base-components-integrate` | Picks the right `lightning-*` base component, retrieves its API, wires it in |
| `experience-lwc-typescript-migrate` | JavaScript to TypeScript with a `.d.ts` exposing only the `@api` surface |
| `experience-lds-best-practices-apply` | UI API versus Apex, `refreshApex`, `notifyRecordUpdateAvailable`, `@salesforce/schema` imports |
| `experience-lds-graphql-generate` | Schema-validated GraphQL queries and mutations wired through `lightning/graphql` |
| `experience-lds-data-requirements-generate` | Natural-language data need to a specification with validated object and field API names |
| `experience-aura-lwc-migrate` | Aura bundle to LWC: analysis, PRD, enhancement, generation |
| `experience-lwc-test` | Jest specs and UTAM page objects, including wire adapter mocks, without regressing passing tests |
| `experience-lwc-runtime-observe` | Runs Live Preview for an app or single component and extracts the runtime DOM (see skill `sf-local-development`) |
| `experience-lwc-accessibility-validate` | WCAG 2.2 review of markup, JavaScript and CSS with remediation |
| `experience-lwc-rtl-validate` | RTL and i18n correctness: logical CSS properties, bidirectional text, RTL-aware SLDS usage |
| `experience-lwc-security-validate` | Lightning Web Security compliance, as a ranked finding list or a SARIF score report |

## 7. Where this sits relative to vibe-force

| Concern | Owned by |
| --- | --- |
| Generating or refactoring component code | MCP tools or skills, then the `sf-lwc-engineer` agent reviews the diff |
| Deciding whether the change is shippable | `vf-check local` (format, lint, analyzer, pairing, jest), then `vf-check verify` |
| Path ownership and wave sequencing | `scripts/lib/sf-paths.js` and skill `sf-workflow-orchestration` |
| Production deploys | Hooks in this plugin; `deploy-validate` then `deploy-quick` |
| Reviewing generated output for accuracy | You. The documentation states the output is nondeterministic and can be inaccurate |

Checklist before accepting generated component code:

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local --changed` is green - a generated
   bundle with no `__tests__` fails `pairing` exactly like a hand-written one.
2. Every `@salesforce/schema`, object and field API name in the output exists in the target org.
   Generated field names are the most common fabrication.
3. Wire adapter usage matches skill `sf-lwc-development` pattern 4, and error shape matches
   pattern 5, rather than an invented `error.message` access.
4. No `lightning/*` module that the documentation does not list; check against
   `references/component-reference.md`.
5. The API version in a generated `.js-meta.xml` matches `config/vibe-force.defaults.json`.
6. Nothing in the diff touches a path owned by another slice in the same wave.

## References

- [Use DX MCP Tools for LWC](https://developer.salesforce.com/docs/platform/lwc/guide/mcp-intro.md)
- [LWC MCP Tools Reference](https://developer.salesforce.com/docs/platform/lwc/guide/mcp-reference.md)
- [Use LWC Testing MCP Tools](https://developer.salesforce.com/docs/platform/lwc/guide/mcp-testing.md)
- [Use the Validation MCP Tools](https://developer.salesforce.com/docs/platform/lwc/guide/mcp-validate.md)
- [Use Skills for LWC Development](https://developer.salesforce.com/docs/platform/lwc/guide/afv-lwc-skills.md)
- [Salesforce DX MCP Server](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_mcp.htm)
- [Salesforce Skills Library](https://github.com/forcedotcom/afv-library/tree/main/skills)
