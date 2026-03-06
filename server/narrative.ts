import type { EventType } from "./events";

export type Severity = "info" | "success" | "warn" | "error";

export interface NarrativeEvent {
  raw_type: EventType;
  raw_step?: string;
  raw_trigger?: string;
  human_title: string;
  human_message: string;
  severity: Severity;
  ts: number;
}

interface StepNarrative {
  started_title: string;
  started_message: string;
  done_title: string;
  done_message: string;
}

const STEP_NARRATIVES: Record<string, StepNarrative> = {
  bootstrap: {
    started_title: "System Boot",
    started_message: "Initializing your machine\u2026",
    done_title: "System Online",
    done_message: "Machine initialized. All systems nominal.",
  },
  opportunity_engine: {
    started_title: "Market Scanner",
    started_message: "Scanning territory for high-value targets\u2026",
    done_title: "Targets Acquired",
    done_message: "Today\u2019s call list is built and prioritized.",
  },
  dm_coverage: {
    started_title: "Decision Maker Mapping",
    started_message: "Identifying the people who sign contracts\u2026",
    done_title: "Decision Makers Mapped",
    done_message: "Key contacts identified and linked to targets.",
  },
  dm_fit: {
    started_title: "Buyer Selection",
    started_message: "Selecting the true operational buyer\u2026",
    done_title: "Buyers Locked In",
    done_message: "Best-fit decision makers confirmed.",
  },
  playbooks: {
    started_title: "Script Generation",
    started_message: "Writing custom scripts for today\u2019s targets\u2026",
    done_title: "Scripts Ready",
    done_message: "Scripts refreshed for today\u2019s targets.",
  },
  call_engine: {
    started_title: "Signal Processing",
    started_message: "Processing field signals from today\u2019s calls\u2026",
    done_title: "Signals Processed",
    done_message: "Call outcomes absorbed. Targeting will improve.",
  },
  query_intel: {
    started_title: "Learning Engine",
    started_message: "Machine is evolving its search patterns\u2026",
    done_title: "Machine Evolved",
    done_message: "New search queries generated from field data.",
  },
  lead_feed: {
    started_title: "Lead Expansion",
    started_message: "Expanding the target universe\u2026",
    done_title: "Pipeline Expanded",
    done_message: "Fresh companies added to the pipeline.",
  },
};

function getStepNarrative(step: string): StepNarrative {
  return STEP_NARRATIVES[step] || {
    started_title: step.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    started_message: `Running ${step.replace(/_/g, " ")}\u2026`,
    done_title: step.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    done_message: `${step.replace(/_/g, " ")} complete.`,
  };
}

export function toNarrative(type: EventType, payload: Record<string, any>): NarrativeEvent {
  const ts = payload.ts ?? Date.now();
  const step = payload.step as string | undefined;
  const trigger = payload.trigger as string | undefined;

  switch (type) {
    case "RUN_STARTED":
      return {
        raw_type: type,
        human_title: "Engine Started",
        human_message: "Daily pipeline is now running.",
        severity: "info",
        ts,
      };

    case "RUN_DONE": {
      const isError = payload.status === "error";
      return {
        raw_type: type,
        human_title: isError ? "Run Failed" : "Run Complete",
        human_message: isError
          ? `Pipeline finished with errors: ${payload.message || "check logs"}`
          : "All steps finished successfully.",
        severity: isError ? "error" : "success",
        ts,
      };
    }

    case "STEP_STARTED": {
      const n = getStepNarrative(step || "");
      return {
        raw_type: type,
        raw_step: step,
        human_title: n.started_title,
        human_message: n.started_message,
        severity: "info",
        ts,
      };
    }

    case "STEP_DONE": {
      const n = getStepNarrative(step || "");
      const hasError = payload.status === "error";
      return {
        raw_type: type,
        raw_step: step,
        human_title: hasError ? `${n.done_title} \u2014 Error` : n.done_title,
        human_message: hasError
          ? `${n.done_title} encountered an error.`
          : n.done_message,
        severity: hasError ? "warn" : "success",
        ts,
      };
    }

    case "TRIGGER_FIRED":
      return {
        raw_type: type,
        raw_trigger: trigger,
        human_title: "Trigger Fired",
        human_message: trigger
          ? `Trigger activated: ${trigger.replace(/_/g, " ")}`
          : "A trigger was activated.",
        severity: "info",
        ts,
      };

    case "ERROR":
      return {
        raw_type: type,
        raw_step: step,
        human_title: "Error Detected",
        human_message: payload.message || "An unexpected error occurred.",
        severity: "error",
        ts,
      };

    case "HEARTBEAT":
      return {
        raw_type: type,
        human_title: "Heartbeat",
        human_message: "System alive.",
        severity: "info",
        ts,
      };

    default:
      return {
        raw_type: type,
        human_title: type,
        human_message: JSON.stringify(payload),
        severity: "info",
        ts,
      };
  }
}
