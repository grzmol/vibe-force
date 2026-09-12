# Authorization and CI for Salesforce CLI v2

Two authorization flows work without a human: the **JWT bearer flow** (`sf org login jwt`) and the
**SFDX auth URL** flow (`sf org login sfdx-url`). Web login (`sf org login web`) always needs a
browser and a callback on `http://localhost:1717/OauthRedirect`.

| Flow | Secret to store in CI | Refresh behaviour | Use when |
| --- | --- | --- | --- |
| `org login jwt` | private key (`server.key`) + consumer key + username | No refresh token needed; a new JWT assertion is signed per login | Long-lived pipelines, production and UAT orgs, Dev Hub |
| `org login sfdx-url` | one auth URL (contains client id, client secret, refresh token, instance URL) | Uses the stored refresh token; dies when the token expires or is revoked | Bootstrapping, short-lived jobs, developer sandboxes |
| `org login access-token` | access token + instance URL | None; token expires with the session | Ephemeral one-command runs |
| `org login web` | — | Refresh token in the local auth file | Workstations only |

## 1. Create the key pair

`sf org login jwt` needs a private key whose certificate is uploaded to the app in the org. Use a
CA-issued certificate for anything beyond a first experiment; the self-signed path is documented only
to get started.

```bash
mkdir -p ~/JWT && cd ~/JWT

# Private key, passphrase-protected, then stripped of the passphrase for CLI use.
openssl genpkey -aes-256-cbc -algorithm RSA -pass pass:SomePassword \
  -out server.pass.key -pkeyopt rsa_keygen_bits:2048
openssl rsa -passin pass:SomePassword -in server.pass.key -out server.key

# Certificate signing request, then a self-signed certificate valid for a year.
openssl req -new -key server.key -out server.csr
openssl x509 -req -sha256 -days 365 -in server.csr -signkey server.key -out server.crt
```

Outputs: `server.key` (feed to `--jwt-key-file`), `server.crt` (upload to the app). Never commit
either; delete `server.key` from any machine that only needed it once (`rm server.key`).

## 2. Create the app in the org

| Org role | App type to create |
| --- | --- |
| Any org that only needs deploy/retrieve/test/data access | External Client App |
| Dev Hub that must run `sf org create scratch` or `sf org create sandbox` | Connected App (external client apps are not supported for those commands) |

External Client App, Setup → App Manager → **New External Client App**:

| Step | Setting |
| --- | --- |
| API (Enable OAuth Settings) | Enable OAuth |
| Callback URL | `http://localhost:1717/OauthRedirect` (change the port and set `oauthLocalPort` in `sfdx-project.json` if 1717 is taken) |
| OAuth scopes | `api` (Manage user data via APIs), `web` (Manage user data via Web browsers), `refresh_token, offline_access` (Perform requests at any time) |
| Flow Enablement | Enable JWT Bearer Flow (required for JWT) |
| Digital certificate | Upload `server.crt` (required for JWT) |
| Policies → OAuth Policies → Plugin Policies | Permitted Users = **Admin approved users are pre-authorized** |
| Policies → App Policies | Pre-authorize the profiles and/or permission sets of the integration user |
| Policies → App Authorization → OAuth Policies | Expire refresh token after **90 days** or fewer |

The default `Salesforce CLI` connected app that `sf org login web` creates has non-expiring refresh
and access tokens. Harden it: Setup → **Connected Apps OAuth Usage** → select `Salesforce CLI` →
Install → Edit Policies → Refresh Token Policy = expire after ≤ 90 days, Session Policies Timeout
Value = 15 minutes. After expiry, commands fail with:

```
ERROR running org open: Error authenticating with the refresh token due to: expired access/refresh token
```

`sf org list` then shows the expired state in the `CONNECTED STATUS` column; reauthorize with
`sf org login web` or `sf org login jwt`.

## 3. Log in from a pipeline

```bash
# JWT, with the My Domain URL (immune to instance migrations).
sf org login jwt \
  --client-id "$SF_CONSUMER_KEY" \
  --jwt-key-file "$SF_KEY_FILE" \
  --username "$SF_USERNAME" \
  --instance-url "https://mydomain.my.salesforce.com" \
  --alias vf-uat --set-default

# Sandbox: use the sandbox My Domain form.
#   https://MyDomainName--SandboxName.sandbox.my.salesforce.com
# Dev Hub: add --set-default-dev-hub instead of --set-default.
```

Order of preference for the instance URL: `--instance-url` flag, then `sfdcLoginUrl` in
`sfdx-project.json`, then `https://login.salesforce.com`. Use the `my.salesforce.com` form, never the
`lightning.force.com` URL.

### Authorize a scratch org with the Dev Hub's key

A CI job that creates a scratch org and does not have the org's access token can reuse the Dev Hub's
consumer key and private key:

