const cds = require('@sap/cds');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CpiDeployer } = require('@david10ten/deployer');
const {
  DeploymentOrchestrator,
  IntegrationFlowGenerator,
  AIPipeline,
  ClaudeProvider,
  AdessoAIHubProvider,
  formatSapErrorFeedback
} = require('@cpi-ai/compiler');
const jobStore = require('./job-store');

const deployer = new CpiDeployer();

const DEFAULT_AI_HUB_URL = 'https://adesso-ai-hub.3asabc.de/v1/chat/completions';
const DEFAULT_AI_HUB_MODEL = 'deepseek-v4-flash-sovereign';

// Cap on manual "Fix & Redeploy" clicks per job - each one calls the AI
// provider and re-deploys, so this bounds cost/time for a runaway loop.
const MAX_MANUAL_ATTEMPTS = 5;

// Job store: in-memory Map backed by data/jobs.csv (see job-store.js), so
// job history (including the original prompt) survives server restarts.
const jobs = jobStore.loadJobs();
let nextJobId = Math.max(0, ...Array.from(jobs.keys()).map(Number).filter((n) => !Number.isNaN(n))) + 1;

function persist() {
  jobStore.saveJobs(jobs);
}

/**
 * Prefers adesso AI Hub (AI_HUB_API_KEY) when configured, falling back to a
 * direct Anthropic key (ANTHROPIC_API_KEY) otherwise. Both use the same
 * AIProvider interface from @cpi-ai/compiler, so the rest of the pipeline
 * (PromptBuilder, FlowValidator, CodeExecutor) is identical either way.
 */
function buildAiProvider() {
  const aiHubKey = process.env.AI_HUB_API_KEY;
  if (aiHubKey) {
    const apiUrl = process.env.AI_HUB_API_URL || DEFAULT_AI_HUB_URL;
    const model = process.env.AI_HUB_MODEL || DEFAULT_AI_HUB_MODEL;
    return new AdessoAIHubProvider(aiHubKey, apiUrl, model);
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return new ClaudeProvider(anthropicKey);
  }

  throw new Error(
    'No AI provider configured. Set AI_HUB_API_KEY (adesso AI Hub) or ANTHROPIC_API_KEY ' +
    '(a direct Anthropic key, not a Claude Code session key) in sample_app/.env - see .env.example.'
  );
}

function buildOrchestrator(artifact) {
  const provider = buildAiProvider();

  const generator = new IntegrationFlowGenerator(new AIPipeline(provider));
  return new DeploymentOrchestrator(generator, deployer, artifact);
}

/**
 * A DeploymentOrchestrator needs an IntegrationFlowGenerator-shaped object
 * (one method: generate(request, outputPath)). For deployZip, there's
 * nothing to generate - the ZIP already exists - so this just writes it to
 * outputPath and reports success, letting DeploymentOrchestrator's existing
 * deploy + SAP-error-fetch + feedback-formatting logic run unchanged.
 */
function buildZipPassthroughOrchestrator(artifact, zipBase64) {
  const generator = {
    async generate(_request, outputPath) {
      fs.writeFileSync(outputPath, Buffer.from(zipBase64, 'base64'));
      return { success: true, errors: [], outputPath };
    }
  };
  return new DeploymentOrchestrator(generator, deployer, artifact);
}

/** Derives the job-level status string from a DeploymentAttempt's outcome. */
function statusFromAttempt(attempt) {
  if (attempt.generationErrors && attempt.generationErrors.length > 0) return 'GENERATION_FAILED';
  if (attempt.deployResult) return attempt.deployResult.status; // 'STARTED' | 'ERROR' | 'TIMEOUT'
  return 'FAILED';
}

/** True for any terminal status a "Fix & Redeploy" click can act on. */
function isFailureStatus(status) {
  return status === 'GENERATION_FAILED' || status === 'ERROR' || status === 'TIMEOUT' || status === 'FAILED';
}

