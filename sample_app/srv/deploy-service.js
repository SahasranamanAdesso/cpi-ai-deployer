const cds = require('@sap/cds');
const { CpiDeployer } = require('@david10ten/deployer');

const deployer = new CpiDeployer();

// In-memory job store - fine for a sample app, not for production use.
const jobs = new Map();
let nextJobId = 1;

module.exports = cds.service.impl(async function () {
  this.on('deployIflow', async (req) => {
    const { id, name, packageId, zipBase64 } = req.data;

    if (!id || !name || !packageId || !zipBase64) {
      return req.error(400, 'id, name, packageId and zipBase64 are all required.');
    }

    const jobId = String(nextJobId++);
    jobs.set(jobId, { status: 'RUNNING', artifactId: id });

    // Deploy runs in the background - the UI polls deploymentStatus for the outcome,
    // since create/deploy/poll can take well beyond a single request's lifetime.
    deployer
      .deployZip({ id, name, packageId, zipBase64 })
      .then((result) => {
        jobs.set(jobId, { status: result.status, artifactId: id }); // 'STARTED' | 'ERROR' | 'TIMEOUT'
      })
      .catch((err) => {
        jobs.set(jobId, { status: 'FAILED', artifactId: id, error: err.message });
      });

    return { jobId };
  });

  this.on('deploymentStatus', (req) => {
    const { jobId } = req.data;
    const job = jobs.get(jobId);

    if (!job) {
      return req.error(404, `Unknown job id '${jobId}'.`);
    }

    return { jobId, ...job };
  });
});