```bash
sf data query --target-org vf-hub --json \
  --query "SELECT SignupUsername, LoginUrl FROM ScratchOrgInfo WHERE SignupUsername='test-wvkpnfm5z113@example.com'" \
  | jq -r '.result.records[0].LoginUrl'

sf org login jwt \
  --client-id "$SF_CONSUMER_KEY" \
  --jwt-key-file "$SF_KEY_FILE" \
  --username test-wvkpnfm5z113@example.com \
  --instance-url https://energy-enterprise-2539-dev-ed.scratch.my.salesforce.com \
  --alias vf-scratch
```

A "user isn't approved" error right after creation means the scratch-org record has not replicated
yet — wait and retry. On Hyperforce, a non-admin scratch-org user cannot reuse the Dev Hub
certificate; run the standard JWT setup for that user instead.

### SFDX auth URL flow

```bash
# On a workstation that already authorized the org:
sf org auth show-sfdx-auth-url --target-org vf-int --no-prompt --json > authFile.json
# authFile.json => { "status": 0, "result": { "sfdxAuthUrl": "force://<clientId>:<clientSecret>:<refreshToken>@<instance>" } }

# In CI:
sf org login sfdx-url --sfdx-url-file authFile.json --alias vf-int --set-default
# or without touching disk:
printf '%s' "$SFDX_AUTH_URL" | sf org login sfdx-url --sfdx-url-stdin --alias vf-int --set-default
```

`sf org display --verbose --json` also exposes `sfdxAuthUrl`. Treat the URL exactly like a password:
it grants full API access with the authorizing user's permissions.

## 4. Environment hardening for CI images

```bash
export SF_USE_GENERIC_UNIX_KEYCHAIN=true   # no OS keychain in containers
export SF_DISABLE_TELEMETRY=true
export SF_DISABLE_AUTOUPDATE=true          # pin the CLI version in the image instead
export SF_LOG_LEVEL=warn
export SF_JSON_TO_STDOUT=true              # error JSON on stdout so `| jq` sees it
export SF_SKIP_SCRATCH_ORG_CHECK=true      # skip the post-login scratch/sandbox identification query
export SF_ORG_MAX_QUERY_LIMIT=50000        # only if a check legitimately needs > 10,000 rows
```

`SF_SKIP_SCRATCH_ORG_CHECK` removes the cached-org lookup that `sf org login *` performs to classify
the new authorization; on runners with many cached authorizations it is a measurable speed-up.

## 5. Pipeline snippets

### GitHub Actions (JWT)

```yaml
name: vf-gate
on: [pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
    env:
      SF_USE_GENERIC_UNIX_KEYCHAIN: true
      SF_DISABLE_TELEMETRY: true
      SF_DISABLE_AUTOUPDATE: true
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }          # vf-check --changed needs the merge base
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install --global @salesforce/cli@2
      - run: sf plugins install @salesforce/plugin-code-analyzer
      - name: Write JWT key
        run: |
          printf '%s' "${{ secrets.SF_JWT_KEY }}" > server.key
          chmod 600 server.key
      - name: Authorize
        run: |
          sf org login jwt \
            --client-id "${{ secrets.SF_CONSUMER_KEY }}" \
            --jwt-key-file server.key \
            --username "${{ secrets.SF_USERNAME }}" \
            --instance-url "${{ secrets.SF_INSTANCE_URL }}" \
            --alias vf-int
      - run: node "$VF_ROOT/scripts/checks/vf-check.mjs" local --changed
      - run: node "$VF_ROOT/scripts/checks/vf-check.mjs" deploy-validate --target-org vf-int
      - if: always()
        run: rm -f server.key
      - if: always()
        uses: actions/upload-artifact@v4
        with: { name: vf-reports, path: .vibeforce/reports }
```

### Jenkins declarative (auth URL in credentials)

```groovy
pipeline {
  agent any
  environment {
    SF_USE_GENERIC_UNIX_KEYCHAIN = 'true'
    SF_DISABLE_TELEMETRY = 'true'
  }
  stages {
    stage('Authorize') {
      steps {
        withCredentials([string(credentialsId: 'sfdx-auth-url-int', variable: 'SFDX_AUTH_URL')]) {
          sh 'printf "%s" "$SFDX_AUTH_URL" | sf org login sfdx-url --sfdx-url-stdin --alias vf-int'
        }
      }
    }
    stage('Local gate') { steps { sh 'node "$VF_ROOT/scripts/checks/vf-check.mjs" local' } }
    stage('Validate')   { steps { sh 'node "$VF_ROOT/scripts/checks/vf-check.mjs" deploy-validate --target-org vf-int' } }
    stage('Quick deploy') {
      when { branch 'main' }
      steps { sh 'node "$VF_ROOT/scripts/checks/vf-check.mjs" deploy-quick --target-org vf-int' }
    }
  }
  post { always { archiveArtifacts artifacts: '.vibeforce/reports/*.json', allowEmptyArchive: true } }
}
```

