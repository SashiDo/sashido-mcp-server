import axios, { AxiosInstance, AxiosError } from 'axios';
import { appConfig } from '../config.js';
import { auditHeaders } from '../audit.js';

export interface Replicas {
  auto: boolean;
  min: number;
  max: number;
}

export interface Deployment {
  objectId: string;
  name: string;
  number: number;
  /** Active: serves traffic; Running: rolling out; Complete, Cancelled, Failed */
  phase: string;
  region?: string;
  replicas?: Replicas;
  duration?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface AppSettingsForToken {
  /** per region: {name, billingPolicy} */
  engine?: Record<string, { name: string; billingPolicy: string }>;
  highly_available?: boolean;
  engine_scaling_config?: { min?: number; max?: number; buffer?: number };
}

export interface App {
  objectId: string;
  name: string;
  appId: string;
  region: string;
  serviceName?: string;
  /** e.g. release-6.5.11-preview */
  parseServerVersion?: string;
  settings?: AppSettingsForToken;
  deployment?: Deployment;
  createdAt: string;
  updatedAt: string;
}

/** An Activity record (the API's audit log) */
export interface Activity {
  objectId: string;
  type: string;
  createdAt: string;
  ip?: string;
  app?: { objectId: string };
  data?: { message?: string; params?: Record<string, unknown> };
  actor?: { kind: string; tokenId?: string; tokenName?: string };
  via?: { client?: string; mcpClient?: string; mcpTool?: string; requestId?: string };
  result?: { status: string; code?: number; message?: string };
  source?: string;
}

export interface ParseServerVersion {
  imageTag: string;
  version: string;
  /** what new apps get by default */
  latest?: boolean;
}

export interface AppDetails extends App {
  masterKey?: string;
  clientKey?: string;
  javascriptKey?: string;
  restApiKey?: string;
  webhookKey?: string;
  serverUrl?: string;
  parseVersion?: string;
}

export interface Build {
  objectId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  number?: number;
  trigger?: {
    type: string;
    githubData?: Record<string, unknown>;
  };
}

export interface EnvVariable {
  name: string;
  value: string;
}

export interface ScaleConfig {
  min?: number;
  max?: number;
  current?: number;
  auto: boolean;
  cpuTarget?: number;
}

export interface ApiError {
  code: number;
  message: string;
}

export interface ParseServerEngine {
  name: string;
  billingPolicy: 'monthly' | 'hourly';
  price: number;
  /** the API keeps cpu and ram (MB) under params */
  params?: { cpu?: number; ram?: number };
  cpu?: number;
  ram?: number;
  allowedInTrial?: boolean;
  supportsAutoScaling?: boolean;
  supportsHighAvailability?: boolean;
  default?: boolean;
}

export class SashidoApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: number
  ) {
    super(message);
    this.name = 'SashidoApiError';
  }
}

/** What GET /tokens/current says about the access token */
export interface TokenInfo {
  id: string;
  name: string;
  scopes: string[];
  appIds: string[] | null;
  expiresAt: string | null;
  user: { objectId: string; username: string };
}

export interface BuildLog {
  buildId: string;
  number?: number;
  phase?: string;
  finished: boolean;
  text: string;
  truncated: boolean;
}

/**
 * The SashiDo API with a personal access token. The token's scopes decide
 * what each call may do; app keys are never returned to it.
 */
export class SashidoClient {
  private client: AxiosInstance;

