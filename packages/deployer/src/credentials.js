'use strict';

/**
 * Resolve SAP Integration Suite (CPI) API credentials.
 *
 * Resolution order:
 *   1. Credentials passed explicitly to `resolveCredentials(config)`.
 *   2. A bound Cloud Foundry service instance found in VCAP_SERVICES
 *      (service "it-rt" / plan "api", any label/tag).
 *   3. Environment variables (CPI_CLIENT_ID, CPI_CLIENT_SECRET, CPI_TOKEN_URL,
 *      CPI_API_BASE_URL by default, or a custom prefix).
 *
 * This has no dependency on CAP, CF, or any particular host application -
 * it only reads process.env, so it works the same in a CAP service, a plain
 * Express app, a script, etc.
 */

function readFromVcapServices({ vcapServices, instanceName, serviceLabel } = {}) {
  const raw = vcapServices !== undefined ? vcapServices : process.env.VCAP_SERVICES;
  if (!raw) return null;

  let vcap;
  try {
    vcap = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }

  const instances = Object.values(vcap || {}).flat();
  const instance = instances.find(
    (i) => i && (i.name === instanceName || i.label === serviceLabel)
  );
  if (!instance || !instance.credentials) return null;

  const creds = instance.credentials.oauth || instance.credentials;
  if (!creds.clientid || !creds.clientsecret || !creds.tokenurl || !creds.url) return null;

  return {
    clientId: creds.clientid,
    clientSecret: creds.clientsecret,
    tokenUrl: creds.tokenurl,
    apiBaseUrl: creds.url
  };
}

function readFromEnv(envPrefix = 'CPI') {
  const clientId = process.env[`${envPrefix}_CLIENT_ID`];
  const clientSecret = process.env[`${envPrefix}_CLIENT_SECRET`];
  const tokenUrl = process.env[`${envPrefix}_TOKEN_URL`];
  const apiBaseUrl = process.env[`${envPrefix}_API_BASE_URL`];

  if (!clientId || !clientSecret || !tokenUrl || !apiBaseUrl) return null;
  return { clientId, clientSecret, tokenUrl, apiBaseUrl };
}

/**
 * @param {object} [options]
 * @param {object} [options.credentials] Explicit credentials, short-circuits all lookups.
 * @param {string} [options.instanceName='cpi-ai-platform-api'] VCAP_SERVICES instance name to match.
 * @param {string} [options.serviceLabel='it-rt'] VCAP_SERVICES service label to match.
 * @param {string} [options.envPrefix='CPI'] Prefix for the env var fallback.
 * @param {object|string} [options.vcapServices] Override for VCAP_SERVICES (mainly for tests).
 */
function resolveCredentials(options = {}) {
  const {
    credentials,
    instanceName = 'cpi-ai-platform-api',
    serviceLabel = 'it-rt',
    envPrefix = 'CPI',
    vcapServices
  } = options;

  if (credentials) {
    const { clientId, clientSecret, tokenUrl, apiBaseUrl } = credentials;
    if (!clientId || !clientSecret || !tokenUrl || !apiBaseUrl) {
      throw new Error(
        'Explicit CPI credentials must include clientId, clientSecret, tokenUrl and apiBaseUrl.'
      );
    }
    return credentials;
  }

  const fromVcap = readFromVcapServices({ vcapServices, instanceName, serviceLabel });
  if (fromVcap) return fromVcap;

  const fromEnv = readFromEnv(envPrefix);
  if (fromEnv) return fromEnv;

  throw new Error(
    'CPI credentials not found. Pass them explicitly via `credentials`, bind a CF service ' +
    `instance discoverable in VCAP_SERVICES, or set ${envPrefix}_CLIENT_ID / ${envPrefix}_CLIENT_SECRET / ` +
    `${envPrefix}_TOKEN_URL / ${envPrefix}_API_BASE_URL in the environment.`
  );
}

module.exports = { resolveCredentials };