### CircleCI (encrypted key file, the flow the DX guide documents)

```bash
# One-time, locally, in the directory containing server.key:
openssl enc -aes-256-cbc -k <passphrase> -P -md sha1 -nosalt
# => key=...  iv=...    (store both as protected CircleCI env vars DECRYPTION_KEY / DECRYPTION_IV)

openssl enc -nosalt -aes-256-cbc -in server.key -out server.key.enc -base64 \
  -K "$DECRYPTION_KEY" -iv "$DECRYPTION_IV"
rm server.key          # never keep the plaintext key in the repo or on the box
```

```bash
# In the CircleCI job:
openssl enc -nosalt -aes-256-cbc -d -in assets/server.key.enc -out server.key -base64 \
  -K "$DECRYPTION_KEY" -iv "$DECRYPTION_IV"
sf org login jwt --client-id "$HUB_CONSUMER_KEY" --jwt-key-file server.key \
  --username "$HUB_SFDX_USER" --set-default-dev-hub --alias vf-hub
```

Generate a fresh key/iv pair per secret; reusing a pair for anything other than `server.key` is a
security violation, and the pair cannot be regenerated — losing it means re-encrypting.

## 6. Local credential storage

| Path | Content | Rule |
| --- | --- | --- |
| `~/.sf/` | CLI internal state, auth files, `sf-<date>.log` | Never edit or hand-copy; treat as secret material |
| `~/.sfdx/key.json` | encryption key when `SF_USE_GENERIC_UNIX_KEYCHAIN` is set (always on Windows) | Back up before touching crypto settings |
| macOS Keychain / Linux libsecret | encryption key when the generic keychain is not used | Headless runs must set `SF_USE_GENERIC_UNIX_KEYCHAIN=true` |
| `<project>/.sf/config.json` | project-local config variables (`target-org`, `org-api-version`) | Commit only if the whole team shares the alias; usually gitignored |

Auth files use 128-bit encryption by default. 256-bit (v2 crypto) is opt-in: back up the `sfdx` key,
rename `~/.sfdx`, `export SF_CRYPTO_V2=true`, re-login, confirm `sf doctor` reports
`CLI using stable v2 crypto`, then unset the variable. All shipped plugins support it; user-installed
plugins must use `@salesforce/core` 6.7.0 or later, which `sf doctor`'s
`[@salesforce/plugin-auth] CLI supports v2 crypto` test verifies.

## 7. Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `expired access/refresh token` | Refresh token policy elapsed or the user revoked the app | Re-run `sf org login jwt`/`web`; for JWT no refresh token is involved, so the error points at a revoked/blocked user |
| `user hasn't approved this consumer` | App not pre-authorized for the user's profile/permission set | Set Permitted Users = Admin approved users are pre-authorized, then add the profile or permission set |
| `invalid_grant: invalid assertion` | Wrong `aud` (login vs test), clock skew, or the certificate in the org does not match `server.key` | Match `--instance-url` to the org type, or set `SF_AUDIENCE_URL`; re-upload the cert |
| JWT login hangs waiting for identity verification | Org enforces high-assurance (stepped-up) authentication | JWT/headless auth is not possible for that org; use a different integration user or org policy |
| Login works locally, fails in CI with a keychain/secret-service error | No OS keychain in the runner | `export SF_USE_GENERIC_UNIX_KEYCHAIN=true` |
| `sf org auth show-access-token` never returns in CI | Waiting on the interactive confirmation | Add `--no-prompt` or `--json` |
| `npm ERR! code EEXIST ... bin/sfdx` | `sfdx-cli` (v7) still installed | `npm uninstall sfdx-cli --global`, then `npm install @salesforce/cli --global` |
| Commands silently target the wrong org | `target-org` config or `SF_TARGET_ORG` left over from a previous step | Pass `--target-org` on every command; `sf config list` to inspect |
| `sf org create scratch` fails against a JWT-authorized Dev Hub | Dev Hub was authorized through an external client app | Recreate as a connected app and reauthorize |

## Sources

- Salesforce DX Developer Guide, Authorization: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth.htm>
- Authorize an Org Using the JWT Flow: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth_jwt_flow.htm>
- Create a Private Key and Self-Signed Digital Certificate: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth_key_and_cert.htm>
- Use the Default Connected App Securely: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth_default_conn_app.htm>
- Authorize an Org Using Its SFDX Authorization URL: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth_url.htm>
- Continuous Integration (CircleCI/Jenkins): <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ci.htm>
- Salesforce CLI Setup Guide, encryption and keychain: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_setup.meta/sfdx_setup/sfdx_setup_intro.htm>
- `sf org login jwt` / `sfdx-url` / `web` reference: <https://github.com/salesforcecli/plugin-auth/blob/main/README.md>