  constructor(token: string, apiUrl: string = appConfig.sashido.apiUrl) {
    this.client = axios.create({
      baseURL: apiUrl,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    // the tool call this request belongs to, for the API's audit log
    this.client.interceptors.request.use((config) => {
      for (const [name, value] of Object.entries(auditHeaders())) {
        config.headers.set(name, value);
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<ApiError>) => {
        if (error.response) {
          const { status, data } = error.response;
          // the API answers {code, message}, a plain text message (errors
          // thrown in controllers) or, for invalid input, the fields
          const body = data as unknown;
          let message = error.message;
          if (typeof body === 'string' && body.trim()) {
            message = body.trim();
          } else if (data && typeof data.message === 'string') {
            message = data.message;
          } else if (body && typeof body === 'object') {
            message = `Invalid input: ${JSON.stringify(body)}`;
          }
          throw new SashidoApiError(message, status, data?.code);
        }
        throw new SashidoApiError(error.message, 500);
      }
    );
  }

  // SECURITY: Fields that are SAFE to expose (case-insensitive)
  private static readonly ALLOWED_FIELDS = new Set([
    'restapikey', 'restApiKey',
    'serverurl', 'serverUrl',
    'appid', 'appId',
    'clientkey', 'clientKey',
    'dotnetkey', 'dotNetKey',
    'filekey', 'fileKey',
    'javascriptkey', 'javascriptKey',
    's3_base_url', 's3BaseUrl',
  ].map(f => f.toLowerCase()));

  // SECURITY: List of sensitive field names to ALWAYS remove (case-insensitive)
  private static readonly SENSITIVE_FIELDS = new Set([
    'masterkey', 'webhookkey', 'serverkey',
    'databaseuri', 'mongodburl', 'database_uri', 'connectionstring',
    'database', 'mongodb',
    'bcdn_zone_id', 'bcdn_last_tracked_transfer',
    'gcm', 'gcmsenderid', 'gcmapikey',
    'firebase', 'firebaseconfig',
    'oauthgoogleclientid', 'oauthgoogleclientsecret', 'oauth',
    'privatekey', 'serviceaccount',
    'env', 'customdeploymentenv',
    'password', 'secret', 'credential',
    'accesskey', 'secretkey', 'authkey', 'encryptionkey',
    'limits', // deployment.limits
  ]);

  // SECURITY: Patterns that indicate sensitive data in field names
  private static readonly SENSITIVE_PATTERNS = [
    /^master/i, /secret/i, /password/i, /credential/i,
    /mongodb/i, /database/i, /connection/i,
    /firebase/i, /gcm/i, /oauth/i, /private/i, /encrypt/i,
    /^bcdn_/i,
  ];

  // SECURITY: Check if a field name indicates sensitive data
  private isSensitiveField(fieldName: string): boolean {
    const lowerName = fieldName.toLowerCase();

    // First check if it's explicitly allowed
    if (SashidoClient.ALLOWED_FIELDS.has(lowerName)) {
      return false;
    }

    // Check exact matches
    if (SashidoClient.SENSITIVE_FIELDS.has(lowerName)) {
      return true;
    }

    // Check patterns
    return SashidoClient.SENSITIVE_PATTERNS.some(pattern => pattern.test(fieldName));
  }

  // SECURITY: Deep sanitize any object, removing sensitive fields recursively
  private deepSanitize(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepSanitize(item));
    }

    if (typeof obj === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        // Skip sensitive fields entirely
        if (this.isSensitiveField(key)) {
          continue;
        }
        // Recursively sanitize nested objects
        sanitized[key] = this.deepSanitize(value);
      }
      return sanitized;
    }

    // For strings, check if it looks like a connection string
    if (typeof obj === 'string') {
      const str = obj as string;
      // Redact MongoDB connection strings
      if (str.startsWith('mongodb://') || str.startsWith('mongodb+srv://')) {
        return '[REDACTED_CONNECTION_STRING]';
      }
    }

    return obj;
  }

  // Apps - uses /users/info endpoint which returns apps under products.apps
  // SECURITY: Filters out sensitive credentials before returning
  async listApps(): Promise<App[]> {
    const response = await this.client.get<{
      data: {
        user: Record<string, unknown>;
        products: {
          apps: App[];
        };
      };
    }>('/users/info');

    // Deep sanitize each app to remove ALL sensitive data
    const apps = response.data.data.products.apps;
    return apps.map(app => this.deepSanitize(app) as App);
  }

  // Create App - POST /apps
  async createApp(data: {
    name: string;
    region?: string;
    parseServerVersion?: string;
  }): Promise<App> {
    const response = await this.client.post<App>('/apps', data);
    return response.data;
  }

  /** The account's activity (audit log), newest first */
  async listActivities(options: { type?: string; page?: number; pageSize?: number } = {}): Promise<Activity[]> {
    const path = options.type ? `/activities/${encodeURIComponent(options.type)}` : '/activities';
    const response = await this.client.get<{ data: Activity[] }>(path, {
      params: { page: options.page || 1, pageSize: options.pageSize || 50 },
    });
    // of the app only its id and name, whatever the API includes
    return response.data.data.map((a) => ({
      ...a,
      app: a.app ? { objectId: a.app.objectId, name: (a.app as { name?: string }).name } : undefined,
    }));
  }

