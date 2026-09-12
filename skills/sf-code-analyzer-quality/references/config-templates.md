# Configuration Templates

The configuration files the vibe-force quality gate expects, what each must contain, and why. The
files themselves are owned by the plugin's `config/` directory; this reference describes their
required content so any agent can review or regenerate them without guessing.

| Path | Consumed by | Purpose |
| --- | --- | --- |
| `config/code-analyzer.yml` | `sf code-analyzer run/rules/config --config-file` | engine selection, rule severities and tags, ignores, suppressions |
| `config/pmd/apex-ruleset.xml` | `engines.pmd.custom_rulesets` in `code-analyzer.yml` | project-specific PMD rules (XPath) |
| `config/eslint/eslint.config.mjs` | `npx eslint --config`, and `engines.eslint.eslint_config_file` | LWC/Aura JavaScript linting |
| `config/prettier/.prettierrc` | `npx prettier --config` | formatting for Apex, LWC, XML, JSON |
| `config/prettier/.prettierignore` | `npx prettier --ignore-path` | paths Prettier must not touch |
| `config/vibe-force.defaults.json` | check runner and hooks | `apiVersion`, gates, hook modes |

Do not create these files from this skill: `ChecksAuthor` owns `config/`. Reference them by path.

## 1. `config/code-analyzer.yml`

Required content, in this order (top-level keys per the
[Top-Level Customization Reference](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/config-toplevel.html)):

```yaml
# vibe-force shared Code Analyzer configuration.
# Paths are relative to config_root, which defaults to this file's folder.
config_root: null
log_folder: null
log_level: 3          # Info; raise to 4 (Debug) or 5 (Fine) when diagnosing engine failures

engines:
  pmd:
    disable_engine: false
    custom_rulesets:
      - "pmd/apex-ruleset.xml"
    # Uncomment when the consumer project uses mdapi format instead of source format:
    # file_extensions:
    #   xml: [".xml", ".object", ".permissionset", ".layout", ".flow"]
  eslint:
    disable_engine: false
    eslint_config_file: "eslint/eslint.config.mjs"
    auto_discover_eslint_config: false
    disable_javascript_base_config: false
    disable_lwc_base_config: false
    disable_slds_base_config: false
    disable_typescript_base_config: true    # no TypeScript in a standard SFDX project
    disable_react_base_config: true         # no JSX in a standard SFDX project
  regex:
    disable_engine: false
  retire-js:
    disable_engine: false
  flow:
    disable_engine: false                   # requires Python 3.10+; set true in lean CI images
  cpd:
    disable_engine: true                    # duplication is reviewed, not gated
  sfge:
    disable_engine: false
    java_max_heap_size: "4g"
    java_thread_count: 4
    java_thread_timeout: 900000

rules:
  pmd:
    ApexSOQLInjection:       { severity: "Critical" }
    ApexSuggestUsingNamedCred: { severity: "Critical" }
    ApexBadCrypto:           { severity: "Critical" }
    ApexCSRF:                { severity: "Critical" }
    ApexCRUDViolation:       { severity: "High" }
    ApexSharingViolations:   { severity: "High" }
    OperationWithLimitsInLoop: { severity: "Critical" }
    AvoidHardcodingId:       { severity: "High" }
    ApexUnitTestShouldNotUseSeeAllDataTrue: { severity: "High" }
    ApexDoc:                 { severity: "Info" }
    ClassNamingConventions:  { severity: "Low" }
  eslint:
    "@lwc/lwc/no-inner-html": { severity: "Critical" }
    "@lwc/lwc/no-async-operation": { severity: "High" }
  sfge:
    ApexFlsViolation:        { severity: "High" }
    DatabaseOperationsMustUseWithSharing: { severity: "High" }

ignores:
  files:
    - "**/node_modules/**"
    - "**/.sfdx/**"
    - "**/.vibeforce/**"
    - "**/staticresources/**/*.min.js"
    - "**/jsconfig.json"

suppressions:
  disable_suppressions: false
  # Per-path entries are added by PRs with an owner, a cap, and a ticket reference:
  # "force-app/legacy/classes/":
  #   - rule_selector: "pmd:ApexCRUDViolation"
  #     max_suppressed_violations: 40
  #     reason: "Legacy module; VF-214 migrates it to user mode."
```

Rules for maintaining this file:

- Severity overrides only; never delete a rule from the recommended set by omission.
- `disabled: true` requires a comment naming the reason; prefer a scoped suppression instead.
- Every `suppressions` entry needs `max_suppressed_violations` and `reason`.
- Regenerate a skeleton after a plugin upgrade with
  `sf code-analyzer config --config-file config/code-analyzer.yml --output-file /tmp/ca.yml
  --include-unmodified-rules` and diff: new rules appear there first.
