# CPI Deployer Sample App

A minimal **CAP** (Cloud Application Programming) + **Fiori (SAPUI5)** app
demonstrating how to use [`@david10ten/deployer`](../README.md) from a real
application: pick an iFlow ZIP, deploy it to a CPI tenant, and watch a live
status indicator.

This is a standalone CAP project (its own `package.json`, `srv/`, `app/`) so
it runs with the standard `cds watch` workflow, just like any other CAP app.
It's deliberately small - one service, one view, one controller - to show
the package's API in context, not to be a production deployment tool.

## What it does

- **`srv/deploy-service.cds` + `.js`** (`/deploy`) - a CAP service wrapping
  `@david10ten/deployer` (installed from GitHub Packages, not local source -
  see [Where the package comes from](#where-the-package-comes-from)):
  - `deployIflow(id, name, packageId, zipBase64)` - kicks off
    `deployer.deployZip(...)` in the background and returns a `jobId`
    immediately (deployment + status polling can take a while, so this
    doesn't block the OData request).
  - `deploymentStatus(jobId)` - the UI polls this to update the status
    indicator, returning `RUNNING` / `STARTED` / `ERROR` / `TIMEOUT` / `FAILED`.
  - `listErrorArtifacts()` - wraps `deployer.listArtifacts({ status: 'ERROR' })`.
    Answers "which flows are currently broken?"
  - `getArtifactError(id)` - wraps `deployer.getArtifactError(id)`. Answers
    "why is *this* flow broken?"
- **`app/deployer/webapp/`** - a small freestyle UI5 app with:
  - a form for Artifact ID / name / Package ID,
  - a file picker for the iFlow `.zip`,
  - a "Deploy to CPI" button,
  - a status indicator (busy spinner + colored `ObjectStatus`),
  - a "Check for errors" panel: lists artifacts in `ERROR` status, and lets
    you view the error detail for any of them.

The whole point: the UI never talks to CPI directly, and the CAP service
never implements any CPI-specific HTTP calls itself - all of that lives in
the `@david10ten/deployer` package.

## Run it

```bash
cd sample_app
npm install
cp .env.example .env   # fill in CPI_CLIENT_ID / CPI_CLIENT_SECRET / CPI_TOKEN_URL / CPI_API_BASE_URL
npm run watch
```

Then open the URL `cds watch` prints (typically
<http://localhost:4004/deployer/webapp/index.html>).

A ready-to-use test artifact is included at
[`sample-iflow.zip`](sample-iflow.zip) - a minimal HTTPS-to-HTTP iFlow you
can pick in step 2 to try the flow end to end without building your own ZIP
first. The **Package ID** you enter in step 1 must be the *technical name*
of an existing Integration Package on your tenant (found under Design in
Integration Suite) - not its display name.

`npm run watch` runs `cds watch` with `NODE_PATH` cleared - see below for why
that matters. If you prefer to run `cds watch` directly, read the next
section first.

Credentials are resolved the same way `CpiDeployer` always resolves them -
see the [main README](../README.md#credential-resolution). Locally (via
`cds watch`), it falls back to the `CPI_*` env vars in `.env`; on Cloud
Foundry, bind a `cpi-ai-platform-api` (`it-rt`, plan `api`) service instance
instead and no `.env` is needed.

### If plain `cds watch` hangs with no "server listening" line

If you run `cds watch` directly (instead of `npm run watch`) and see a
warning like:

```
ERROR: @sap/cds was loaded from different locations:
  .../sample_app/node_modules/@sap/cds
  .../some-global-install/node_modules/@sap/cds
```

...and the server never logs `server listening on {...}` - it just repeats
the warning and stalls - a globally installed `@sap/cds`/`@sap/cds-dk` (found
via `NODE_PATH`) is conflicting with the one in `sample_app/node_modules`,
and CAP silently refuses to start the HTTP listener. `npm run watch` already
works around this by clearing `NODE_PATH`; to do it yourself:

```bash
NODE_PATH= cds watch
```

## Where the package comes from

This app installs `@david10ten/deployer` from **GitHub Packages** - the same
way any real consumer would - not from the local `src/` in this repo. Its
`package.json` depends on `"@david10ten/deployer": "^1.1.0"` (a version
range, not `file:..`), and `.npmrc` points the `@david10ten` scope at
`npm.pkg.github.com`:

```
@david10ten:registry=https://npm.pkg.github.com
```

`npm install` needs a `//npm.pkg.github.com/:_authToken=...` entry (in
`~/.npmrc`, or a `GITHUB_TOKEN` env var referenced from it) with
`read:packages` scope - see the [main README's install
instructions](../README.md#install). After installing, you can confirm it's
a real registry copy rather than a symlink to local source:

```bash
readlink -f node_modules/@david10ten/deployer   # should NOT point into ../.. /src
cat node_modules/@david10ten/deployer/package.json | grep version
```

## Where the package is actually used

```js
// srv/deploy-service.js
const { CpiDeployer } = require('@david10ten/deployer');

const deployer = new CpiDeployer(); // reads CPI_* env vars, or VCAP_SERVICES on CF

module.exports = cds.service.impl(async function () {
  this.on('deployIflow', async (req) => {
    const { id, name, packageId, zipBase64 } = req.data;
    // ... deployer.deployZip({ id, name, packageId, zipBase64 }) ...
  });

  this.on('listErrorArtifacts', async () => {
    return deployer.listArtifacts({ status: 'ERROR' });
  });

  this.on('getArtifactError', async (req) => {
    const detail = await deployer.getArtifactError(req.data.id);
    return { id: req.data.id, detail: detail && JSON.stringify(detail, null, 2) };
  });
});
```

That's the entire integration surface - two lines to import and construct
the client, one call per operation.