  /** The app's deployments, newest first */
  async listDeployments(appObjectId: string, limit = 10): Promise<Deployment[]> {
    const response = await this.client.get<{ data: Deployment[] }>(
      `/apps/${encodeURIComponent(appObjectId)}/deployments`,
      { params: { limit } },
    );
    return response.data.data;
  }

  /** Parse Server versions apps may be created on or switched to */
  async listParseServerVersions(): Promise<ParseServerVersion[]> {
    const response = await this.client.get<{ data: ParseServerVersion[] }>(
      '/products/parse-server-versions',
    );
    return response.data.data;
  }

  /** Switches the app's Parse Server version; the API redeploys it */
  async changeParseServerVersion(appObjectId: string, imageTag: string): Promise<ParseServerVersion> {
    const response = await this.client.put<{ data: ParseServerVersion }>(
      `/apps/${encodeURIComponent(appObjectId)}/version`,
      { imageTag },
    );
    return response.data.data;
  }

  // Deploy App - POST /apps/{appObjectId}/deploy
  async deployApp(appObjectId: string, region?: string): Promise<void> {
    const params = region ? `?region=${encodeURIComponent(region)}` : '';
    await this.client.post(`/apps/${encodeURIComponent(appObjectId)}/deploy${params}`);
  }

  // Cancel Deployment - POST /apps/{appObjectId}/deploy/cancel
  async cancelDeployment(appObjectId: string, deploymentName: string, region?: string): Promise<void> {
    const params = region ? `?region=${encodeURIComponent(region)}` : '';
    await this.client.post(`/apps/${encodeURIComponent(appObjectId)}/deploy/cancel${params}`, { name: deploymentName });
  }

  // Get Active Deployment - GET /processes/{appObjectId}/latest-deployment
  // Returns the currently ACTIVE deployment (serving traffic)
  async getActiveDeployment(appObjectId: string): Promise<{
    deploymentName: string | null;
    deploymentNumber: number | null;
    processes: Record<string, unknown[]>;
  }> {
    const response = await this.client.get<Record<string, unknown[]>>(`/processes/${encodeURIComponent(appObjectId)}/latest-deployment`);
    const processes = response.data;

    let deploymentName: string | null = null;
    let deploymentNumber: number | null = null;

    // Extract deployment name from first hostname key
    // Hostname format: parse-server-deployment-24-pod123 -> deployment name: parse-server-deployment-24
    const hostnames = Object.keys(processes);

    if (hostnames.length > 0 && hostnames[0]) {
      const hostname = hostnames[0];
      // Remove last segment (pod ID) to get deployment name
      const lastDash = hostname.lastIndexOf('-');
      deploymentName = lastDash > 0 ? hostname.slice(0, lastDash) : hostname;

      // Extract deployment number from deployment name
      // parse-server-deployment-24 -> 24
      const match = deploymentName.match(/-(\d+)$/);
      if (match && match[1]) {
        deploymentNumber = parseInt(match[1], 10);
      }
    }

    return { deploymentName, deploymentNumber, processes };
  }

  // Get Running Deployment - the deployment currently being deployed (ACTIVE + 1)
  async getRunningDeployment(appObjectId: string): Promise<{
    deploymentName: string | null;
    deploymentNumber: number | null;
    activeDeploymentNumber: number | null;
  }> {
    const active = await this.getActiveDeployment(appObjectId);

    let deploymentName: string | null = null;
    let deploymentNumber: number | null = null;

    if (active.deploymentNumber !== null) {
      deploymentNumber = active.deploymentNumber + 1;
      deploymentName = `parse-server-deployment-${deploymentNumber}`;
    }

    return {
      deploymentName,
      deploymentNumber,
      activeDeploymentNumber: active.deploymentNumber,
    };
  }

