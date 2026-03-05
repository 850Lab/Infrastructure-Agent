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
    done_title: "System Ready",
    done_message: "Machine initialized and standing by.",
  },
  opportunity_engine: {
    started_title: "Opportunity Scan",
    started_message: "Scanning the market for opportunities\u2026",
    done_title: "Opportunities Ranked",
    done_message: "Today\u2019s call list is built and prioritized.",
  },
  dm_coverage: {
    started_title: "Contact Mapping",
    started_message: "Mapping decision makers\u2026",
    done_title: "Contacts Resolved",
    done_message: "Decision maker coverage is up to date.",
  },
  dm_fit: {
    started_title: "Buyer Selection",
    started_message: "Selecting the true operational buyer\u2026",
    done_title: "Buyers Identified",
    done_message: "Best-fit decision makers locked in.",
  },
  playbooks: {
    started_title: "Script Generation",
    started_message: "Generating scripts and follow-ups\u2026",
    done_title: "Playbooks Ready",
    done_message: "Call scripts and talking points are set.",
  },
  call_engine: {
    started_title: "Call Processing",
    started_message: "Processing call outcomes\u2026",
    done_title: "Calls Processed",
    done_message: "Call results logged and follow-ups scheduled.",
  },
  query_intel: {
    started_title: "Intel Engine",
    started_message: "Learning and evolving targeting\u2026",
    done_title: "Targeting Updated",
    done_message: "Search queries refined from latest results.",
  },
  lead_feed: {
    started_title: "Lead Expansion",
    started_message: "Expanding the lead universe\u2026",
    done_title: "Leads Refreshed",
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
