# CPI Deployer Sample App

A minimal **CAP** (Cloud Application Programming) + **Fiori (SAPUI5)** app
demonstrating [`@david10ten/deployer`](../README.md) together with
[`@cpi-ai/compiler`](https://github.com/SahasranamanAdesso/cpi-ai-compiler):
describe an Integration Flow in natural language, have the AI generate and
deploy it to a CPI tenant, and - if SAP rejects the deployment - click
**Fix & Redeploy** to feed SAP's own error detail back into the AI and try
again, watching per-attempt status the whole way.

This is a standalone CAP project (its own `package.json`, `srv/`, `app/`) so
it runs with the standard `cds watch` workflow, just like any other CAP app.
It's deliberately small - one service, one view, one controller - to show
both packages' APIs in context, not to be a production deployment tool.

## What it does

- **`srv/deploy-service.cds` + `.js`** (`/deploy`) - a CAP service composing
  `@cpi-ai/compiler`'s `DeploymentOrchestrator` with `@david10ten/deployer`'s
  `CpiDeployer` (both installed as real packages, not local source - see
  [Where the packages come from](#where-the-packages-come-from)):
  - `generateAndDeploy(id, name, packageId, description)` - builds an
    `IntegrationFlowGenerator` + `DeploymentOrchestrator`, kicks off
    `orchestrator.runAttempt(description, ...)` in the background (AI
    generation, compile, package, deploy, poll can all take a while, so this
    doesn't block the OData request), and returns a `jobId` immediately.
  - `fixAndRedeploy(jobId)` - looks up the job's last failed attempt, calls
    `orchestrator.buildNextRequest(...)` to compose feedback from SAP's own
    error detail, runs one more attempt in the background, and returns the
    same `jobId`.
  - `jobStatus(jobId)` - the UI polls this to update the status indicator and
    attempt-history table, returning `RUNNING` / `STARTED` / `ERROR` /
    `TIMEOUT` / `GENERATION_FAILED` / `FAILED`, plus `canRetry` and a JSON
    summary of every attempt so far.
  - `listErrorArtifacts()` - wraps `deployer.listArtifacts({ status: 'ERROR' })`.
    Answers "which flows are currently broken?" (independent of the job flow
    above - useful for browsing the whole tenant).
  - `getArtifactError(id)` - wraps `deployer.getArtifactError(id)`. Answers
    "why is *this* flow broken?"
- **`app/deployer/webapp/`** - a small freestyle UI5 app with four tabs
  (text headers, not icons):
  - **Generate iFlow** - describe a flow in natural language, click
    "Generate & Deploy", watch status + an attempt-history table (each row's
    "Show" opens a popup with that attempt's full summary); a "Fix &
    Redeploy" button appears whenever the latest attempt failed and the
    per-job attempt cap hasn't been reached.
  - **Deploy my iFlow** - upload an existing iFlow `.zip` directly, with the
    same status/attempts/Fix & Redeploy UI as Generate iFlow.
  - **Broken Flows** - lists tenant artifacts in `ERROR` status; "View error"
    shows SAP's raw error detail, "Fix & Redeploy" opens a dialog (Package ID
    + description) that registers the flow as a job and immediately retries
    it with the AI, using SAP's error as feedback.
  - **Job History** - every job ever run (AI-generated, ZIP-uploaded, or
    picked up from Broken Flows), with "Select" to resume tracking one in the
    Generate tab.

The whole point: the UI never talks to CPI or the AI provider directly, and
the CAP service never implements any CPI-specific HTTP calls or prompt
building itself - all of that lives in `@david10ten/deployer` and
`@cpi-ai/compiler` respectively.

## Run it

```bash
cd sample_app
npm install
cp .env.example .env   # fill in CPI_CLIENT_ID / CPI_CLIENT_SECRET / CPI_TOKEN_URL / CPI_API_BASE_URL, plus an AI provider
npm run watch
```

You need exactly one AI provider configured in `.env` - the backend checks
`AI_HUB_API_KEY` first and falls back to `ANTHROPIC_API_KEY` if it's unset:

- **adesso AI Hub** (preferred) - set `AI_HUB_API_KEY`. Uses
  `@cpi-ai/compiler`'s `AdessoAIHubProvider` against an OpenAI-compatible
  `/v1/chat/completions` endpoint; `AI_HUB_API_URL`/`AI_HUB_MODEL` are
  optional overrides (defaults: `https://adesso-ai-hub.3asabc.de/v1/chat/completions`,
  `deepseek-v4-flash-sovereign`).
- **Anthropic direct** - set `ANTHROPIC_API_KEY` to a **direct** key from
  [console.anthropic.com](https://console.anthropic.com). A Claude Code
  session key will not work, since `ClaudeProvider` calls
  `api.anthropic.com` directly rather than going through any proxy.

Then open the URL `cds watch` prints (typically
<http://localhost:4004/deployer/webapp/index.html>).

Fill in an Artifact ID / name / Package ID, describe the flow you want (e.g.
*"Receive HTTPS requests and set the message body to 'Hello from AI-powered
Integration Suite!'"*), and click **Generate & Deploy**. The **Package ID**
must be the *technical name* of an existing Integration Package on your
tenant (found under Design in Integration Suite) - not its display name. If
SAP rejects the deployment, its error appears in the attempt-history table
and a **Fix & Redeploy** button appears - click it to have the AI regenerate
a corrected flow using that error as feedback, up to 5 attempts per job.

`npm run watch` runs `cds watch` with `NODE_PATH` cleared - see below for why
that matters. If you prefer to run `cds watch` directly, read the next
section first.

Credentials are resolved the same way `CpiDeployer` always resolves them -
see the [main README](../README.md#credential-resolution). Locally (via
`cds watch`), it falls back to the `CPI_*` env vars in `.env`; on Cloud
Foundry, bind a `cpi-ai-platform-api` (`it-rt`, plan `api`) service instance
instead and no `.env` is needed for those. `ANTHROPIC_API_KEY` always comes
from the environment/`.env` regardless of platform.

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

## Where the packages come from

This app installs both packages as real dependencies, never as relative
source imports:

- **`@david10ten/deployer`** from **GitHub Packages**, the same way any real
  consumer would. `.npmrc` points the `@david10ten` scope at
  `npm.pkg.github.com`:

  ```
  @david10ten:registry=https://npm.pkg.github.com
  ```

  `npm install` needs a `//npm.pkg.github.com/:_authToken=...` entry (in
  `~/.npmrc`, or a `GITHUB_TOKEN` env var referenced from it) with
  `read:packages` scope - see the [main README's install
  instructions](../README.md#install).

- **`@cpi-ai/compiler`** from a packed tarball at `../vendor/cpi-ai-compiler-*.tgz`
  (built via `cd cpi-ai-compiler/packages/compiler && npm run build && npm pack`),
  referenced in `package.json` as `"@cpi-ai/compiler": "file:../vendor/cpi-ai-compiler-1.0.0.tgz"`.
  `cpi-ai-compiler` isn't published to any registry, so a local tarball is the
  closest equivalent to a real install without one - `npm install` extracts it
  into `node_modules/@cpi-ai/compiler` exactly like a registry package.

After installing, you can confirm both are real installed copies rather than
symlinks to local source:

```bash
readlink -f node_modules/@david10ten/deployer   # should NOT point into ../.. /src
readlink -f node_modules/@cpi-ai/compiler       # should NOT point into ../.. /src
```

## Where the packages are actually used

```js
// srv/deploy-service.js
const { CpiDeployer } = require('@david10ten/deployer');
const { DeploymentOrchestrator, IntegrationFlowGenerator, AIPipeline, ClaudeProvider, AdessoAIHubProvider } = require('@cpi-ai/compiler');

const deployer = new CpiDeployer(); // reads CPI_* env vars, or VCAP_SERVICES on CF

function buildAiProvider() {
  if (process.env.AI_HUB_API_KEY) {
    return new AdessoAIHubProvider(process.env.AI_HUB_API_KEY, process.env.AI_HUB_API_URL, process.env.AI_HUB_MODEL);
  }
  return new ClaudeProvider(process.env.ANTHROPIC_API_KEY);
}

module.exports = cds.service.impl(async function () {
  this.on('generateAndDeploy', async (req) => {
    const { id, name, packageId, description } = req.data;
    const generator = new IntegrationFlowGenerator(new AIPipeline(buildAiProvider()));
    const orchestrator = new DeploymentOrchestrator(generator, deployer, { id, name, packageId });
    // ... orchestrator.runAttempt(description, outputPath) ...
  });

  this.on('fixAndRedeploy', async (req) => {
    // ... orchestrator.buildNextRequest(originalRequest, lastAttempt), then runAttempt again ...
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

That's the entire integration surface - a handful of lines to import and
compose the two clients, one call per operation.
