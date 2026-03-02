import { Mastra } from '@mastra/core';
import { MastraError } from '@mastra/core/error';
import { PinoLogger } from '@mastra/loggers';
import { MastraLogger, LogLevel } from '@mastra/core/logger';
import pino from 'pino';
import { Inngest, NonRetriableError } from 'inngest';
import { z } from 'zod';
import { PostgresStore } from '@mastra/pg';
import { realtimeMiddleware } from '@inngest/realtime/middleware';
import { init, serve } from '@mastra/inngest';
import { registerApiRoute as registerApiRoute$1 } from '@mastra/core/server';

"use strict";
const sharedPostgresStorage = new PostgresStore({
  id: "main-postgres-store",
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/mastra"
});

"use strict";
const inngest = new Inngest(
  process.env.NODE_ENV === "production" ? {
    id: "replit-agent-workflow",
    name: "Replit Agent Workflow System"
  } : {
    id: "mastra",
    baseUrl: "http://localhost:3000",
    isDev: true,
    middleware: [realtimeMiddleware()]
  }
);

"use strict";
const {
  createWorkflow: originalCreateWorkflow,
  createStep,
  cloneStep
} = init(inngest);
function createWorkflow(params) {
  return originalCreateWorkflow({
    ...params,
    retryConfig: {
      attempts: process.env.NODE_ENV === "production" ? 3 : 0,
      ...params.retryConfig ?? {}
    }
  });
}
const inngestFunctions = [];
function registerApiRoute(...args) {
  const [path, options] = args;
  if (typeof options !== "object") {
    return registerApiRoute$1(...args);
  }
  const pathWithoutSlash = path.replace(/^\/+/, "");
  const pathWithoutApi = pathWithoutSlash.startsWith("api/") ? pathWithoutSlash.substring(4) : pathWithoutSlash;
  let functionId;
  let eventName;
  if (pathWithoutApi.startsWith("webhooks/")) {
    functionId = `api-${pathWithoutApi.replaceAll(/\/+/g, "-")}`;
    eventName = `event/api.${pathWithoutApi.replaceAll(/\/+/g, ".")}`;
  } else {
    const connectorName = pathWithoutApi.split("/")[0];
    functionId = `api-${connectorName}`;
    eventName = `event/api.webhooks.${connectorName}.action`;
  }
  inngestFunctions.push(
    inngest.createFunction(
      {
        id: functionId,
        name: path
      },
      {
        event: eventName
      },
      async ({ event, step }) => {
        await step.run("forward request to Mastra", async () => {
          const headers = { ...event.data.headers ?? {} };
          if (event.data.runId) {
            headers["x-mastra-run-id"] = event.data.runId;
          }
          const response = await fetch(`http://localhost:5000${path}`, {
            method: event.data.method,
            headers,
            body: event.data.body
          });
          if (!response.ok) {
            if (response.status >= 500 && response.status < 600 || response.status == 429 || response.status == 408) {
              throw new Error(
                `Failed to forward request to Mastra: ${response.statusText}`
              );
            } else {
              throw new NonRetriableError(
                `Failed to forward request to Mastra: ${response.statusText}`
              );
            }
          }
        });
      }
    )
  );
  return registerApiRoute$1(...args);
}
function registerCronWorkflow(cronExpression, workflow) {
  console.log("\u{1F550} [registerCronWorkflow] Registering cron trigger", {
    cronExpression,
    workflowId: workflow?.id
  });
  const cronFunction = inngest.createFunction(
    { id: "cron-trigger" },
    [{ event: "replit/cron.trigger" }, { cron: cronExpression }],
    async ({ event, step }) => {
      return await step.run("execute-cron-workflow", async () => {
        console.log("\u{1F680} [Cron Trigger] Starting scheduled workflow execution", {
          workflowId: workflow?.id,
          scheduledTime: (/* @__PURE__ */ new Date()).toISOString(),
          cronExpression
        });
        try {
          const run = await workflow.createRun();
          console.log("\u{1F4DD} [Cron Trigger] Workflow run created", {
            runId: run?.runId
          });
          const result = await inngest.send({
            name: `workflow.${workflow.id}`,
            data: {
              runId: run?.runId,
              inputData: {}
            }
          });
          console.log("\u2705 [Cron Trigger] Invoked Inngest function", {
            workflowId: workflow?.id,
            runId: run?.runId
          });
          return result;
        } catch (error) {
          console.error("\u274C [Cron Trigger] Workflow execution failed", {
            workflowId: workflow?.id,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : void 0
          });
          throw error;
        }
      });
    }
  );
  inngestFunctions.push(cronFunction);
  console.log(
    "\u2705 [registerCronWorkflow] Cron trigger registered successfully",
    {
      cronExpression
    }
  );
}
function inngestServe({
  mastra,
  inngest: inngest2
}) {
  let serveHost = void 0;
  if (process.env.NODE_ENV === "production") {
    if (process.env.REPLIT_DOMAINS) {
      serveHost = `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`;
    }
  } else {
    serveHost = "http://localhost:5000";
  }
  return serve({
    mastra,
    inngest: inngest2,
    functions: inngestFunctions,
    registerOptions: { serveHost }
  });
}

