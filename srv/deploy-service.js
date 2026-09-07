const cds = require('@sap/cds');
const { CpiDeployer } = require('@david10ten/deployer');

const deployer = new CpiDeployer({ instanceName: 'cpi-ai-platform-api', serviceLabel: 'it-rt' });

module.exports = cds.service.impl(async function () {
  this.on('deployIflow', async (req) => {
    const { id, name, packageId, zipBase64 } = req.data;

    if (!id || !name || !packageId || !zipBase64) {
      return req.error(400, 'id, name, packageId and zipBase64 are all required.');
    }

    try {
      const result = await deployer.deployZip({ id, name, packageId, zipBase64 });

      if (result.status === 'ERROR') {
        return req.error(500, `CPI deployment failed for artifact '${id}'.`);
      }
      if (result.status === 'TIMEOUT') {
        return req.error(
          504,
          `Deployment triggered but status check timed out for '${id}'. Check Integration Suite monitoring.`
        );
      }

      return { status: result.status }; // e.g. "STARTED"
    } catch (err) {
      req.error(500, `Deployment error: ${err.message}`);
    }
  });
});
