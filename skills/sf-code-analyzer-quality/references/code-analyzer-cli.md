# Code Analyzer CLI Reference

Complete flag, engine, and configuration tables for Salesforce Code Analyzer v5, plus output shapes
and the v4 migration map. Sources:
[Salesforce CLI Command Reference: code-analyzer commands](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_code-analyzer_commands_unified.htm),
[Use CLI Commands to Analyze Your Code](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/analyze.html),
[Top-Level Customization Reference](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/config-toplevel.html),
[PMD engine](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/engine-pmd.html),
[ESLint engine](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/engine-eslint.html),
[Graph Engine](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/engine-sfge.html),
[Suppress Violations](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/suppress-violations.html),
[Output Schemas](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/output-schemas.html).

## 1. The three commands

| Command | Purpose |
| --- | --- |
| `sf code-analyzer rules` | list the rules available to analyze your code |
| `sf code-analyzer run` | analyze code with a selection of rules |
| `sf code-analyzer config` | print the effective configuration state, optionally write it to YAML |

`sf code-analyzer ast-dump` prints the abstract syntax tree of a source file in XML or JSON for
Apex, Visualforce, HTML, XML, and JavaScript; use it when writing XPath-based PMD rules.

## 2. `sf code-analyzer run` flags

| Flag | Short | Type | Default | Notes |
| --- | --- | --- | --- | --- |
| `--workspace` | `-w` | option, repeatable | `.` | analysis context; files, folders, globs. Engines such as Graph Engine need the whole project here even when targeting a subset |
| `--target` | `-t` | option, repeatable | all workspace files | subset to analyze; each target must live inside the workspace |
| `--rule-selector` | `-r` | option, repeatable | `Recommended` | engine, tag, rule name, severity, or a combination |
| `--severity-threshold` | `-s` | option | none | fail with non-zero exit when a violation meets or exceeds this severity; number (`2`) or name (`"High"`) |
| `--view` | `-v` | option | `table` | `table` (concise) or `detail` (all locations, all fields) |
| `--output-file` | `-f` | option, repeatable | none | format inferred from extension: `.csv`, `.html`/`.htm`, `.json`, `.sarif`/`.sarif.json`, `.xml`; parent folder must exist; existing files are overwritten without prompting |
| `--config-file` | `-c` | option | `./code-analyzer.yml` or `./code-analyzer.yaml` if present | path to the configuration file |
| `--include-fixes` | | boolean | `false` | include fix data (code location plus replacement code) where engines provide it; increases analysis time |
| `--include-suggestions` | | boolean | `false` | include suggestion data (location plus message) |
| `--no-suppressions` | | boolean | `false` | ignore in-source suppression markers and config suppressions; a `suppressions.disable_suppressions` value in the config file takes precedence over this flag |
| `--flags-dir` | | option | none | import flag values from a directory |

Default behaviour with no flags: analyze the current folder, recommended rules across every
available engine, table view, auto-applying `code-analyzer.yml` from the current folder. Equivalent
to:

```bash
sf code-analyzer run --rule-selector Recommended --workspace . --target . --view table --config-file ./code-analyzer.yml
```

## 3. `sf code-analyzer rules` flags

| Flag | Short | Default | Notes |
| --- | --- | --- | --- |
| `--workspace` | `-w` | none | restricts the listing to rules that apply to the workspace's file types |
| `--target` | `-t` | none | restricts to a subset of workspace files |
| `--rule-selector` | `-r` | `Recommended` | same grammar as `run` |
| `--config-file` | `-c` | auto-discovered | applies rule and engine overrides before listing |
| `--output-file` | `-f` | none | `.json` or `.csv` only |
| `--view` | `-v` | `table` | `table` or `detail` |
| `--flags-dir` | | none | |

Table columns: rule name (unique within its engine, not necessarily across engines), engine, severity
(1 Critical, 2 High, 3 Moderate, 4 Low, 5 Info), and tags.

## 4. `sf code-analyzer config` flags

