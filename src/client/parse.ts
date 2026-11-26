import axios, { AxiosError, AxiosInstance } from 'axios';
import { appConfig } from '../config.js';
import { auditHeaders } from '../audit.js';

export interface ParseSchema {
  className: string;
  fields: Record<string, { type: string; targetClass?: string }>;
  classLevelPermissions?: Record<string, unknown>;
  indexes?: Record<string, unknown>;
}

export interface ParseObject {
  objectId: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ParseQueryResult {
  results: ParseObject[];
  count?: number;
}

export interface ParseFile {
  name: string;
  url: string;
}

export interface CloudFunction {
  functionName: string;
}

export interface FunctionWebhook {
  functionName: string;
  url: string;
}

export interface TriggerWebhook {
  className: string;
  triggerName: string;
  url: string;
}

export interface AppCheck {
  id: string;
  title: string;
  state: 'ok' | 'warning' | 'fail' | 'error';
  message: string;
  solution?: string;
}

export interface AppChecks {
  state: string;
  checkedAt: string;
  summary: { total: number; ok: number; warning: number; fail: number; error: number };
  groups: Array<{ id: string; name: string; state: string; checks: AppCheck[] }>;
}

export type TriggerType =
  | 'beforeSave'
  | 'afterSave'
  | 'beforeDelete'
  | 'afterDelete'
  | 'beforeFind'
  | 'afterFind';

/**
 * The Parse Server of an app, through the SashiDo API's Parse proxy
 * (/apps/{appObjectId}/parse/...). The API adds the app's master key, checks
 * the access token's scopes and app limit, and strips app users' credentials
 * from responses: the master key never reaches this server or the AI client.
 */
const enc = encodeURIComponent;

// The SashiDo routes return { response: body } to Parse Server's
// PromiseRouter, which sends res.json(body): the body arrives unwrapped.
// Older code expected the wrapper; accept both.
function unwrap<T>(data: { response: T } | T): T {
  const wrapped = data as { response?: T };
  return wrapped && wrapped.response !== undefined ? (wrapped.response as T) : (data as T);
}

export class ParseClient {
  private client: AxiosInstance;

  constructor(token: string, appObjectId: string, apiUrl: string = appConfig.sashido.apiUrl) {
    this.client = axios.create({
      baseURL: `${apiUrl.replace(/\/+$/, '')}/apps/${encodeURIComponent(appObjectId)}/parse`,
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
    // say why a call failed: the API's message ({message}) or the app's
    // Parse Server error ({error}), not only the status code
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<{ message?: unknown; error?: unknown }>) => {
        if (error.response) {
          const data = error.response.data;
          const raw = data && (data.message || data.error);
          // cloud code may reject with an object
          const reason = raw && typeof raw !== 'string' ? JSON.stringify(raw) : raw;
          throw new Error(
            reason ? `${reason} (HTTP ${error.response.status})` : error.message,
          );
        }
        throw error;
      },
    );
  }

  // === SCHEMA / CLASSES ===

  async listClasses(): Promise<ParseSchema[]> {
    const response = await this.client.get<{ results: ParseSchema[] }>('/schemas');
    return response.data.results;
  }

  async getClass(className: string): Promise<ParseSchema> {
    const response = await this.client.get<ParseSchema>(`/schemas/${enc(className)}`);
    return response.data;
  }

  async createClass(className: string, fields?: Record<string, { type: string; targetClass?: string }>): Promise<ParseSchema> {
    const response = await this.client.post<ParseSchema>(`/schemas/${enc(className)}`, {
      className,
      fields: fields ?? {},
    });
    return response.data;
  }

  async deleteClass(className: string): Promise<void> {
    await this.client.delete(`/schemas/${enc(className)}`);
  }

  async addField(
    className: string,
    fieldName: string,
    fieldType: string,
    targetClass?: string
  ): Promise<ParseSchema> {
    const fieldDef: Record<string, unknown> = { type: fieldType };
    if (targetClass) {
      fieldDef['targetClass'] = targetClass;
    }

    const response = await this.client.put<ParseSchema>(`/schemas/${enc(className)}`, {
      fields: {
        [fieldName]: fieldDef,
      },
    });
    return response.data;
  }