/** Slim, UI-friendly summary of one attempt - avoids shipping full generated code/raw payloads to the client. */
function summarizeAttempt(attempt) {
  const status = statusFromAttempt(attempt);
  let summary;
  if (status === 'GENERATION_FAILED') {
    summary = attempt.generationErrors.join('; ');
  } else if (status === 'STARTED') {
    summary = 'Deployed successfully.';
  } else {
    summary = attempt.feedbackGiven || 'Deployment did not reach a running state.';
  }
  return { attemptNumber: attempt.attemptNumber, status, summary };
}

function canRetryJob(job) {
  return job.status !== 'RUNNING' && isFailureStatus(job.status) && job.attempts.length < MAX_MANUAL_ATTEMPTS;
}

function runAttemptInBackground(jobId, orchestrator, request, outputPath, attemptNumber) {
  orchestrator
    .runAttempt(request, outputPath, undefined, attemptNumber)
    .then((attempt) => {
      const job = jobs.get(jobId);
      if (!job) return; // job was cleared/replaced
      job.attempts.push(attempt);
      job.status = statusFromAttempt(attempt);
      job.updatedAt = new Date().toISOString();
      persist();
    })
    .catch((err) => {
      const job = jobs.get(jobId);
      if (!job) return;
      job.status = 'FAILED';
      job.error = err.message;
      job.updatedAt = new Date().toISOString();
      persist();
    })
    .finally(() => {
      fs.rm(outputPath, { force: true }, () => {});
    });
}

function createJob(jobId, { id, name, packageId, source, originalRequest }) {
  const now = new Date().toISOString();
  const job = {
    id, name, packageId, source,
    originalRequest: originalRequest || '',
    attempts: [],
    status: 'RUNNING',
    createdAt: now,
    updatedAt: now
  };
  jobs.set(jobId, job);
  persist();
  return job;
}