| Flag | Short | Default | Notes |
| --- | --- | --- | --- |
| `--workspace` | `-w` | none | show only configuration relevant to these files |
| `--target` | `-t` | none | subset of workspace |
| `--rule-selector` | `-r` | `all` | note the different default from `run` and `rules` |
| `--config-file` | `-c` | auto-discovered | existing config to load and merge |
| `--output-file` | `-f` | terminal | writes YAML; preserves values from the loaded config but overwrites comments; prompts before overwriting |
| `--include-unmodified-rules` | | `false` | include rules that are at their default values |
| `--no-suppressions` | | `false` | omit the `suppressions` field, making the output portable between workspaces |

## 5. Rule selector grammar

| Construct | Meaning | Example |
| --- | --- | --- |
| engine name | all rules of that engine | `--rule-selector pmd` (same as `pmd:all`) |
| tag | rules carrying the tag | `--rule-selector Security` |
| rule name | that rule in any engine | `--rule-selector no-inner-declarations` |
| `engine:rule` | one rule in one engine | `--rule-selector eslint:getter-return` |
| severity number | rules at that severity | `--rule-selector 2` |
| `:` | logical AND | `--rule-selector eslint:Recommended:problem:2` |
| `,` | logical OR | `--rule-selector Performance,Security` |
| `( )` | grouping; the whole value must be double-quoted | `--rule-selector "pmd:(Performance,Security):2"` |
| repeated flag | OR of selectors | `--rule-selector eslint:3 --rule-selector retire-js:Recommended` |

`Recommended` is the default selector. If you supply your own selector you must append
`:Recommended` explicitly to stay inside the recommended set; order and case of the components do
not matter (`recommended:eslint` works).

## 6. Engine matrix

| Engine | Languages / inputs | External dependency | Default state |
| --- | --- | --- | --- |
| `pmd` | Apex, Visualforce, HTML, JavaScript, XML | JDK 11+ | enabled |
| `cpd` | multiple, duplication detection | JDK 11+ | enabled (vibe-force disables it in the shared config) |
| `sfge` | Apex path analysis | JDK 11+ | enabled (Developer Preview) |
| `eslint` | JavaScript, TypeScript, LWC, Aura, CSS/SCSS, JSX | none beyond Node | enabled |
| `retire-js` | bundled JS libraries | none | enabled |
| `regex` | any text file | none | enabled |
| `flow` | Flow and subflow metadata | Python 3.10+ | enabled |

## 7. Top-level `code-analyzer.yml` schema

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `config_root` | string | parent folder of the config file, else cwd | base for relative paths in this file |
| `log_folder` | string | machine temp dir | where engine log files are written |
| `log_level` | number | `4` | `1` Error, `2` Warn, `3` Info, `4` Debug, `5` Fine |
| `rules` | object | `{}` | `rules.<engine>.<rule>.severity | tags | disabled` |
| `engines` | object | `{}` | `engines.<engine>.<property>` |
| `ignores` | object | `{"files": []}` | `ignores.files` is an array of glob patterns excluded from scanning |
| `suppressions` | object | `{"disable_suppressions": false}` | marker handling plus per-path bulk suppression rules |

If a file appears in both `target` and `ignores`, `ignores` wins and the file is not analyzed.

### 7.1 Rule override shape

```yaml
rules:
  eslint:
    sort-vars:
      severity: "Info"          # 1|2|3|4|5 or Critical|High|Moderate|Low|Info
      tags: ["Recommended", "Suggestion"]
  regex:
    NoTrailingWhiteSpace:
      disabled: true
```

### 7.2 Suppression shape

```yaml
suppressions:
  disable_suppressions: false
  "force-app/legacy/classes/":            # folder paths must end with /
    - rule_selector: "eslint:no-console,pmd:UnusedVariable"
      max_suppressed_violations: 5        # number, null for unlimited, 0 to disable suppression
      reason: "Legacy module, tracked by VF-214"
```

`rule_selector` supports a single rule, comma-separated rules, `engine:all`, severity lists
(`"1,2,3"`), or `all`. Once `max_suppressed_violations` is exhausted, further violations are reported
normally. Inner parentheses are allowed for severities only, not for rule names. Only text files are
scanned for markers. Suppression cannot be expressed with tags.

## 8. Engine configuration reference

