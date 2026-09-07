# @david10ten/deployer

Deploy SAP Integration Suite (CPI) iFlow artifacts via the Integration Runtime
(`it-rt`) OData API, from **any** Node.js application. No dependency on CAP,
Cloud Foundry, or any particular framework - just Node + `axios`.

Published to **GitHub Packages** at
[github.com/david10ten/cpi-ai-deployer-package](https://github.com/david10ten/cpi-ai-deployer-package).

- [Install](#install)
- [Quickstart](#quickstart)
- [Getting your CPI credentials](#getting-your-cpi-credentials)
- [Credential resolution](#credential-resolution)
- [API reference](#api-reference)
- [Error handling](#error-handling)
- [Using it from a CAP service](#using-it-from-a-cap-service)
- [Using it from a plain Express/Node app](#using-it-from-a-plain-expressnode-app)
- [Using it from a CLI script](#using-it-from-a-cli-script)
- [Troubleshooting](#troubleshooting)
- [Publishing (maintainers)](#publishing-maintainers)

## Install

This package is published to GitHub's npm registry, not npmjs.com. Any
project that wants to `npm install` it needs to (1) tell npm to resolve the
`@david10ten` scope from `npm.pkg.github.com`, and (2) authenticate with a
GitHub token that has at least `read:packages`.

1. Create a GitHub Personal Access Token (classic) with the `read:packages`
   scope (Settings -> Developer settings -> Personal access tokens).

2. Add to the consuming project's `.npmrc` (project root, or `~/.npmrc` for a
   machine-wide setting):

   ```
   @david10ten:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
   ```

3. Export the token in your shell (never commit it):

   ```bash
   export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
   ```

4. Install:

   ```bash
   npm install @david10ten/deployer
   ```

Within this monorepo it's installed as a local workspace instead - no
registry/token needed:

```json
{
  "dependencies": {
    "@david10ten/deployer": "file:packages/deployer"
  }
}
```

## Quickstart

```js
const { CpiDeployer } = require('@david10ten/deployer');
const fs = require('fs');

const deployer = new CpiDeployer({
  credentials: {
    clientId: process.env.CPI_CLIENT_ID,
    clientSecret: process.env.CPI_CLIENT_SECRET,
    tokenUrl: process.env.CPI_TOKEN_URL,
    apiBaseUrl: process.env.CPI_API_BASE_URL
  }
});

async function main() {
  const result = await deployer.deployZip({
    id: 'MyFlow',
    name: 'My Flow',
    packageId: 'MyPackage',
    zipBase64: fs.readFileSync('./MyFlow.zip').toString('base64')
  });

  console.log(result.status); // 'STARTED' | 'ERROR' | 'TIMEOUT'
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

That's it - one class, one call, no CAP/CF/UI5 required.

## Getting your CPI credentials

`clientId` / `clientSecret` / `tokenUrl` / `apiBaseUrl` come from a **service
key** on a Process Integration Runtime (`it-rt`, plan `api`) service instance
in SAP BTP:

1. In the BTP cockpit, go to your subaccount's Instances and Subscriptions.
2. Create (or open) a service instance for **Process Integration Runtime**,
   plan **API**.
3. Create a service key for that instance.
4. From the service key JSON:
   - `clientid` -> `clientId`
   - `clientsecret` -> `clientSecret`
   - `url` under `oauth` (token endpoint) -> `tokenUrl` (looks like
     `https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token`)
   - `url` at the top level (or under `it-rt`/API metadata, tenant runtime
     host) -> `apiBaseUrl` (looks like
     `https://<tenant>.<region>.hana.ondemand.com`)

If you're running on Cloud Foundry and bind that service instance to your
app, you don't need to do any of this manually - see
[Credential resolution](#credential-resolution) below.

## Credential resolution

The `credentials` option can be omitted entirely. When it is, `CpiDeployer`
resolves credentials in this order:

1. **`VCAP_SERVICES`** (Cloud Foundry): looks for a bound service instance
   named `cpi-ai-platform-api` or labeled `it-rt` (both configurable via
   `instanceName` / `serviceLabel` options).
2. **Environment variables**: `CPI_CLIENT_ID`, `CPI_CLIENT_SECRET`,
   `CPI_TOKEN_URL`, `CPI_API_BASE_URL` (prefix configurable via `envPrefix`).

```js
// Cloud Foundry: bind the service instance in your manifest/mta.yaml,
// nothing else needed.
const deployer = new CpiDeployer();

// Local dev without VCAP_SERVICES: set CPI_CLIENT_ID etc. in the environment.
const deployer = new CpiDeployer();

// Custom VCAP_SERVICES instance name/label, or a different env var prefix:
const deployer = new CpiDeployer({
  instanceName: 'my-cpi-instance',
  serviceLabel: 'it-rt',
  envPrefix: 'MY_CPI'  // reads MY_CPI_CLIENT_ID, MY_CPI_CLIENT_SECRET, ...
});
```

If none of the above resolve, the first call that needs credentials throws
with a message explaining exactly what's missing - construction itself never
throws, so it's safe to instantiate `CpiDeployer` at module load time even
before secrets are configured.

You can also call `resolveCredentials(options)` directly if you just want
the resolution logic without the client:

```js
const { resolveCredentials } = require('@david10ten/deployer');
const creds = resolveCredentials({ envPrefix: 'MY_CPI' });
```

## API reference

### `new CpiDeployer(options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `credentials` | `{ clientId, clientSecret, tokenUrl, apiBaseUrl }` | - | Explicit credentials; skips all lookup. |
| `instanceName` | `string` | `'cpi-ai-platform-api'` | `VCAP_SERVICES` instance name to match. |
| `serviceLabel` | `string` | `'it-rt'` | `VCAP_SERVICES` service label to match. |
| `envPrefix` | `string` | `'CPI'` | Prefix for env var fallback (`${envPrefix}_CLIENT_ID`, etc.). |

### `deployer.getCredentials()`

Returns the resolved `{ clientId, clientSecret, tokenUrl, apiBaseUrl }`.
Throws if none of the resolution strategies succeed.

### `deployer.getAccessToken()`

```js
const token = await deployer.getAccessToken();
```

Fetches (and caches, until ~30s before expiry) an OAuth2 client-credentials
access token. You normally don't need to call this directly - every other
method calls it internally.

### `deployer.createOrUpdateArtifact({ id, name, packageId, zipBase64 })`

Creates a new Integration Designtime Artifact, or updates it in place if an
artifact with that `id` already exists (handles both the 409 and the
500-with-"already exists" shapes some tenants return).

```js
const result = await deployer.createOrUpdateArtifact({
  id: 'MyFlow',
  name: 'My Flow',
  packageId: 'MyPackage',
  zipBase64: fs.readFileSync('./MyFlow.zip').toString('base64')
});
// => { created: true }  or  { created: false, updated: true }
```

### `deployer.deployArtifact(id, version = 'active')`

Triggers deployment of an artifact that already exists as a designtime
artifact (i.e. call `createOrUpdateArtifact` first, or use `deployZip` to do
both).

```js
const taskId = await deployer.deployArtifact('MyFlow');
```

### `deployer.pollDeploymentStatus(id, options?)`

Polls the runtime status of a deployed artifact until it's `STARTED`,
`ERROR`, or the timeout elapses.

| Option | Type | Default |
|---|---|---|
| `timeoutMs` | `number` | `60000` |
| `intervalMs` | `number` | `3000` |

```js
const { status, raw } = await deployer.pollDeploymentStatus('MyFlow', {
  timeoutMs: 120_000,
  intervalMs: 5000
});
// status: 'STARTED' | 'ERROR' | 'TIMEOUT'
```

### `deployer.deployZip({ id, name, packageId, zipBase64 }, pollOptions?)`

The convenience method most callers want: runs `createOrUpdateArtifact` ->
`deployArtifact` -> `pollDeploymentStatus` in sequence and returns the final
status.

```js
const result = await deployer.deployZip(
  { id: 'MyFlow', name: 'My Flow', packageId: 'MyPackage', zipBase64 },
  { timeoutMs: 90_000 }
);
```

TypeScript types for all of the above are included (`src/index.d.ts`), so
autocomplete works out of the box in TS or JS-with-JSDoc setups.

## Error handling

- Missing/invalid credentials -> throws synchronously from
  `getCredentials()` / any method that needs them, with a message naming
  exactly which lookup strategies were tried.
- A failed HTTP call (bad token, artifact not found, tenant error, etc.)
  rejects with the underlying `axios` error - inspect `err.response.status`
  and `err.response.data` for the CPI tenant's error body.
- `pollDeploymentStatus` / `deployZip` never throw on a bad *deployment*
  outcome - they resolve with `{ status: 'ERROR' }` or `{ status: 'TIMEOUT' }`
  instead, so check `result.status` after every call:

```js
const result = await deployer.deployZip({ id, name, packageId, zipBase64 });

if (result.status === 'ERROR') {
  // deployment reached the tenant but failed at runtime - inspect result.raw
} else if (result.status === 'TIMEOUT') {
  // deployment was triggered but didn't reach a terminal state in time -
  // check Integration Suite monitoring manually
} else {
  // result.status === 'STARTED'
}
```

## Using it from a CAP service

```js
const cds = require('@sap/cds');
const { CpiDeployer } = require('@david10ten/deployer');

const deployer = new CpiDeployer();

module.exports = cds.service.impl(async function () {
  this.on('deployIflow', async (req) => {
    const { id, name, packageId, zipBase64 } = req.data;
    const result = await deployer.deployZip({ id, name, packageId, zipBase64 });
    if (result.status === 'ERROR') return req.error(500, `Deployment failed for '${id}'.`);
    if (result.status === 'TIMEOUT') return req.error(504, `Status check timed out for '${id}'.`);
    return { status: result.status };
  });
});
```

## Using it from a plain Express/Node app

```js
const express = require('express');
const { CpiDeployer } = require('@david10ten/deployer');

const app = express();
app.use(express.json({ limit: '20mb' })); // iFlow ZIPs base64-encode into large strings

const deployer = new CpiDeployer({
  credentials: {
    clientId: process.env.CPI_CLIENT_ID,
    clientSecret: process.env.CPI_CLIENT_SECRET,
    tokenUrl: process.env.CPI_TOKEN_URL,
    apiBaseUrl: process.env.CPI_API_BASE_URL
  }
});

app.post('/deploy', async (req, res) => {
  const { id, name, packageId, zipBase64 } = req.body;
  try {
    const result = await deployer.deployZip({ id, name, packageId, zipBase64 });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000);
```

## Using it from a CLI script

```js
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { CpiDeployer } = require('@david10ten/deployer');

const [zipPath, id, name, packageId] = process.argv.slice(2);

const deployer = new CpiDeployer();

deployer
  .deployZip({
    id,
    name,
    packageId,
    zipBase64: fs.readFileSync(path.resolve(zipPath)).toString('base64')
  })
  .then((result) => {
    console.log(`Deployment status: ${result.status}`);
    process.exit(result.status === 'STARTED' ? 0 : 1);
  })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
```

```bash
node deploy-cli.js ./MyFlow.zip MyFlow "My Flow" MyPackage
```

## Troubleshooting

- **`CPI credentials not found...`** - none of `credentials`,
  `VCAP_SERVICES`, or the `${envPrefix}_*` env vars resolved. Double-check
  `instanceName`/`serviceLabel` match your bound service, or that the env
  vars are actually set in the process running this code (not just your
  shell).
- **401 on token request** - `clientId`/`clientSecret` don't match the
  `tokenUrl`'s tenant, or the service key has been rotated/revoked.
- **403/CSRF errors on create/update/deploy** - the CSRF token fetch
  (`GET /api/v1/IntegrationPackages` with `X-CSRF-Token: Fetch`) failed or
  its cookie wasn't reused; this usually means the access token itself is
  invalid or the API base URL is wrong (not the tenant runtime host).
- **`status: 'TIMEOUT'` from `deployZip`** - deployment was triggered but
  didn't reach `STARTED`/`ERROR` within `timeoutMs`. Increase `timeoutMs`,
  or check Integration Suite's monitoring UI for the artifact directly -
  large iFlows can take longer than the 60s default.
- **npm install fails with 404/403** - GitHub Packages install failures are
  almost always either a missing `@david10ten:registry=...` line in
  `.npmrc`, or a token without `read:packages`.

## Publishing (maintainers)

Requires a GitHub PAT with `write:packages` scope, and write/admin access to
[david10ten/cpi-ai-deployer-package](https://github.com/david10ten/cpi-ai-deployer-package).

```bash
cd packages/deployer
npm publish --registry=https://npm.pkg.github.com
```

Bump `version` in `package.json` first - GitHub Packages rejects republishing
an existing version.
