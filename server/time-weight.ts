import { getIndustryConfig } from "./config";

const DEFAULT_DECAY_CONSTANT = 60;

export function getDecayConstant(): number {
  try {
    const cfg = getIndustryConfig();
    return (cfg as any).decay_constant ?? DEFAULT_DECAY_CONSTANT;
  } catch {
    return DEFAULT_DECAY_CONSTANT;
  }
}

export function getTimeWeight(date: string | Date | null | undefined, decayConstant?: number): number {
  if (!date) return 1;

  const eventTime = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  if (isNaN(eventTime)) return 1;

  const now = Date.now();
  const daysSince = Math.max(0, (now - eventTime) / (1000 * 60 * 60 * 24));

  const decay = decayConstant ?? getDecayConstant();
  return Math.exp(-daysSince / decay);
}

export function getWeightedValue(baseValue: number, date: string | Date | null | undefined, decayConstant?: number): number {
  return baseValue * getTimeWeight(date, decayConstant);
}

export function getSignalAge(date: string | Date | null | undefined): "recent" | "mid" | "historical" {
  if (!date) return "historical";

  const eventTime = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  if (isNaN(eventTime)) return "historical";

  const daysSince = (Date.now() - eventTime) / (1000 * 60 * 60 * 24);
  if (daysSince <= 30) return "recent";
  if (daysSince <= 90) return "mid";
  return "historical";
}
