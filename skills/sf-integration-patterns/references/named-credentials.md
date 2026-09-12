# Named Credentials and External Credentials

Two-tier model (Winter '23 and later). Legacy single-object named credentials are deprecated and
will be discontinued; do not author new ones.

| Layer | Metadata type | Responsibility |
| --- | --- | --- |
| Named credential | `NamedCredential` | Endpoint URL, transport (secured or private), callout options, list of external credentials |
| External credential | `ExternalCredential` | Authentication protocol, protocol parameters, principals, custom headers |
| Principal | part of `ExternalCredential` | Named principal (shared service account) or per-user principal; mapped to permission sets |
| Token store | `UserExternalCredential` | Encrypted tokens. Not readable from SOQL, Apex, or the APIs; deletable only via the Connect API |

Source: https://developer.salesforce.com/docs/platform/named-credentials/guide/get-started.html and
https://developer.salesforce.com/docs/platform/named-credentials/references/named-credentials-reference/nc-glossary.html

## Named credential types

| Type | Meaning |
| --- | --- |
| `SecuredEndpoint` | Endpoint reached over TLS on the public internet |
| `PrivateEndpoint` | Traffic routed through Private Connect, bypassing the public internet |
| `Legacy` | Deprecated single-object form (endpoint + auth in one definition) |

## Authentication protocol matrix

Values verified from `ConnectApi.CredentialAuthenticationProtocol` usage and the named-credentials
guide. Mark of `[unverified]` means the enum spelling in metadata XML was not confirmed this session.

| Protocol | Use when | Secrets that must be populated after deploy | Notes |
| --- | --- | --- | --- |
| `NoAuthentication` | Public API, or auth entirely in custom headers | none | Still set `generateAuthorizationHeader` false if you build the header yourself |
| `Basic` | Legacy endpoint with username/password | Username, Password on the principal | Build the header with `BASE64ENCODE(BLOB(...))` formula if the endpoint needs a non-standard shape |
| `OAuth 2.0` - Browser Flow | User-delegated access | Auth provider assignment in the subscriber org, then per-user token via "Allow" flow | Needs an `ExternalAuthIdentityProvider`; packageable, but the auth provider must be created in each org |
| `OAuth 2.0` - JWT Bearer Flow | Server-to-server with a signing certificate | Signing certificate created in the target org, then assigned | JWT claims editable in the credential; see claims table |
| `OAuth 2.0` - Client Credentials with Client Secret | Server-to-server, simple | Client Id, Client Secret | Populate via Connect API POST after package install |
| `OAuth 2.0` - Client Credentials with JWT Assertion | Server-to-server, certificate-bound client | Signing certificate + Client Id | Two Connect API calls (PUT certificate, POST client id) |
| `AWS Signature v4` | AWS service endpoints | Access key, secret key (+ region, service) | STS variant uses a long-term access key/secret and an STS principal type |
| `Custom` | Everything else - headers assembled from principal parameters | Principal authentication parameters | Used by the Apex Recipes sample credential |

Certificates and access tokens are never packageable. After installing or deploying, populate them
through Setup or the Connect REST API - see
https://developer.salesforce.com/docs/platform/named-credentials/guide/nc-populate-external-credentials.html

## OAuth 2.0 bearer flow JWT claims

Source: https://developer.salesforce.com/docs/platform/named-credentials/references/named-credentials-reference/jwt-claims.html
(does not apply to legacy named credentials)

| Claim | Meaning | Editable |
| --- | --- | --- |
| `alg` | Signing algorithm; default RS256 | No |
| `typ` | Always `JWT` | No |
| `iss` | Issuer | Yes, via the JWT Claims panel |
| `sub` | Subject; a string for named principal, a formula for per-user | Yes |
| `aud` | Intended recipient | Yes |
| `exp` | Expiry (NumericDate); defaults to 2 minutes in the future | Set via the Expiration field |
| `iat` | Issued-at (NumericDate) | No |
| `nbf` | Not-before (NumericDate) | No |

## Metadata layout

Directory names and file suffixes verified from the Salesforce metadata registry
(`forcedotcom/source-deploy-retrieve`, `src/registry/metadataRegistry.json`):

| Metadata type | Directory | Suffix | Available since |
| --- | --- | --- | --- |
| `NamedCredential` | `namedCredentials/` | `.namedCredential-meta.xml` | Metadata API 33.0 |
| `ExternalCredential` | `externalCredentials/` | `.externalCredential-meta.xml` | Metadata API 56.0 |
| `ExternalServiceRegistration` | `externalServiceRegistrations/` | `.externalServiceRegistration-meta.xml` | - |
| `PlatformEventChannel` | `platformEventChannels/` | `.platformEventChannel-meta.xml` | - |
| `PlatformEventChannelMember` | `platformEventChannelMembers/` | `.platformEventChannelMember-meta.xml` | - |
| `PlatformEventSubscriberConfig` | `PlatformEventSubscriberConfigs/` | `.platformEventSubscriberConfig-meta.xml` | - |

### Legacy named credential (verified shape, do not author new ones)

From the official Apex Recipes sample app
(`trailheadapps/apex-recipes`, `force-app/main/default/namedCredentials/GoogleBooksAPI.namedCredential-meta.xml`):

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<NamedCredential xmlns="http://soap.sforce.com/2006/04/metadata">
    <allowMergeFieldsInBody>false</allowMergeFieldsInBody>
    <allowMergeFieldsInHeader>false</allowMergeFieldsInHeader>
    <calloutStatus>Enabled</calloutStatus>
    <endpoint>https://www.googleapis.com/books/v1/</endpoint>
    <generateAuthorizationHeader>true</generateAuthorizationHeader>
    <label>GoogleBooksAPI</label>
    <principalType>Anonymous</principalType>
    <protocol>NoAuthentication</protocol>
</NamedCredential>
```

### Two-tier named credential + external credential

Field semantics are verified from the Connect API inputs used by
`trailheadapps/apex-recipes` `NamedCredentialRecipes.cls`
(`developerName`, `masterLabel`, `type`, `calloutUrl`, `externalCredentials`,
`calloutOptions.allowMergeFieldsInBody|allowMergeFieldsInHeader|generateAuthorizationHeader`,
`ExternalCredentialInput.authenticationProtocol`, `principals[].principalName|principalType|sequenceNumber`).
The exact XML element names below `[unverified]` - retrieve the real shape from an org that already
has the credential configured before committing:

```bash
sf project retrieve start \
  --metadata ExternalCredential:Billing_API_Auth NamedCredential:Billing_API \
  --target-org vf-dev
```

```xml
<!-- externalCredentials/Billing_API_Auth.externalCredential-meta.xml  [unverified element names] -->
<?xml version="1.0" encoding="UTF-8" ?>
<ExternalCredential xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Billing API Auth</label>
    <authenticationProtocol>OAuth</authenticationProtocol>
    <principals>
        <principalName>Billing Integration</principalName>
        <principalType>NamedPrincipal</principalType>
        <sequenceNumber>1</sequenceNumber>
    </principals>
</ExternalCredential>
```

```xml
<!-- namedCredentials/Billing_API.namedCredential-meta.xml  [unverified element names] -->
<?xml version="1.0" encoding="UTF-8" ?>
<NamedCredential xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Billing API</label>
    <namedCredentialType>SecuredEndpoint</namedCredentialType>
    <endpoint>https://billing.example.com</endpoint>
    <calloutStatus>Enabled</calloutStatus>
    <externalCredentials>
        <externalCredential>Billing_API_Auth</externalCredential>
    </externalCredentials>
    <calloutOptions>
        <generateAuthorizationHeader>true</generateAuthorizationHeader>
        <allowMergeFieldsInBody>false</allowMergeFieldsInBody>
        <allowMergeFieldsInHeader>true</allowMergeFieldsInHeader>
    </calloutOptions>
</NamedCredential>
```

## Permission set wiring

A principal is unusable until a permission set (or profile, or permission set group) grants access to
it. Package the permission set together with the credential; its setup entity access settings travel
with it.

```xml
<!-- permissionsets/Billing_Integration.permissionset-meta.xml -->
<?xml version="1.0" encoding="UTF-8" ?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Billing Integration</label>
    <hasActivationRequired>false</hasActivationRequired>
    <externalCredentialPrincipalAccesses>
        <enabled>true</enabled>
        <externalCredentialPrincipal>Billing_API_Auth-Billing Integration</externalCredentialPrincipal>
    </externalCredentialPrincipalAccesses>
</PermissionSet>
```

`externalCredentialPrincipalAccesses` naming follows `<ExternalCredentialDeveloperName>-<PrincipalName>`
as retrieved from an org `[unverified]` - confirm by retrieving the permission set after configuring
access in Setup.

Assign it explicitly to the integration user:

```bash
sf org assign permset --name Billing_Integration --target-org vf-int
sf data query \
  --query "SELECT Assignee.Username, PermissionSet.Name FROM PermissionSetAssignment WHERE PermissionSet.Name = 'Billing_Integration'" \
  --target-org vf-int
```

## Using a credential from Apex

```apex
public with sharing class PricingClient {
    private static final String NC = 'callout:Pricing_API';

    public static HttpResponse get(String path, String correlationId) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(NC + path);            // callout:Pricing_API/v1/quotes?id=1
        req.setMethod('GET');
        req.setHeader('X-Correlation-Id', correlationId);
        req.setTimeout(15000);
        return new Http().send(req);
    }
}
```

Merge-field access to credential values (only when `allowMergeFieldsInHeader` /
`allowMergeFieldsInBody` is enabled on the named credential):

```apex
HttpRequest req = new HttpRequest();
req.setEndpoint('callout:Vendor_API/v1/search');
req.setMethod('POST');
// Reads a principal authentication parameter from the external credential.
req.setHeader('x-api-key', '{!$Credential.Vendor_API_Auth.ApiKey}');
req.setHeader('Content-Type', 'application/json');
```

Custom header formula functions (evaluated by the platform, not Apex). Source:
https://developer.salesforce.com/docs/platform/named-credentials/references/named-credentials-reference/nc-formula-functions.html

| Function | Input -> Output | Purpose |
| --- | --- | --- |
| `BLOB(expr)` | String -> Blob | Convert to UTF-8 binary |
| `BASE64ENCODE(expr)` | Blob -> String | Base64 encode (for Basic-style headers) |
| `BASE64DECODE(expr)` | String -> Blob | Base64 decode |
| `HEX(expr)` | Blob -> String | Lower-case base-16 encoding |
| `HASH(algorithm, expr)` | (String, Blob) -> Blob | SHA-256 only |
| `HMAC(algorithm, valueToSign, secretSigningKey)` | (String, Blob, Blob) -> Blob | SHA-256 only; signed-webhook style headers |

Example header values:

| Header | Value |
| --- | --- |
| `Authorization` | `Basic {!BASE64ENCODE(BLOB($Credential.Vendor_Auth.Username & ':' & $Credential.Vendor_Auth.Password))}` |
| `X-Signature` | `{!HEX(HMAC('SHA-256', $Credential.Vendor_Auth.Body, BLOB($Credential.Vendor_Auth.SigningKey)))}` |

## Managing credentials programmatically

`ConnectApi.NamedCredential` / `ConnectApi.ExternalCredential` (Apex) and the Connect REST API can
create, update, refresh, and delete credentials, and fetch the OAuth token-flow URL. Verified input
fields (from `NamedCredentialRecipes.cls` in `trailheadapps/apex-recipes`):

| Input | Fields |
| --- | --- |
| `ConnectApi.NamedCredentialInput` | `developerName`, `masterLabel`, `type` (`ConnectApi.NamedCredentialType.SecuredEndpoint`), `calloutUrl`, `externalCredentials`, `calloutOptions` |
| `ConnectApi.NamedCredentialCalloutOptionsInput` | `allowMergeFieldsInBody`, `allowMergeFieldsInHeader`, `generateAuthorizationHeader` |
| `ConnectApi.ExternalCredentialInput` | `developerName`, `masterLabel`, `authenticationProtocol`, `principals` |
| `ConnectApi.ExternalCredentialPrincipalInput` | `principalName`, `principalType` (`NamedPrincipal`), `sequenceNumber` |

## Packaging and multi-org

| Rule | Detail |
| --- | --- |
| Package contents | Named credential + external credential + `ExternalAuthIdentityProvider` (browser flow) + the permission set granting principal access |
| Not packageable | Certificates, access tokens, client secrets - populate per org via UI or Connect REST API |
| Managed package callouts | Subscriber must add the package namespace to the named credential's allowed namespaces, unless the credential ships in the same package |
| Same name, different endpoint | Create the credential with the same developer name in each org with an environment-specific endpoint; Apex referencing `callout:Name` deploys unchanged |
| vibe-force mapping | `orgs` in `.vibeforce/config.json` gives the alias per environment; the credential name stays constant across `vf-dev`, `vf-int`, `vf-uat`, `vf-prod` |

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `System.CalloutException: Unauthorized endpoint` | Endpoint not a named credential and not in Remote Site Settings | Use `callout:<Name>`; never add ad-hoc remote sites for new work |
| HTTP 401 from the endpoint, no Salesforce error | Principal has no permission set access, or token not populated | Assign the permission set; populate secrets via Setup/Connect API |
| `No credential found for the current user` style failures | Per-user principal with no user token | Have the user complete the "Allow" flow, or switch to a named principal |
| Header merge field appears literally in the request | `allowMergeFieldsInHeader` disabled | Enable it on the named credential |
| Works in dev, 404 in integration | Endpoint differs per org and path duplication (`/v1` both in credential and Apex) | Keep the base URL in the credential, the path in Apex; verify by retrieving the credential |
| Callout succeeds interactively, fails in a batch/Queueable | Missing `Database.AllowsCallouts` or callout after DML | See `callout-and-retry.md` |
| `NamedCredential` deploy succeeds but callout fails after package install | Secrets not packageable | Post-install step: populate via Connect REST API |

Verification commands:

```bash
# Does the credential exist in the target org?
sf org list metadata --metadata-type NamedCredential --target-org vf-int --json
sf org list metadata --metadata-type ExternalCredential --target-org vf-int --json

# Exercise the credential without deploying test code: anonymous Apex probe (read-only).
sf apex run --file scripts/apex/probe-named-credential.apex --target-org vf-int --json
```

`scripts/apex/probe-named-credential.apex`:

```apex
// Read-only reachability probe. Fails loudly so the CLI exit code is non-zero.
HttpRequest req = new HttpRequest();
req.setEndpoint('callout:Billing_API/v1/health');
req.setMethod('GET');
req.setTimeout(10000);
HttpResponse res = new Http().send(req);
System.debug(LoggingLevel.ERROR, 'VF_PROBE status=' + res.getStatusCode());
if (res.getStatusCode() != 200) {
    throw new CalloutException('Billing_API health check returned ' + res.getStatusCode());
}
```

Run probes against sandbox endpoints only. See skill `sf-post-deploy-verification` for the wave-4
smoke sequence and skill `sf-security-model` for permission set design.
