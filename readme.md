# cpi-ai-platform

A CAP (Cloud Application Programming) project that turns natural-language
prompts into SAP Integration Suite (CPI) iFlows: an AI layer translates a
prompt into a compiler JSON contract, a compiler turns that into a deployable
iFlow ZIP, and a deploy service pushes the ZIP straight into a CPI tenant.

## Project layout

| Path | Purpose |
|---|---|
| `app/iflowstudio` | UI5 frontend - prompt input, flow preview, deploy/download actions |
| `srv/cpiplatform-service.js` + `.cds` | AI translation + compiler orchestration (`/cpi` service: `translatePrompt`, `compileFlow`, `downloadFlow`) |
| `srv/deploy-service.js` + `.cds` | CPI deployment (`/deploy` service: `deployIflow`) - thin CAP wrapper around `packages/deployer` |
| `packages/deployer` | **Standalone, framework-agnostic npm package** (`@david10ten/deployer`) that does the actual CPI deploy. Usable from any Node.js app, not just this one. See [packages/deployer/README.md](packages/deployer/README.md). |
| `db/` | Domain model (currently empty / undeploy config only) |
| `cpi-ai-platform-approuter` | Cloud Foundry approuter for the deployed app |
| `mta.yaml` | Multi-Target Application descriptor for `cf deploy` |

## Local setup

1. Install dependencies (root + all workspaces):

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in local secrets:

   ```bash
   cp .env.example .env
   ```

   - `AI_HUB_API_KEY` - key for the AI Hub endpoint used by `cpiplatform-service.js`.
   - `CPI_CLIENT_ID` / `CPI_CLIENT_SECRET` / `CPI_TOKEN_URL` / `CPI_API_BASE_URL` -
     local fallback credentials for the CPI Integration Runtime API, used only
     when `VCAP_SERVICES` has no bound `cpi-ai-platform-api` (`it-rt`) instance
     (i.e. when running outside Cloud Foundry). Get these from the service key
     of your `cpi-ai-platform-api` service instance.

3. Run the service:

   ```bash
   npm start
   # or, to also open the iFlow Studio UI with live reload disabled:
   npm run watch-iflowstudio
   ```

## Using the app

The `/cpi` service (`srv/cpiplatform-service.cds`) exposes:

- `POST /cpi/translatePrompt` - prompt -> compiler JSON (for inspection/debugging).
- `POST /cpi/compileFlow` - prompt -> compiler JSON -> validated -> compiled to a ZIP (returns metadata + size, not the file itself).
- `GET /cpi/downloadFlow(prompt='...')` - prompt -> compiled iFlow ZIP, streamed back as `flow.zip`.

The `/deploy` service (`srv/deploy-service.cds`), gated by the `DeployIFlow`
role, exposes:

- `POST /deploy/deployIflow` - `{ id, name, packageId, zipBase64 }` -> creates
  or updates the designtime artifact on the CPI tenant, triggers deployment,
  and polls until the runtime status is `STARTED`, `ERROR`, or the poll times out.

Typical end-to-end flow: get a ZIP from `downloadFlow` (or build one another
way), base64-encode it, then call `deployIflow` with that payload.

### Deploying to a CPI tenant from your own app

The actual CPI deploy logic isn't tied to this CAP project - it's published
as a standalone package, `@david10ten/deployer`, that any Node.js application
can install and use directly. See
**[packages/deployer/README.md](packages/deployer/README.md)** for full
install and usage instructions, including a quick example:

```js
const { CpiDeployer } = require('@david10ten/deployer');

const deployer = new CpiDeployer({
  credentials: {
    clientId: process.env.CPI_CLIENT_ID,
    clientSecret: process.env.CPI_CLIENT_SECRET,
    tokenUrl: process.env.CPI_TOKEN_URL,
    apiBaseUrl: process.env.CPI_API_BASE_URL
  }
});

const result = await deployer.deployZip({
  id: 'MyFlow',
  name: 'My Flow',
  packageId: 'MyPackage',
  zipBase64: fs.readFileSync('./MyFlow.zip').toString('base64')
});
```

## Deploying this project to Cloud Foundry

```bash
npm run build   # mbt build -> mta_archives/archive.mtar
npm run deploy  # cf deploy mta_archives/archive.mtar
```

`mta.yaml` binds the `srv` module to an existing `cpi-ai-platform-api`
(`it-rt`, plan `api`) service instance, which must already exist in the
target space (see the comment in `mta.yaml` - it's looked up by name, not
provisioned by the MTA).

## Learn more

- CAP: <https://cap.cloud.sap>
- The standalone deploy client: [packages/deployer/README.md](packages/deployer/README.md)
