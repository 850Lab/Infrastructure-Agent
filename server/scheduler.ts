import { log } from "./logger";
import { startDailyRun, isRunActive, RunAlreadyActiveError } from "./run-daily-web";
import { storage } from "./storage";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30 * 1000;

let schedulerTimer: NodeJS.Timeout | null = null;
let isSchedulerRunning = false;
let lastScheduledRun: number | null = null;
let currentIntervalMs = DEFAULT_INTERVAL_MS;

async function runAllActiveClients(): Promise<void> {
  if (isRunActive()) {
    log("Scheduler: skipping — a run is already active", "scheduler");
    return;
  }

  try {
    const allClients = await storage.getAllClients();
    const activeClients = allClients.filter(c => c.status === "active");

    if (activeClients.length === 0) {
      log("Scheduler: no active clients found, skipping", "scheduler");
      return;
    }

    log(`Scheduler: starting runs for ${activeClients.length} active client(s)`, "scheduler");

    for (const client of activeClients) {
      if (isRunActive()) {
        log(`Scheduler: waiting for current run to finish before starting ${client.clientName}...`, "scheduler");
        await waitForRunComplete();
      }

      try {
        log(`Scheduler: starting pipeline for ${client.clientName} (${client.id})`, "scheduler");
        startDailyRun({ clientId: client.id, top: 25 });
        lastScheduledRun = Date.now();
        await waitForRunComplete();
        log(`Scheduler: completed pipeline for ${client.clientName}`, "scheduler");
      } catch (err: any) {
        if (err instanceof RunAlreadyActiveError) {
          log(`Scheduler: run already active, waiting...`, "scheduler");
          await waitForRunComplete();
        } else {
          log(`Scheduler: error running ${client.clientName}: ${err.message}`, "scheduler");
        }
      }
    }

    log("Scheduler: all client runs complete", "scheduler");
  } catch (err: any) {
    log(`Scheduler: error in scheduled run cycle: ${err.message}`, "scheduler");
  }
}

async function waitForRunComplete(timeoutMs = 30 * 60 * 1000): Promise<void> {
  const start = Date.now();
  while (isRunActive() && Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 10000));
  }
}

export function startScheduler(intervalMs?: number): void {
  if (isSchedulerRunning) {
    log("Scheduler: already running", "scheduler");
    return;
  }

  currentIntervalMs = Math.max(intervalMs || DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS);
  const hours = (currentIntervalMs / (60 * 60 * 1000)).toFixed(1);
  log(`Scheduler: starting with ${hours}h interval (first run in ${STARTUP_DELAY_MS / 1000}s)`, "scheduler");

  isSchedulerRunning = true;

  setTimeout(async () => {
    log("Scheduler: executing first scheduled run", "scheduler");
    await runAllActiveClients();
    schedulerTimer = setInterval(async () => {
      log("Scheduler: executing scheduled run cycle", "scheduler");
      await runAllActiveClients();
    }, currentIntervalMs);
  }, STARTUP_DELAY_MS);
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  isSchedulerRunning = false;
  log("Scheduler: stopped", "scheduler");
}

export function getSchedulerStatus(): {
  running: boolean;
  intervalMs: number;
  intervalHours: number;
  lastRun: number | null;
  nextRunEstimate: number | null;
} {
  return {
    running: isSchedulerRunning,
    intervalMs: currentIntervalMs,
    intervalHours: Math.round(currentIntervalMs / (60 * 60 * 1000) * 10) / 10,
    lastRun: lastScheduledRun,
    nextRunEstimate: lastScheduledRun ? lastScheduledRun + currentIntervalMs : null,
  };
}
