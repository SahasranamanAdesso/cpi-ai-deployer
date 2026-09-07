'use strict';

const axios = require('axios');
const { resolveCredentials } = require('./credentials');

/**
 * CpiDeployer
 *
 * Framework-agnostic client for creating/updating and deploying SAP
 * Integration Suite (CPI) Integration Designtime Artifacts via the
 * Integration Runtime (`it-rt`) OData API, and polling deployment status.
 *
 * Usable from any Node.js application - CAP, Express, a CLI, a script, etc.
 *
 * @example
 *   const { CpiDeployer } = require('@david10ten/deployer');
 *
 *   const deployer = new CpiDeployer({
 *     credentials: {
 *       clientId: '...',
 *       clientSecret: '...',
 *       tokenUrl: 'https://<subdomain>.authentication.<region>.hana.ondemand.com/oauth/token',
 *       apiBaseUrl: 'https://<tenant>.<region>.hana.ondemand.com'
 *     }
 *   });
 *
 *   const result = await deployer.deployZip({
 *     id: 'MyFlow',
 *     name: 'My Flow',
 *     packageId: 'MyPackage',
 *     zipBase64: fs.readFileSync('./MyFlow.zip').toString('base64')
 *   });
 */
class CpiDeployer {
  /**
   * @param {object} [options]
   * @param {object} [options.credentials] Explicit { clientId, clientSecret, tokenUrl, apiBaseUrl }.
   *   If omitted, credentials are resolved from VCAP_SERVICES, then from environment variables.
   * @param {string} [options.instanceName='cpi-ai-platform-api'] VCAP_SERVICES instance name to match.
   * @param {string} [options.serviceLabel='it-rt'] VCAP_SERVICES service label to match.
   * @param {string} [options.envPrefix='CPI'] Env var prefix used for the fallback lookup.
   */
  constructor(options = {}) {
    this._options = options;
    this._cachedToken = null;
    this._cachedTokenExpiry = 0;
  }

  /** Resolve credentials lazily so construction never throws for a bad env at startup. */
  getCredentials() {
    return resolveCredentials(this._options);
  }

  async getAccessToken() {
    const now = Date.now();
    if (this._cachedToken && now < this._cachedTokenExpiry - 30_000) {
      return this._cachedToken;
    }

    const { clientId, clientSecret, tokenUrl } = this.getCredentials();

    const response = await axios.post(
      tokenUrl,
      new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      {
        auth: { username: clientId, password: clientSecret },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    this._cachedToken = response.data.access_token;
    this._cachedTokenExpiry = now + response.data.expires_in * 1000;
    return this._cachedToken;
  }

  async _getCsrfTokenAndCookie(apiBaseUrl, accessToken) {
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

  /**
   * Create a new Integration Designtime Artifact, or update it if one with the
   * same id already exists.
   *
   * @param {object} params
   * @param {string} params.id Artifact (technical) ID.
   * @param {string} params.name Artifact display name.
   * @param {string} params.packageId Integration package ID the artifact belongs to.
   * @param {string} params.zipBase64 Base64-encoded iFlow ZIP content.
   */
  async createOrUpdateArtifact({ id, name, packageId, zipBase64 }) {
    if (!id || !name || !packageId || !zipBase64) {
      throw new Error('createOrUpdateArtifact requires id, name, packageId and zipBase64.');
    }

    const { apiBaseUrl } = this.getCredentials();
    const accessToken = await this.getAccessToken();
    const { csrfToken, cookie } = await this._getCsrfTokenAndCookie(apiBaseUrl, accessToken);

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'X-CSRF-Token': csrfToken,
      Cookie: cookie,
      'Content-Type': 'application/json'
    };

    const body = { Name: name, Id: id, PackageId: packageId, ArtifactContent: zipBase64 };

    try {
      await axios.post(`${apiBaseUrl}/api/v1/IntegrationDesigntimeArtifacts`, body, { headers });
      return { created: true };
    } catch (err) {
      const status = err.response && err.response.status;
      const message =
        err.response && err.response.data && err.response.data.error && err.response.data.error.message;
      const messageText = typeof message === 'string' ? message : message && message.value;
      // Some tenants report a duplicate artifact ID as 409, others as 500 with an
      // "already exists" message instead - treat both as "needs update, not create".
      const alreadyExists =
        status === 409 || (typeof messageText === 'string' && /already exists/i.test(messageText));

      if (alreadyExists) {
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

  /**
   * Trigger deployment of a previously created/updated designtime artifact.
   *
   * @param {string} id Artifact ID.
   * @param {string} [version='active'] Artifact version.
   * @returns {Promise<string>} The deployment task ID reported by the tenant.
   */
  async deployArtifact(id, version = 'active') {
    if (!id) throw new Error('deployArtifact requires an artifact id.');

    const { apiBaseUrl } = this.getCredentials();
    const accessToken = await this.getAccessToken();
    const { csrfToken, cookie } = await this._getCsrfTokenAndCookie(apiBaseUrl, accessToken);

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

    return response.data;
  }

  /**
   * Poll the runtime status of a deployed artifact until it reaches a
   * terminal state (STARTED / ERROR) or the timeout elapses.
   *
   * @param {string} id Artifact ID.
   * @param {object} [options]
   * @param {number} [options.timeoutMs=60000]
   * @param {number} [options.intervalMs=3000]
   */
  async pollDeploymentStatus(id, { timeoutMs = 60_000, intervalMs = 3000 } = {}) {
    const { apiBaseUrl } = this.getCredentials();
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const accessToken = await this.getAccessToken();
      const response = await axios.get(`${apiBaseUrl}/api/v1/IntegrationRuntimeArtifacts('${id}')`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const status = response.data.d ? response.data.d.Status : response.data.Status;
      if (status === 'STARTED' || status === 'ERROR') {
        return { status, raw: response.data };
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    return { status: 'TIMEOUT' };
  }

  /**
   * Convenience end-to-end flow: create/update the artifact from a ZIP,
   * deploy it, then poll until it reaches a terminal runtime status.
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.name
   * @param {string} params.packageId
   * @param {string} params.zipBase64
   * @param {object} [pollOptions] Forwarded to `pollDeploymentStatus`.
   */
  async deployZip({ id, name, packageId, zipBase64 }, pollOptions) {
    await this.createOrUpdateArtifact({ id, name, packageId, zipBase64 });
    await this.deployArtifact(id);
    return this.pollDeploymentStatus(id, pollOptions);
  }
}

module.exports = { CpiDeployer };