"use strict";
class ProductionPinoLogger extends MastraLogger {
  logger;
  constructor(options = {}) {
    super(options);
    this.logger = pino({
      name: options.name || "app",
      level: options.level || LogLevel.INFO,
      base: {},
      formatters: {
        level: (label, _number) => ({
          level: label
        })
      },
      timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`
    });
  }
  debug(message, args = {}) {
    this.logger.debug(args, message);
  }
  info(message, args = {}) {
    this.logger.info(args, message);
  }
  warn(message, args = {}) {
    this.logger.warn(args, message);
  }
  error(message, args = {}) {
    this.logger.error(args, message);
  }
}
const mastra = new Mastra({
  storage: sharedPostgresStorage,
  // Register your workflows here
  workflows: {},
  // Register your agents here
  agents: {},
  bundler: {
    // A few dependencies are not properly picked up by
    // the bundler if they are not added directly to the
    // entrypoint.
    externals: ["@slack/web-api", "inngest", "inngest/hono", "hono", "hono/streaming"],
    // sourcemaps are good for debugging.
    sourcemap: true
  },
  server: {
    host: "0.0.0.0",
    port: 5e3,
    middleware: [async (c, next) => {
      const mastra2 = c.get("mastra");
      const logger = mastra2?.getLogger();
      logger?.debug("[Request]", {
        method: c.req.method,
        url: c.req.url
      });
      try {
        await next();
      } catch (error) {
        logger?.error("[Response]", {
          method: c.req.method,
          url: c.req.url,
          error
        });
        if (error instanceof MastraError) {
          if (error.id === "AGENT_MEMORY_MISSING_RESOURCE_ID") {
            throw new NonRetriableError(error.message, {
              cause: error
            });
          }
        } else if (error instanceof z.ZodError) {
          throw new NonRetriableError(error.message, {
            cause: error
          });
        }
        throw error;
      }
    }],
    apiRoutes: [
      // ======================================================================
      // Inngest Integration Endpoint
      // ======================================================================
      // Integrates Mastra workflows with Inngest for event-driven execution via inngest functions.
      {
        path: "/api/inngest",
        method: "ALL",
        createHandler: async ({
          mastra: mastra2
        }) => inngestServe({
          mastra: mastra2,
          inngest
        })
      }
      // Add webhook triggers here (see Option 2 above)
      // Example: ...registerSlackTrigger({ ... })
    ]
  },
  logger: process.env.NODE_ENV === "production" ? new ProductionPinoLogger({
    name: "Mastra",
    level: "info"
  }) : new PinoLogger({
    name: "Mastra",
    level: "info"
  })
});
if (Object.keys(mastra.listWorkflows()).length > 1) {
  throw new Error("More than 1 workflows found. Currently, more than 1 workflows are not supported in the UI, since doing so will cause app state to be inconsistent.");
}
if (Object.keys(mastra.listAgents()).length > 1) {
  throw new Error("More than 1 agents found. Currently, more than 1 agents are not supported in the UI, since doing so will cause app state to be inconsistent.");
}

export { mastra };
