import { ToolContext, ToolServer } from "../../context.js";
import { z } from "zod";
import { SashidoClient } from "../../client/sashido.js";

// SECURITY: Patterns that indicate sensitive env var names
const SENSITIVE_PATTERNS = [
  /key/i,
  /secret/i,
  /password/i,
  /token/i,
  /credential/i,
  /api_key/i,
  /apikey/i,
  /private/i,
  /auth/i,
  /cert/i,
  /database/i,
  /mongodb/i,
  /postgres/i,
  /mysql/i,
  /redis/i,
  /aws/i,
  /azure/i,
  /gcp/i,
  /stripe/i,
  /twilio/i,
  /sendgrid/i,
];

function isSensitiveEnvVar(name: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(name));
}

function redactEnvVars(
  envVars: Array<{ name: string; value: string }>,
): Array<{ name: string; value: string }> {
  return envVars.map((env) => ({
    name: env.name,
    value: isSensitiveEnvVar(env.name) ? "[REDACTED]" : env.value,
  }));
}

export function registerEnvTools(server: ToolServer, ctx: ToolContext): void {
  const getAuthFromRequest = (_args?: unknown, _extra?: unknown): string => ctx.token;
  // List Environment Variables
  // SECURITY: Redacts values of sensitive env vars
  server.tool(
    "list_env_vars",
    "An app's environment variables (process.env in its cloud code). Values that look secret are redacted. Use it to check what the cloud code is configured with.",
    {
      appObjectId: z.string().describe("The application object ID"),
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      const envVars = await client.listEnvVars(args.appObjectId);

      // Redact sensitive values before returning
      const redactedEnvVars = redactEnvVars(envVars);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(redactedEnvVars, null, 2),
          },
        ],
      };
    },
  );

  // Set Environment Variable
  server.tool(
    "set_env_var",
    "Set or change an environment variable of an app (process.env in its cloud code), e.g. the key of a service the cloud code calls. The app is redeployed: follow with wait_for_deployment.",
    {
      appObjectId: z.string().describe("The application object ID"),
      name: z.string().describe("Environment variable name"),
      value: z.string().describe("Environment variable value"),
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      // Get current env vars
      const currentEnvVars = await client.listEnvVars(args.appObjectId);

      // Update or add the new variable
      const envIndex = currentEnvVars.findIndex((e) => e.name === args.name);
      if (envIndex >= 0) {
        currentEnvVars[envIndex] = { name: args.name, value: args.value };
      } else {
        currentEnvVars.push({ name: args.name, value: args.value });
      }

      await client.updateEnvVars(args.appObjectId, currentEnvVars);

      return {
        content: [
          {
            type: "text" as const,
            text: `Environment variable ${args.name} set successfully`,
          },
        ],
      };
    },
  );

  // Delete Environment Variable
  server.tool(
    "delete_env_var",
    "Remove an environment variable from an app. The app is redeployed, and cloud code that reads the variable gets undefined.",
    {
      appObjectId: z.string().describe("The application object ID"),
      name: z.string().describe("Environment variable name to delete"),
    },
    async (args, extra) => {
      const auth = getAuthFromRequest(args, extra);
      const client = new SashidoClient(auth);

      // Get current env vars and remove the specified one
      const currentEnvVars = await client.listEnvVars(args.appObjectId);
      const filteredEnvVars = currentEnvVars.filter(
        (e) => e.name !== args.name,
      );

      if (filteredEnvVars.length === currentEnvVars.length) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Environment variable ${args.name} not found`,
            },
          ],
        };
      }

      await client.updateEnvVars(args.appObjectId, filteredEnvVars);

      return {
        content: [
          {
            type: "text" as const,
            text: `Environment variable ${args.name} deleted successfully`,
          },
        ],
      };
    },
  );
}