  // Builds - GET /apps/{appObjectId}/builds
  async listBuilds(appObjectId: string, limit?: number): Promise<Build[]> {
    const params = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
    const response = await this.client.get<{ data: Build[] }>(`/apps/${encodeURIComponent(appObjectId)}/builds${params}`);
    return response.data.data;
  }

  // Trigger Build - POST /apps/{appObjectId}/build
  async triggerBuild(appObjectId: string, region?: string): Promise<void> {
    const params = region ? `?region=${encodeURIComponent(region)}` : '';
    await this.client.post(`/apps/${encodeURIComponent(appObjectId)}/build${params}`);
  }

  // Cancel Build - POST /apps/{appObjectId}/build/cancel
  async cancelBuild(appObjectId: string, buildName: string, region?: string): Promise<void> {
    const params = region ? `?region=${encodeURIComponent(region)}` : '';
    await this.client.post(`/apps/${encodeURIComponent(appObjectId)}/build/cancel${params}`, { name: buildName });
  }

  // Environment Variables - GET /apps/{appObjectId}/env
  async listEnvVars(appObjectId: string): Promise<EnvVariable[]> {
    const response = await this.client.get<{ data: EnvVariable[] }>(`/apps/${encodeURIComponent(appObjectId)}/env`);
    return response.data.data;
  }

  // Update Environment Variables - PUT /apps/{appObjectId}/env
  async updateEnvVars(appObjectId: string, env: EnvVariable[]): Promise<void> {
    await this.client.put(`/apps/${encodeURIComponent(appObjectId)}/env`, { env });
  }

  // Scale App - PUT /apps/{appObjectId}/scale
  async setScale(appObjectId: string, scale: ScaleConfig, region?: string): Promise<void> {
    const params = region ? `?region=${encodeURIComponent(region)}` : '';
    await this.client.put(`/apps/${encodeURIComponent(appObjectId)}/scale${params}`, scale);
  }

  // Update App Name - PUT /apps/{appObjectId}/name
  async updateAppName(appObjectId: string, name: string): Promise<void> {
    await this.client.put(`/apps/${encodeURIComponent(appObjectId)}/name`, { name });
  }

  // Set High Availability - PUT /apps/{appObjectId}/highAvailability
  async setHighAvailability(appObjectId: string, enabled: boolean): Promise<void> {
    await this.client.put(`/apps/${encodeURIComponent(appObjectId)}/highAvailability`, { enabled });
  }

  // List available Parse Server engines - GET /products/parse-server-engines
  async listEngines(): Promise<ParseServerEngine[]> {
    const response = await this.client.get<{ data: ParseServerEngine[] }>('/products/parse-server-engines');
    return response.data.data;
  }

  // Set engine for an app - PUT /apps/{appObjectId}/engine
  async setEngine(
    appObjectId: string,
    engineName: string,
    billingPolicy: 'monthly' | 'hourly',
    region?: string
  ): Promise<void> {
    const params = region ? `?region=${encodeURIComponent(region)}` : '';
    await this.client.put(`/apps/${encodeURIComponent(appObjectId)}/engine${params}`, {
      name: engineName,
      billingPolicy,
    });
  }

  // The access token: scopes, apps, expiry and user - GET /tokens/current
  async getTokenInfo(): Promise<TokenInfo> {
    const response = await this.client.get<{ data: TokenInfo }>('/tokens/current');
    return response.data.data;
  }

  // The last lines of a build's log - GET /apps/{id}/builds/{buildId}/log
  async getBuildLog(appObjectId: string, buildId: string, lines?: number): Promise<BuildLog> {
    const response = await this.client.get<{ data: BuildLog }>(
      `/apps/${encodeURIComponent(appObjectId)}/builds/${encodeURIComponent(buildId)}/log`,
      { params: lines ? { lines } : {} },
    );
    return response.data.data;
  }

  // Changes made through the API are recorded in the account's activity by
  // the API itself (the Parse proxy logs every write), so nothing is sent.
  async logActivity(
    activityType:
      | 'create_job'
      | 'delete_job'
      | 'run_job'
      | 'create_function_webhook'
      | 'update_function_webhook'
      | 'delete_function_webhook'
      | 'create_trigger_webhook'
      | 'update_trigger_webhook'
      | 'delete_trigger_webhook',
    _message: string
  ): Promise<void> {
    void activityType;
  }
}
