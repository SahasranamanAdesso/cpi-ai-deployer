/**
 * cpi-deploy-service.js
 *
 * Handles: create/update a CPI Integration Designtime Artifact from a ZIP,
 * trigger its deployment, and poll runtime status.
 *
 * Credentials come from VCAP_SERVICES (bound service instance: cpi-ai-platform-api,
 * plan "api", service "it-rt" / SAP Process Integration Runtime), falling back to
 * process.env (CPI_CLIENT_ID / CPI_CLIENT_SECRET / CPI_TOKEN_URL / CPI_API_BASE_URL)
 * for local development when VCAP_SERVICES is not present.
 *
 * Wired into a CAP custom action via deploy-service.js / deploy-service.cds.
 */

const axios = require('axios');

// ---- 1. Read credentials from the bound service instance, or local env fallback ----
function getCpiCredentials() {
  const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
  // The exact top-level key depends on how you name/tag the resource in mta.yaml.
  // Common shapes: vcap['it-rt'] or vcap['user-provided'], each an array of instances.
  const candidates = [
    ...(vcap['it-rt'] || []),
    ...(vcap['user-provided'] || [])
  ];

  const instance = candidates.find(
    (i) => i.name === 'cpi-ai-platform-api' || i.label === 'it-rt'
  );

  if (instance) {
    const creds = instance.credentials.oauth || instance.credentials;
    return {
      clientId: creds.clientid,
      clientSecret: creds.clientsecret,
      tokenUrl: creds.tokenurl,
      apiBaseUrl: creds.url // tenant runtime host, e.g. https://<tenant>.<region>.hana.ondemand.com
    };
  }

  // Local dev fallback: no bound service instance found in VCAP_SERVICES.
  const {
    CPI_CLIENT_ID: clientId,
    CPI_CLIENT_SECRET: clientSecret,
    CPI_TOKEN_URL: tokenUrl,
    CPI_API_BASE_URL: apiBaseUrl
  } = process.env;

  if (!clientId || !clientSecret || !tokenUrl || !apiBaseUrl) {
    throw new Error(
      'CPI credentials not found in VCAP_SERVICES, and CPI_CLIENT_ID / CPI_CLIENT_SECRET / ' +
      'CPI_TOKEN_URL / CPI_API_BASE_URL are not fully set in the environment.'
    );
  }

  return { clientId, clientSecret, tokenUrl, apiBaseUrl };
}

// ---- 2. OAuth2 client-credentials token, cached until near expiry ----
let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry - 30_000) {
    return cachedToken;
  }

  const { clientId, clientSecret, tokenUrl } = getCpiCredentials();

  const response = await axios.post(
    tokenUrl,
    new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    {
      auth: { username: clientId, password: clientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );

  cachedToken = response.data.access_token;
  cachedTokenExpiry = now + response.data.expires_in * 1000;
  return cachedToken;
}

// ---- 3. Fetch a CSRF token + session cookie (required for OData POSTs) ----
async function getCsrfTokenAndCookie(apiBaseUrl, accessToken) {
  const response = await axios.get(`${apiBaseUrl}/api/v1/IntegrationPackages`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-CSRF-Token': 'Fetch'
    }
  });

  return {
    csrfToken: response.headers['x-csrf-token'],
    cookie: response.headers['set-cookie']
  };
}

// ---- 4. Create or update the designtime artifact from a base64 ZIP ----
async function createOrUpdateArtifact({ id, name, packageId, zipBase64 }) {
  const { apiBaseUrl } = getCpiCredentials();
  const accessToken = await getAccessToken();
  const { csrfToken, cookie } = await getCsrfTokenAndCookie(apiBaseUrl, accessToken);

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'X-CSRF-Token': csrfToken,
    Cookie: cookie,
    'Content-Type': 'application/json'
  };

  const body = {
    Name: name,
    Id: id,
    PackageId: packageId,
    ArtifactContent: zipBase64
  };

  try {
    // First attempt: create new artifact
    await axios.post(`${apiBaseUrl}/api/v1/IntegrationDesigntimeArtifacts`, body, {
      headers
    });
    return { created: true };
  } catch (err) {
    const status = err.response && err.response.status;
    const message = err.response && err.response.data && err.response.data.error && err.response.data.error.message;
    const messageText = typeof message === 'string' ? message : message && message.value;
    // Some tenants report a duplicate artifact ID as 409, others as 500 with an
    // "already exists" message instead - treat both as "needs update, not create".
    const alreadyExists = status === 409 || (typeof messageText === 'string' && /already exists/i.test(messageText));

    if (alreadyExists) {
      // Artifact already exists -> update instead (POST to the Id/Version resource)
      await axios.put(
        `${apiBaseUrl}/api/v1/IntegrationDesigntimeArtifacts(Id='${id}',Version='active')`,
        body,
        { headers }
      );
      return { created: false, updated: true };
    }
    throw err;
  }
}

// ---- 5. Trigger deployment ----
async function deployArtifact(id, version = 'active') {
  const { apiBaseUrl } = getCpiCredentials();
  const accessToken = await getAccessToken();
  const { csrfToken, cookie } = await getCsrfTokenAndCookie(apiBaseUrl, accessToken);

  const url = `${apiBaseUrl}/api/v1/DeployIntegrationDesigntimeArtifact?Id='${id}'&Version='${version}'`;

  const response = await axios.post(
    url,
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-CSRF-Token': csrfToken,
        Cookie: cookie
      }
    }
  );

  // Response body is typically the deployment task ID
  return response.data;
}

// ---- 6. Poll runtime status until STARTED / ERROR / timeout ----
async function pollDeploymentStatus(id, { timeoutMs = 60_000, intervalMs = 3000 } = {}) {
  const { apiBaseUrl } = getCpiCredentials();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const accessToken = await getAccessToken();
    const response = await axios.get(
      `${apiBaseUrl}/api/v1/IntegrationRuntimeArtifacts('${id}')`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const status = response.data.d ? response.data.d.Status : response.data.Status;
    if (status === 'STARTED' || status === 'ERROR') {
      return { status, raw: response.data };
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return { status: 'TIMEOUT' };
}

// ---- 7. Convenience: full end-to-end flow ----
async function deployZipToCpi({ id, name, packageId, zipBase64 }) {
  await createOrUpdateArtifact({ id, name, packageId, zipBase64 });
  await deployArtifact(id);
  const result = await pollDeploymentStatus(id);
  return result;
}

module.exports = {
  deployZipToCpi,
  createOrUpdateArtifact,
  deployArtifact,
  pollDeploymentStatus
};