  async deleteField(className: string, fieldName: string): Promise<ParseSchema> {
    const response = await this.client.put<ParseSchema>(`/schemas/${enc(className)}`, {
      fields: {
        [fieldName]: { __op: 'Delete' },
      },
    });
    return response.data;
  }

  // === CLASS LEVEL PERMISSIONS (CLP) ===

  async updateClassLevelPermissions(
    className: string,
    clp: Record<string, Record<string, boolean>>
  ): Promise<ParseSchema> {
    const response = await this.client.put<ParseSchema>(`/schemas/${enc(className)}`, {
      classLevelPermissions: clp,
    });
    return response.data;
  }

  // === OBJECTS ===

  async queryObjects(
    className: string,
    options?: {
      where?: Record<string, unknown>;
      limit?: number;
      skip?: number;
      order?: string;
      keys?: string;
      include?: string;
      count?: boolean;
    }
  ): Promise<ParseQueryResult> {
    const params: Record<string, string> = {};

    if (options?.where) {
      params['where'] = JSON.stringify(options.where);
    }
    if (options?.limit !== undefined) {
      params['limit'] = String(options.limit);
    }
    if (options?.skip !== undefined) {
      params['skip'] = String(options.skip);
    }
    if (options?.order) {
      params['order'] = options.order;
    }
    if (options?.keys) {
      params['keys'] = options.keys;
    }
    if (options?.include) {
      params['include'] = options.include;
    }
    if (options?.count) {
      params['count'] = '1';
    }

    const response = await this.client.get<ParseQueryResult>(`/classes/${enc(className)}`, { params });
    return response.data;
  }

  async getObject(className: string, objectId: string): Promise<ParseObject> {
    const response = await this.client.get<ParseObject>(`/classes/${enc(className)}/${enc(objectId)}`);
    return response.data;
  }

  async createObject(className: string, data: Record<string, unknown>): Promise<ParseObject> {
    const response = await this.client.post<ParseObject>(`/classes/${enc(className)}`, data);
    return response.data;
  }

  async updateObject(
    className: string,
    objectId: string,
    data: Record<string, unknown>
  ): Promise<ParseObject> {
    const response = await this.client.put<ParseObject>(`/classes/${enc(className)}/${enc(objectId)}`, data);
    return response.data;
  }

  async deleteObject(className: string, objectId: string): Promise<void> {
    await this.client.delete(`/classes/${enc(className)}/${enc(objectId)}`);
  }

  // === FILES ===

  async uploadFile(fileName: string, fileData: Buffer, contentType: string): Promise<ParseFile> {
    const response = await this.client.post<ParseFile>(`/files/${enc(fileName)}`, fileData, {
      headers: {
        'Content-Type': contentType,
      },
    });
    return response.data;
  }

  // === CLOUD FUNCTIONS ===

  async callCloudFunction(functionName: string, params?: Record<string, unknown>): Promise<unknown> {
    const response = await this.client.post(`/functions/${enc(functionName)}`, params ?? {});
    return response.data.result;
  }

  async listCloudFunctions(): Promise<string[]> {
    // Parse Server doesn't have a built-in endpoint to list cloud functions
    // This would need to be implemented via a custom cloud function or config
    // For now, return empty array - users can invoke functions by name
    return [];
  }

  // === CLOUD CODE FILES ===
  // SashiDo routes of the app servers: GET /releases/latest, GET /scripts/*