- Verify after any edit:
  `sf code-analyzer rules --config-file config/code-analyzer.yml --workspace . --view table`.

## 2. `config/pmd/apex-ruleset.xml`

Only project-specific rules belong here; the bundled PMD Apex rules are already available through
the `pmd` engine. Structure per the
[PMD ruleset documentation](https://docs.pmd-code.org/latest/pmd_userdocs_making_rulesets.html):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ruleset name="VibeForce Apex Rules"
         xmlns="http://pmd.sourceforge.net/ruleset/2.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://pmd.sourceforge.net/ruleset/2.0.0 https://pmd.sourceforge.io/ruleset_2_0_0.xsd">

    <description>Project conventions enforced on Apex in addition to the bundled PMD rules.</description>

    <rule name="TriggerMustDelegateToHandler"
          language="apex"
          message="A trigger body must contain only a single handler delegation call."
          class="net.sourceforge.pmd.lang.rule.XPathRule">
        <priority>2</priority>
        <properties>
            <property name="xpath">
                <value><![CDATA[
//UserTrigger[count(BlockStatement/*) > 1]
                ]]></value>
            </property>
        </properties>
    </rule>

</ruleset>
```

Notes:

- Code Analyzer adds the `Custom` tag to every custom rule, plus a tag equal to the `<ruleset>`
  `name` attribute with spaces removed (here `VibeForceApexRules`), so the whole file can be selected
  with `--rule-selector pmd:VibeForceApexRules`.
- Rule name in selectors is the `<rule>` `name` attribute.
- `<priority>` maps to Code Analyzer severity: 1 -> 2, 2 -> 3, 3 -> 3, 4 -> 4, 5 -> 4. Override the
  resulting severity in `code-analyzer.yml` if you need Critical.
- Derive XPath expressions from a real AST rather than guessing:
  `sf code-analyzer ast-dump` on a representative `.cls` or `.trigger`.
- Java-based rules require the JAR in `engines.pmd.java_classpath_entries`; XPath rules do not.
- `[unverified]` The exact XPath node names for Apex (`UserTrigger`, `BlockStatement`) vary by PMD
  version; confirm against the `ast-dump` output for the bundled PMD before committing a rule.
- Validate registration with `sf code-analyzer rules --rule-selector pmd:Custom --view detail`.

## 3. `config/eslint/eslint.config.mjs`

Flat config (ESLint 9), because `@salesforce/eslint-config-lwc` 4.x and
`@lwc/eslint-plugin-lwc` 3.x support ESLint 9 only.

```javascript
import lwcConfig from '@salesforce/eslint-config-lwc';
import jestPlugin from 'eslint-plugin-jest';

export default [
    // LWC recommended: LWC rules + JS possible-error rules + best practices
    ...lwcConfig.configs.recommended,

    {
        files: ['**/lwc/**/*.js', '**/aura/**/*.js'],
        rules: {
            '@lwc/lwc/no-inner-html': 'error',
            '@lwc/lwc/no-document-query': 'error',
            '@lwc/lwc/no-async-operation': 'error',
            '@lwc/lwc/no-leaky-event-listeners': 'error',
            '@lwc/lwc/prefer-custom-event': 'error',
            'no-console': ['error', { allow: ['error'] }]
        }
    },

    {
        files: ['**/__tests__/**/*.js'],
        plugins: { jest: jestPlugin },
        languageOptions: {
            globals: { ...jestPlugin.environments.globals.globals }
        },
        rules: {
            'no-console': 'off',
            'jest/no-focused-tests': 'error',
            'jest/no-disabled-tests': 'warn',
            'jest/expect-expect': 'error'
        }
    },

    {
        ignores: [
            '**/node_modules/**',
            '**/.sfdx/**',
            '**/.vibeforce/**',
            '**/staticresources/**'
        ]
    }
];
```

Notes:

- `@salesforce/eslint-config-lwc` exports config **arrays**; apply them with the spread operator.
- Peer dependencies that must be installed: `@lwc/eslint-plugin-lwc`,
  `@salesforce/eslint-plugin-lightning`, `eslint-plugin-import`, `eslint-plugin-jest`.
- Parser: the shared config supplies `@babel/eslint-parser` with the class-properties and decorators
  Babel plugins, which LWC syntax requires. Do not override `languageOptions.parser` unless you
  reproduce that setup.
- Flat config has no `.eslintignore`; ignores live in the config array.
- Code Analyzer's `eslint` engine appends this file to its own base configuration when
  `eslint_config_file` points at it; if a plugin-version conflict surfaces, set the matching
  `disable_*_base_config` rather than removing rules here.
- `[unverified]` The exact export name for Jest globals in `eslint-plugin-jest`'s flat-config surface
  (`environments.globals.globals`) was not confirmed this session; if ESLint reports undefined
  globals in test files, take the form from the plugin's current README.

## 4. `config/prettier/.prettierrc`

```json
{
  "printWidth": 120,
  "tabWidth": 4,
  "useTabs": false,
  "singleQuote": true,
  "trailingComma": "none",
  "bracketSpacing": true,
  "plugins": ["prettier-plugin-apex", "@prettier/plugin-xml"],
  "overrides": [
    {
      "files": ["**/lwc/**/*.html", "**/aura/**/*.cmp", "**/aura/**/*.app"],
      "options": { "parser": "html" }
    },
    {
      "files": "*.{cls,trigger}",
      "options": { "parser": "apex", "printWidth": 120, "tabWidth": 4 }
    },
    {
      "files": "*.{cmp,page,component}",
      "options": { "parser": "html" }
    },
    {
      "files": "**/*-meta.xml",
      "options": { "parser": "xml", "xmlWhitespaceSensitivity": "ignore" }
    }
  ]
}
```

Apex-specific options that `prettier-plugin-apex` adds (defaults in parentheses):

| Option | Default | Meaning |
| --- | --- | --- |
| `apexInsertFinalNewline` | `true` | append a trailing newline |
| `apexStandaloneParser` | `native` | `native` uses the prebuilt native parser with a Java CLI fallback, `built-in` uses the long-lived HTTP parser server, `none` invokes the Java CLI per file |
| `apexStandalonePort` | `2117` | port for the `built-in` parser server |
| `apexStandaloneHost` | `localhost` | host for the `built-in` parser server |
| `apexStandaloneProtocol` | `http` | protocol for the `built-in` parser server |
| `printWidth`, `tabWidth`, `useTabs`, `requirePragma`, `insertPragma` | Prettier defaults | standard Prettier semantics |

Caveats:

- Requirements: Node 22 or later; a JRE 17 or later is needed only on platforms without a prebuilt
  native executable (prebuilt: Windows x64, Linux x64, macOS ARM64, macOS x64).
- Anonymous Apex needs the `apex-anonymous` parser; keep such files in one folder and target them
  separately, otherwise every `.cls` in the glob is treated as anonymous.
- First run on a legacy codebase: `prettier --debug-check` before `--write`, so a formatting change
  cannot alter behaviour unnoticed.
- `// prettier-ignore` or `/* prettier-ignore */` on the preceding line preserves hand-aligned code.
- `[unverified]` `@prettier/plugin-xml` is not a Salesforce-maintained plugin and was not verified in
  this session; if it is not installed, drop the XML override and let the analyzer's PMD XML rules
  handle metadata files, and remove `**/*-meta.xml` from the format glob.

## 5. `config/prettier/.prettierignore`

```text
# generated and vendored
**/node_modules/**
**/.sfdx/**
**/.localdevserver/**
**/.vibeforce/**

# binary or vendor-managed content
**/staticresources/**
**/documents/**
**/*.min.js
**/*.png
**/*.jpg
**/*.svg

# Salesforce artifacts Prettier must not rewrite
**/package.xml
**/destructiveChanges*.xml
**/*.profile-meta.xml
**/*.permissionset-meta.xml
```

Rationale for the last block: profile and permission set files are generated by retrieval with
element ordering the platform chooses. Reformatting them creates enormous, meaningless diffs and
raises the chance of a bad merge on the files that control access.

## 6. Verifying the whole configuration set

```bash
# analyzer configuration resolves and selects the expected rules
sf code-analyzer config --config-file config/code-analyzer.yml --rule-selector Recommended
sf code-analyzer rules --config-file config/code-analyzer.yml --workspace . --view table

# custom PMD rules are registered
sf code-analyzer rules --config-file config/code-analyzer.yml --rule-selector pmd:Custom --view detail

# eslint config loads and reports on a known-bad fixture
npx eslint --config config/eslint/eslint.config.mjs force-app/main/default/lwc/**/*.js

# prettier config loads and is idempotent
npx prettier --check --config config/prettier/.prettierrc \
  --ignore-path config/prettier/.prettierignore "force-app/**/*.{cls,trigger,js,html}"

# all three through the vibe-force entry point
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" static --changed
```

A configuration PR is proven when: `rules` output shows the intended severities, a seeded violation
makes `vf-check analyzer` exit `1`, removing the seed makes it exit `0`, and
`vf-check format --fix` followed by `vf-check format` is clean (idempotent formatting).