module.exports = cds.service.impl(async function () {
  this.on('generateAndDeploy', async (req) => {
    const { id, name, packageId, description } = req.data;

    if (!id || !name || !packageId || !description) {
      return req.error(400, 'id, name, packageId and description are all required.');
    }

    let orchestrator;
    try {
      orchestrator = buildOrchestrator({ id, name, packageId });
    } catch (err) {
      return req.error(500, err.message);
    }

    const jobId = String(nextJobId++);
    const outputPath = path.join(os.tmpdir(), `iflow-${jobId}-${Date.now()}.zip`);

    createJob(jobId, { id, name, packageId, source: 'ai', originalRequest: description });

    runAttemptInBackground(jobId, orchestrator, description, outputPath, 1);

    return { jobId };
  });

  this.on('deployZip', async (req) => {
    const { id, name, packageId, zipBase64, description } = req.data;

    if (!id || !name || !packageId || !zipBase64) {
      return req.error(400, 'id, name, packageId and zipBase64 are all required.');
    }

    const jobId = String(nextJobId++);
    const outputPath = path.join(os.tmpdir(), `iflow-${jobId}-${Date.now()}.zip`);
    const orchestrator = buildZipPassthroughOrchestrator({ id, name, packageId }, zipBase64);

    createJob(jobId, { id, name, packageId, source: 'zip', originalRequest: description || '' });

    // The "request" text is irrelevant here (the passthrough generator
    // ignores it on this first attempt) - it only matters if a later
    // Fix & Redeploy click needs it as the base for AI feedback, which
    // requires a description to have been provided.
    runAttemptInBackground(jobId, orchestrator, description || '', outputPath, 1);

    return { jobId };
  });

  this.on('addManualJob', async (req) => {
    const { id, name, packageId, description } = req.data;

    if (!id || !name || !packageId) {
      return req.error(400, 'id, name and packageId are all required.');
    }

    const jobId = String(nextJobId++);
    const now = new Date().toISOString();
    const job = {
      id, name, packageId,
      source: 'manual',
      originalRequest: description || '',
      attempts: [],
      status: 'STARTED',
      createdAt: now,
      updatedAt: now
    };

    try {
      const artifacts = await deployer.listArtifacts();
      const match = artifacts.find((a) => a.Id === id);

      if (!match) {
        job.status = 'FAILED';
        job.error = `No runtime artifact with Id '${id}' was found on the tenant. Check the Artifact ID.`;
      } else if (match.Status === 'ERROR') {
        const detail = await deployer.getArtifactError(id);
        const feedback = formatSapErrorFeedback('ERROR', detail);
        job.status = 'ERROR';
        job.attempts.push({
          attemptNumber: 1,
          generationErrors: [],
          deployResult: { status: 'ERROR', raw: detail },
          sapErrorDetail: detail,
          feedbackGiven: feedback
        });
      } else {
        job.status = match.Status; // e.g. STARTED
      }
    } catch (err) {
      job.status = 'FAILED';
      job.error = err.message;
    }

    jobs.set(jobId, job);
    persist();

    return { jobId };
  });

  this.on('fixAndRedeploy', async (req) => {
    const { jobId } = req.data;
    const job = jobs.get(jobId);

    if (!job) return req.error(404, `Unknown job id '${jobId}'.`);
    if (job.status === 'RUNNING') return req.error(409, 'This job is still in progress.');

    const lastAttempt = job.attempts[job.attempts.length - 1];
    if (!lastAttempt || !isFailureStatus(job.status)) {
      return req.error(400, 'This job has not failed - nothing to fix.');
    }
    if (job.attempts.length >= MAX_MANUAL_ATTEMPTS) {
      return req.error(400, `Maximum of ${MAX_MANUAL_ATTEMPTS} attempts reached for this job.`);
    }
    if (!job.originalRequest) {
      return req.error(400, 'This job has no description/prompt recorded - add one before using Fix & Redeploy.');
    }

    let orchestrator;
    try {
      orchestrator = buildOrchestrator({ id: job.id, name: job.name, packageId: job.packageId });
    } catch (err) {
      return req.error(500, err.message);
    }

    const nextRequest = orchestrator.buildNextRequest(job.originalRequest, lastAttempt);
    const nextAttemptNumber = job.attempts.length + 1;
    const outputPath = path.join(os.tmpdir(), `iflow-${jobId}-${Date.now()}.zip`);

    job.status = 'RUNNING';
    job.updatedAt = new Date().toISOString();
    persist();

    runAttemptInBackground(jobId, orchestrator, nextRequest, outputPath, nextAttemptNumber);

    return { jobId };
  });

  this.on('jobStatus', (req) => {
    const { jobId } = req.data;
    const job = jobs.get(jobId);

    if (!job) return req.error(404, `Unknown job id '${jobId}'.`);

    return {
      jobId,
      status: job.status,
      artifactId: job.id,
      attemptCount: job.attempts.length,
      canRetry: canRetryJob(job),
      attemptsJson: JSON.stringify(job.attempts.map(summarizeAttempt)),
      error: job.error
    };
  });

  this.on('listJobs', () => {
    return Array.from(jobs.entries())
      .map(([jobId, job]) => ({
        jobId,
        id: job.id,
        name: job.name,
        packageId: job.packageId,
        source: job.source || 'ai',
        status: job.status,
        attemptCount: job.attempts.length,
        canRetry: canRetryJob(job),
        hasDescription: Boolean(job.originalRequest),
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      }))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  });

  // Demonstrates CpiDeployer.listArtifacts() / getArtifactError() - "which
  // flows are broken, and why?" - as opposed to the job flow's "fix this one".
  this.on('listErrorArtifacts', async () => {
    return deployer.listArtifacts({ status: 'ERROR' });
  });

  this.on('getArtifactError', async (req) => {
    const { id } = req.data;
    if (!id) return req.error(400, 'id is required.');

    const detail = await deployer.getArtifactError(id);
    return {
      id,
      detail: detail === null ? null : JSON.stringify(detail, null, 2)
    };
  });
});