  async listCloudCodeFiles(): Promise<{
    userFiles: Array<{
      path: string;
      checksum: string;
    }>;
    cloudFiles: Array<{
      path: string;
      checksum: string;
    }>;
  }> {
    const response = await this.client.get<Record<string, unknown>>('/releases/latest');

    const data = response.data;

    // Helper to normalize file arrays - handles various possible formats
    const normalizeFiles = (files: unknown): Array<{ path: string; checksum: string }> => {
      // Handle object format: { "main.js": "checksum123", "functions.js": "checksum456" }
      if (files && typeof files === 'object' && !Array.isArray(files)) {
        return Object.entries(files as Record<string, unknown>).map(([path, checksum]) => ({
          path,
          checksum: typeof checksum === 'string' ? checksum : '',
        }));
      }

      // Handle array format
      if (!Array.isArray(files)) return [];
      return files.map((f: unknown) => {
        if (typeof f === 'string') {
          return { path: f, checksum: '' };
        }
        if (typeof f === 'object' && f !== null) {
          const obj = f as Record<string, unknown>;
          // Try various property names
          const path = obj.path || obj.name || obj.filename || obj.file || '';
          const checksum = obj.checksum || obj.hash || obj.md5 || '';
          return { path: String(path), checksum: String(checksum) };
        }
        return { path: '', checksum: '' };
      }).filter(f => f.path);
    };

    // Parse checksums - it may be a JSON string containing { cloud: {...}, public: {...} }
    let parsedChecksums: { cloud?: Record<string, string>; public?: Record<string, string> } = {};
    if (typeof data.checksums === 'string') {
      try {
        parsedChecksums = JSON.parse(data.checksums);
      } catch {
        // Ignore parse errors
      }
    } else if (data.checksums && typeof data.checksums === 'object') {
      parsedChecksums = data.checksums as typeof parsedChecksums;
    }

    // Try various possible response structures
    const cloudFiles = normalizeFiles(
      parsedChecksums.cloud || data.cloudFiles || data.cloud || data.scripts || data.cloudCode || []
    );
    const userFiles = normalizeFiles(
      parsedChecksums.public || data.userFiles || data.public || data.publicFiles || data.files || []
    );

    return { cloudFiles, userFiles };
  }