### 8.1 `pmd`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `disable_engine` | boolean | `false` | |
| `java_command` | string | `null` | auto-discovered when null |
| `file_extensions` | object | `{"apex": [".cls", ".trigger"], "html": [".html", ".htm", ".xhtml", ".xht", ".shtml", ".cmp"], "javascript": [".js", ".cjs", ".mjs"], "typescript": [".ts"], "visualforce": [".page", ".component"], "xml": [".xml"]}` | one extension maps to exactly one language; add mdapi extensions such as `.object`, `.permissionset` under `xml` if the project is not in source format |
| `java_classpath_entries` | array | `[]` | JARs or folders holding Java-based custom rules |
| `custom_rulesets` | array | `[]` | XML ruleset files, absolute or relative to `config_root`, or a classpath resource |

PMD priority to Code Analyzer severity mapping for custom rules:

| PMD priority | Code Analyzer severity |
| --- | --- |
| 1 (High) | 2 (High) |
| 2 (Medium_High) | 3 (Moderate) |
| 3 (Medium) | 3 (Moderate) |
| 4 (Medium_Low) | 4 (Low) |
| 5 (Low) | 4 (Low) |

A default PMD rule that is not included in a custom ruleset file keeps its Code Analyzer default
severity, which can differ from the mapping.

### 8.2 `eslint`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `disable_engine` | boolean | `false` | |
| `eslint_config_file` | string | `null` | your main ESLint config; flat or legacy |
| `eslint_ignore_file` | string | `null` | legacy `.eslintignore`, ESLint 8 only |
| `auto_discover_eslint_config` | boolean | `false` | when true, Code Analyzer searches the workspace for ESLint configs |
| `disable_javascript_base_config` | boolean | `false` | base config adds `eslint:all` rules for JS files |
| `disable_lwc_base_config` | boolean | `false` | base config adds `@salesforce/eslint-config-lwc/recommended` and `plugin:@lwc/lwc-platform/recommended` |
| `disable_slds_base_config` | boolean | `false` | base config adds `plugin:@salesforce-ux/eslint-plugin-slds/recommended` |
| `disable_typescript_base_config` | boolean | `false` | base config adds `plugin:@typescript-eslint:all` |
| `disable_react_base_config` | boolean | `false` | base config adds `eslint-plugin-react` rules for `.jsx`/`.tsx` |
| `file_extensions` | object | `{"javascript": [".js", ".cjs", ".mjs", ".jsx"], "typescript": [".ts", ".tsx"], "html": [".html", ".htm", ".cmp"], "css": [".css", ".scss"], "other": []}` | |

Version selection: with no `code-analyzer.yml`, ESLint 9 is used and workspace ESLint configs are
ignored (`auto_discover_eslint_config` defaults to `false`). With `auto_discover_eslint_config: true`,
a legacy config (`.eslintrc.json`) selects ESLint 8, a flat config (`eslint.config.js`) selects
ESLint 9, a lone `.eslintignore` selects ESLint 8, and nothing found selects ESLint 9. Setting
`eslint_config_file` to a legacy file selects 8; to a flat file selects 9. Setting
`eslint_ignore_file` with `eslint_config_file: null` selects 8.

Merging: flat config objects from your file are appended to Code Analyzer's base objects. If both
reference the same plugin, the higher version wins. If merging fails, disable the relevant
`disable_*_base_config` and supply your own rules. Custom ESLint rules discovered this way are
tagged `Custom` and can be selected with `--rule-selector eslint:Custom`.

Code Analyzer automatically ignores LWC rules for `.jsx` and `.tsx` files. If plain `.js` files
contain React logic, disable the LWC base config to avoid false positives.

### 8.3 `sfge` (Salesforce Graph Engine)

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `disable_engine` | boolean | `false` | |
| `disable_limit_reached_violations` | boolean | `false` | when false, complex paths produce `LimitReached` violations instead of risking OutOfMemory |
| `java_command` | string | `null` | |
| `java_max_heap_size` | string | `null` | appended to `-Xmx`; multiple of 1024 and greater than 2MB; suffixes `k/K/kb/KB`, `m/M/mb/MB`, `g/G/gb/GB` |
| `java_thread_count` | number | `4` | more threads evaluate more paths in parallel |
| `java_thread_timeout` | number | `900000` | milliseconds before a thread produces a `Timeout` violation |

