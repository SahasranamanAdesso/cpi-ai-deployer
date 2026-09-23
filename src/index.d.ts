export interface CpiCredentials {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  apiBaseUrl: string;
}

export interface CpiDeployerOptions {
  /** Explicit credentials. If omitted, resolved from VCAP_SERVICES, then env vars. */
  credentials?: CpiCredentials;
  /** VCAP_SERVICES instance name to match. Default: 'cpi-ai-platform-api'. */
  instanceName?: string;
  /** VCAP_SERVICES service label to match. Default: 'it-rt'. */
  serviceLabel?: string;
  /** Env var prefix for the fallback lookup (e.g. `${envPrefix}_CLIENT_ID`). Default: 'CPI'. */
  envPrefix?: string;
}

export interface ArtifactParams {
  id: string;
  name: string;
  packageId: string;
  /** Base64-encoded iFlow ZIP content. */
  zipBase64: string;
}

export interface CreateOrUpdateResult {
  created?: boolean;
  updated?: boolean;
}

export interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export interface DeploymentStatusResult {
  status: 'STARTED' | 'ERROR' | 'TIMEOUT';
  raw?: unknown;
}

export interface RuntimeArtifact {
  Id: string;
  Version?: string;
  Name: string;
  Type?: string;
  DeployedBy?: string;
  DeployedOn?: string;
  Status: string;
  [key: string]: unknown;
}

export interface ListArtifactsOptions {
  /** e.g. 'ERROR', 'STARTED'. Omit to list every artifact. */
  status?: string;
}

export class CpiDeployer {
  constructor(options?: CpiDeployerOptions);
  getCredentials(): CpiCredentials;
  getAccessToken(): Promise<string>;
  createOrUpdateArtifact(params: ArtifactParams): Promise<CreateOrUpdateResult>;
  deployArtifact(id: string, version?: string): Promise<unknown>;
  pollDeploymentStatus(id: string, options?: PollOptions): Promise<DeploymentStatusResult>;
  listArtifacts(options?: ListArtifactsOptions): Promise<RuntimeArtifact[]>;
  getArtifactError(id: string): Promise<unknown | null>;
  deployZip(params: ArtifactParams, pollOptions?: PollOptions): Promise<DeploymentStatusResult>;
}

export function resolveCredentials(options?: CpiDeployerOptions): CpiCredentials;
