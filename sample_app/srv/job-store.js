'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const JOBS_CSV_PATH = path.join(DATA_DIR, 'jobs.csv');

const COLUMNS = [
  'jobId', 'id', 'name', 'packageId', 'source',
  'originalRequest', 'status', 'error',
  'createdAt', 'updatedAt', 'attemptsJson'
];

/**
 * job-store - CSV persistence for the sample app's deployment job history.
 *
 * Deliberately dependency-free: this format is simple enough (quote every
 * field, double any embedded quotes, one row per job) that a small hand
 * -rolled reader/writer is clearer than pulling in a CSV library for a
 * sample app. Not a production-grade store - full-file rewrite on every
 * save, no locking, no migrations.
 */

function csvEscape(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(values) {
  return values.map(csvEscape).join(',') + '\n';
}

/**
 * Minimal RFC4180-style CSV line parser - handles quoted fields with
 * embedded commas, newlines, and escaped ("") quotes. Sufficient for files
 * this module itself writes; not a general-purpose CSV parser.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') {
        rows.push(row);
      }
      row = [];
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Loads jobs.csv into a Map<jobId, job>. Any job that was RUNNING when the
 * file was last saved is reset to FAILED - its background attempt promise
 * no longer exists after a server restart.
 */
function loadJobs() {
  const jobs = new Map();

  if (!fs.existsSync(JOBS_CSV_PATH)) {
    return jobs;
  }

  const text = fs.readFileSync(JOBS_CSV_PATH, 'utf-8');
  const rows = parseCsv(text);
  if (rows.length === 0) return jobs;

  const header = rows[0];
  for (let r = 1; r < rows.length; r++) {
    const values = rows[r];
    if (values.length !== header.length) continue; // skip malformed row

    const record = {};
    header.forEach((col, i) => { record[col] = values[i]; });

    let attempts = [];
    try {
      attempts = JSON.parse(record.attemptsJson || '[]');
    } catch (e) {
      attempts = [];
    }

    const job = {
      id: record.id,
      name: record.name,
      packageId: record.packageId,
      source: record.source || 'ai',
      originalRequest: record.originalRequest || '',
      status: record.status,
      error: record.error || undefined,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      attempts
    };

    if (job.status === 'RUNNING') {
      job.status = 'FAILED';
      job.error = 'Interrupted by server restart';
    }

    jobs.set(record.jobId, job);
  }

  return jobs;
}

/** Serializes the full jobs Map to jobs.csv, overwriting any existing file. */
function saveJobs(jobs) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let csv = csvRow(COLUMNS);
  for (const [jobId, job] of jobs.entries()) {
    csv += csvRow([
      jobId,
      job.id,
      job.name,
      job.packageId,
      job.source || 'ai',
      job.originalRequest || '',
      job.status,
      job.error || '',
      job.createdAt || '',
      job.updatedAt || '',
      JSON.stringify(job.attempts || [])
    ]);
  }

  fs.writeFileSync(JOBS_CSV_PATH, csv, 'utf-8');
}

module.exports = { loadJobs, saveJobs };