How it works: the Apex Jorje compiler produces a parse tree, Graph Engine converts it into vertices
in an Apache TinkerPop graph, builds code paths from each entry point, then walks each path applying
the selected rules with contextual data. Rules register interest in vertex types (a CRUD/FLS rule
registers interest in DML vertices).

Tuning for a large project:

```yaml
engines:
  sfge:
    java_max_heap_size: "6g"
    java_thread_count: 8
    java_thread_timeout: 1800000
```

If you still see `LimitReached` or `Timeout` violations, narrow `--target` to the changed classes
while keeping the full `--workspace`, or move the `sfge` selector out of the PR gate into a
pre-deploy run (`references/quality-gates-and-baselines.md`).

## 9. Output

Terminal output for every violation, regardless of engine: rule name, severity, engine, message,
location(s), and helpful resource URLs. `--view table` shows only the primary location;
`--view detail` shows all locations, which for `PathBased` rules form the path associated with the
violation.

File formats by extension: `.csv`, `.html`/`.htm`, `.json`, `.sarif`/`.sarif.json`, `.xml` for `run`;
`.json`, `.csv` for `rules`. Fixes and suggestions (`--include-fixes`, `--include-suggestions`) are
available in JSON, XML, and SARIF output.

`[unverified]` The precise JSON key names of the `run` output schema were not captured in this
session; the dedicated pages are
[Run Output Schemas](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/output-schemas-run.html)
and
[Rules Output Schemas](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/output-schemas-rules.html).
The documented terminal fields that the schema exposes are: rule name, engine, severity, message,
location(s) with file, start line and column, and resource URLs. The vibe-force check runner must not
depend on undocumented keys: generate one report with
`sf code-analyzer run --output-file sample.json` and map from the observed shape, keeping the mapping
in one place (`scripts/checks/`).

## 10. Violation triage loop

```bash
# 1. what exactly is failing, in full detail
sf code-analyzer run --workspace . --rule-selector Recommended --view detail \
  --output-file .vibeforce/reports/analyzer.json

# 2. understand the rule
sf code-analyzer rules --rule-selector pmd:ApexCRUDViolation --view detail

# 3. re-run just that rule against the file while fixing
sf code-analyzer run --workspace . --rule-selector pmd:ApexCRUDViolation \
  --target force-app/main/default/classes/ExpenseController.cls --view detail

# 4. confirm the gate passes
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" analyzer --changed
```

## 11. v4 to v5 migration map

| v4 (`sfdx-scanner`) | v5 (`code-analyzer`) |
| --- | --- |
| `sf scanner run --target /some/dir --engine cpd` | `sf code-analyzer run --workspace /some/dir --rule-selector cpd` |
| `sf scanner run --category Security,Performance` | `sf code-analyzer run --rule-selector Recommended:Security,Recommended:Performance` |
| `sf scanner run --engine pmd --category Security` | `sf code-analyzer run --rule-selector pmd:Security` |
| `sf scanner run --target somefile.js --outfile results.html` | `sf code-analyzer run --target somefile.js --output-file results.html` |
| `sf scanner run dfa --target ./p/classes/*.cls --projectdir ./p/` | `sf code-analyzer run --rule-selector sfge --target ./p/classes/*.cls --workspace ./p/` |
| `sf scanner run dfa --with-pilot --engine sfge` | pilot rules are selected by name or tag with `--rule-selector` |
| `sf scanner rule list` | `sf code-analyzer rules --rule-selector all` |
| `--severity-threshold 2` | unchanged on `run` |
| `sf plugins install @salesforce/sfdx-scanner` | `sf plugins install code-analyzer` |

The retired v4 command surface (`sf scanner run`, `sf scanner run dfa`, `--category`, `--engine`,
`--projectdir`, `--outfile`) must not appear in vibe-force scripts, commands, or documentation.

## 12. Editor and MCP surfaces

- VS Code: install the Code Analyzer extension plus the CLI plugin
  (`sf plugins install code-analyzer`); the extension reads the same `code-analyzer.yml`.
- Salesforce DX MCP server exposes `run_code_analyzer` with parameters `target` (up to 10 absolute
  file paths), `workingDirectory` (absolute project root), optional `selector`, and optional
  `configPath`. Useful when an agent runs inside an MCP-enabled host; the vibe-force check runner
  calls the CLI directly so behaviour is identical in CI.