  async readCloudCodeFile(filePath: string): Promise<string> {
    // e.g. "main.js" or "cloud/main.js": the server reads it under cloud/
    const relative = filePath.replace(/^\/+/, '').replace(/^cloud\//, '');
    const segments = relative.split('/').filter(Boolean).map(enc).join('/');
    const response = await this.client.get<string>(`/scripts/${segments}`, {
      responseType: 'text',
      transformResponse: [(data) => data], // the file as it is
    });
    // the route returns { response: content }, which Parse Server's
    // PromiseRouter sends as res.json(content): a JSON string
    try {
      const parsed = JSON.parse(response.data);
      return typeof parsed === 'string' ? parsed : response.data;
    } catch {
      return response.data;
    }
  }

  // === PUSH NOTIFICATIONS ===

  async sendPush(data: {
    where?: Record<string, unknown>;
    channels?: string[];
    data: {
      alert?: string;
      badge?: number | string;
      sound?: string;
      [key: string]: unknown;
    };
    push_time?: string;
    expiration_time?: string;
    expiration_interval?: number;
  }): Promise<{ result: boolean }> {
    const response = await this.client.post<{ result: boolean }>('/push', data);
    return response.data;
  }

  // === PUSH AUDIENCES ===

  async listAudiences(limit?: number): Promise<{
    audiences: Array<{
      objectId: string;
      name: string;
      query: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
      lastUsed?: string;
      timesUsed: number;
    }>;
  }> {
    const response = await this.client.get<{
      response: {
        audiences: Array<{
          objectId: string;
          name: string;
          query: Record<string, unknown>;
          createdAt: string;
          updatedAt: string;
          lastUsed?: string;
          timesUsed: number;
        }>;
      };
    }>('/push_audience', { params: { limit: limit || 100 } });
    return { audiences: unwrap(response.data).audiences || [] };
  }

  async createAudience(name: string, query: Record<string, unknown>): Promise<{
    success: boolean;
    objectId: string;
  }> {
    const response = await this.client.put<{
      response: {
        success: boolean;
        new_audience: { objectId: string };
      };
    }>('/push_audience', { name, query });
    const body = unwrap(response.data);
    return {
      success: body.success,
      objectId: body.new_audience.objectId,
    };
  }

  async deleteAudience(objectId: string): Promise<{ success: boolean }> {
    const response = await this.client.delete<{
      response: { success: boolean };
    }>('/push_audience', { params: { objectId } });
    return unwrap(response.data);
  }

  async listAvailableDevices(): Promise<string[]> {
    const response = await this.client.get<{
      response: { available_devices: string[] };
    }>('/available_devices');
    return unwrap(response.data).available_devices || [];
  }

  // === CONFIG ===

  async getConfig(): Promise<Record<string, unknown>> {
    const response = await this.client.get<{ params: Record<string, unknown> }>('/config');
    return response.data.params;
  }

  async updateConfig(params: Record<string, unknown>): Promise<{ result: boolean }> {
    const response = await this.client.put<{ result: boolean }>('/config', { params });
    return response.data;
  }

  // === HEALTH ===

  /**
   * The app server's own production checks (Parse Server 6.5.11+): security,
   * users and sessions, database; each with what to change
   */
  async getAppChecks(): Promise<AppChecks> {
    const response = await this.client.get<AppChecks | { response: AppChecks }>('/app_checks');
    return unwrap(response.data);
  }

  async checkHealth(): Promise<{ status: string; [key: string]: unknown }> {
    const response = await this.client.get<{ status: string; [key: string]: unknown }>('/health');
    return response.data;
  }

  // === LOGS ===

  async getLogs(options?: {
    level?: 'info' | 'error' | 'warn' | 'debug';
    limit?: number;
  }): Promise<Array<{
    timestamp: string;
    level: string;
    message: string;
    [key: string]: unknown;
  }>> {
    const level = options?.level || 'info';
    const limit = options?.limit || 100;

    const response = await this.client.get<Array<{
      timestamp: string;
      level: string;
      message: string;
      [key: string]: unknown;
    }>>('/scriptlog', { params: { level, n: limit } });

    return response.data;
  }

  // === BACKGROUND JOBS ===
  // SashiDo routes of the app servers; they read their parameters from the
  // body, which the API's proxy takes care of (POST with _method)

  async listScheduledJobs(limit?: number): Promise<{
    jobs: Array<{
      objectId: string;
      name: string;
      description?: string;
      startAfter?: string;
      repeatInterval?: string;
      nextRunAt?: string;
      lastRunAt?: string;
      type?: string;
      data?: Record<string, unknown>;
      failReason?: string;
      failCount?: number;
    }>;
  }> {
    // Parse SDK-style request
    const response = await this.client.get<{
      jobs: Array<{
        objectId: string;
        name: string;
        description?: string;
        startAfter?: string;
        repeatInterval?: string;
        nextRunAt?: string;
        lastRunAt?: string;
        type?: string;
        data?: Record<string, unknown>;
        failReason?: string;
        failCount?: number;
      }>;
    }>('/job', { params: { limit: limit || 100 } });
    return { jobs: response.data.jobs || [] };
  }

  async listAvailableJobs(): Promise<{
    jobs: string[];
    inUse: string[];
  }> {
    const response = await this.client.get<{
      jobs: string[];
      in_use: string[];
    }>('/job/available');
    return {
      jobs: response.data.jobs || [],
      inUse: response.data.in_use || [],
    };
  }

  async getJobStatus(limit?: number): Promise<Array<{
    objectId: string;
    jobName: string;
    status: string;
    message?: string;
    createdAt: string;
    finishedAt?: string;
  }>> {
    return (await this.latestJobRuns({}, limit || 30)) as unknown as Array<{
      objectId: string;
      jobName: string;
      status: string;
      message?: string;
      createdAt: string;
      finishedAt?: string;
    }>;
  }

  /**
   * The newest job runs. Neither the app servers' GET /job/status (it reads
   * its limit from the body) nor sorting _JobStatus by createdAt works on
   * apps whose older runs stored createdAt as a Date and newer ones as a
   * string: Mongo sorts by type first. Runs are inserted in order, so take
   * the last ones and sort them here.
   */
  private async latestJobRuns(where: Record<string, unknown>, limit: number): Promise<ParseObject[]> {
    const counted = await this.queryObjects('_JobStatus', { where, limit: 0, count: true });
    const total = counted.count || 0;
    const window = Math.max(limit, 100);
    const page = await this.queryObjects('_JobStatus', {
      where,
      skip: Math.max(0, total - window),
      limit: window,
    });
    const time = (o: ParseObject) => Date.parse(String(o.createdAt)) || 0;
    return page.results.sort((a, b) => time(b) - time(a)).slice(0, limit);
  }

  async scheduleJob(params: {
    jobName: string;
    description?: string;
    startAfter: string; // ISO date string
    repeatMinutes?: number;
    params?: Record<string, unknown>;
    objectId?: string; // For updating existing job
  }): Promise<{ success: boolean; objectId: string }> {
    const response = await this.client.post<{
      success: boolean;
      objectId: string;
    }>('/job/schedule', {
      jobName: params.jobName,
      description: params.description,
      startAfter: params.startAfter,
      repeatMinutes: params.repeatMinutes,
      params: JSON.stringify(params.params || {}),
      objectId: params.objectId,
    });
    return response.data;
  }

  async deleteJob(objectId: string): Promise<{ success: boolean }> {
    const response = await this.client.delete<{
      success: boolean;
    }>('/job', { params: { objectId } });
    return response.data;
  }

  async runJob(jobName: string, params?: Record<string, unknown>): Promise<{
    statusId: string;
  }> {
    // Running a job uses the /jobs/:jobName endpoint
    const startedAt = Date.now();
    const response = await this.client.post<unknown>(`/jobs/${enc(jobName)}`, {
      jobName: jobName,
      description: 'Executing from MCP server.',
      input: params || {},
      when: 0, // 0 = run immediately
    });
    // Parse Server sends the run's id in X-Parse-Job-Status-Id; the API's
    // proxy doesn't forward it, so look up the newest run of the job
    const headers = (response.headers || {}) as Record<string, string | undefined>;
    let statusId = headers['x-parse-job-status-id'];
    if (!statusId) {
      // its record shows up a moment later; earlier runs don't count (10s
      // of leeway for the clocks of this machine and the app's)
      for (let attempt = 0; attempt < 5 && !statusId; attempt++) {
        if (attempt) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        const [latest] = await this.latestJobRuns({ jobName }, 1);
        if (latest && Date.parse(String(latest.createdAt)) >= startedAt - 10000) {
          statusId = latest.objectId;
        }
      }
    }
    return { statusId: statusId || 'unknown' };
  }

  // === WEBHOOKS - FUNCTIONS ===
  // Parse Server webhooks allow registering external URLs as cloud functions

  async listFunctionWebhooks(): Promise<FunctionWebhook[]> {
    const response = await this.client.get<FunctionWebhook[]>('/hooks/functions');
    return response.data || [];
  }

  async getFunctionWebhook(functionName: string): Promise<FunctionWebhook> {
    const response = await this.client.get<FunctionWebhook>(`/hooks/functions/${enc(functionName)}`);
    return response.data;
  }

  async createFunctionWebhook(functionName: string, url: string): Promise<FunctionWebhook> {
    const response = await this.client.post<FunctionWebhook>('/hooks/functions', {
      functionName,
      url,
    });
    return response.data;
  }

  async updateFunctionWebhook(functionName: string, url: string): Promise<FunctionWebhook> {
    const response = await this.client.put<FunctionWebhook>(`/hooks/functions/${enc(functionName)}`, {
      url,
    });
    return response.data;
  }

  async deleteFunctionWebhook(functionName: string): Promise<void> {
    await this.client.put(`/hooks/functions/${enc(functionName)}`, {
      __op: 'Delete',
    });
  }

  // === WEBHOOKS - TRIGGERS ===
  // Parse Server webhooks for class lifecycle events

  async listTriggerWebhooks(): Promise<TriggerWebhook[]> {
    const response = await this.client.get<TriggerWebhook[]>('/hooks/triggers');
    return response.data || [];
  }

  async getTriggerWebhook(className: string, triggerName: TriggerType): Promise<TriggerWebhook> {
    const response = await this.client.get<TriggerWebhook>(
      `/hooks/triggers/${enc(className)}/${enc(triggerName)}`
    );
    return response.data;
  }

  async createTriggerWebhook(
    className: string,
    triggerName: TriggerType,
    url: string
  ): Promise<TriggerWebhook> {
    const response = await this.client.post<TriggerWebhook>('/hooks/triggers', {
      className,
      triggerName,
      url,
    });
    return response.data;
  }

  async updateTriggerWebhook(
    className: string,
    triggerName: TriggerType,
    url: string
  ): Promise<TriggerWebhook> {
    const response = await this.client.put<TriggerWebhook>(
      `/hooks/triggers/${enc(className)}/${enc(triggerName)}`,
      { url }
    );
    return response.data;
  }

  async deleteTriggerWebhook(className: string, triggerName: TriggerType): Promise<void> {
    await this.client.put(`/hooks/triggers/${enc(className)}/${enc(triggerName)}`, {
      __op: 'Delete',
    });
  }
}
