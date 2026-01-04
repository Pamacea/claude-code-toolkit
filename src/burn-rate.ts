/**
 * Burn Rate Tracker - Active token consumption monitoring
 *
 * Tracks token consumption rate and injects warnings when
 * the session becomes too heavy.
 */

import * as fs from "fs";
import { getRagPath, ensureRagDir } from "./paths.js";
import { loadBudget, type ReadBudget } from "./read-optimizer.js";

export interface BurnRateData {
  sessionId: string;
  startedAt: number;
  samples: BurnRateSample[];
  alerts: BurnRateAlert[];
  config: BurnRateConfig;
}

export interface BurnRateSample {
  timestamp: number;
  consumed: number;
  delta: number;
  elapsed: number;
  rate: number;
}

export interface BurnRateAlert {
  timestamp: number;
  type: "warning" | "critical" | "exceeded";
  message: string;
  rate: number;
  percentUsed: number;
}

export interface BurnRateConfig {
  warningThreshold: number;
  criticalThreshold: number;
  sampleInterval: number;
  maxSamples: number;
}

const DEFAULT_CONFIG: BurnRateConfig = {
  warningThreshold: 0.6,
  criticalThreshold: 0.8,
  sampleInterval: 60000,
  maxSamples: 100,
};

/**
 * Create new burn rate tracker
 */
export function createBurnRateTracker(sessionId: string): BurnRateData {
  return {
    sessionId,
    startedAt: Date.now(),
    samples: [],
    alerts: [],
    config: { ...DEFAULT_CONFIG },
  };
}

/**
 * Load burn rate data
 */
export function loadBurnRate(rootDir: string): BurnRateData | null {
  const filePath = getRagPath(rootDir, "BURN_RATE");
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as BurnRateData;
  } catch {
    return null;
  }
}

/**
 * Save burn rate data
 */
export function saveBurnRate(rootDir: string, data: BurnRateData): void {
  ensureRagDir(rootDir);
  const filePath = getRagPath(rootDir, "BURN_RATE");
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Record a burn rate sample
 */
export function recordBurnRateSample(
  data: BurnRateData,
  budget: ReadBudget
): BurnRateSample {
  const now = Date.now();
  const elapsed = now - data.startedAt;
  const lastSample = data.samples[data.samples.length - 1];
  const delta = lastSample ? budget.consumed - lastSample.consumed : budget.consumed;
  const timeDelta = lastSample ? now - lastSample.timestamp : elapsed;
  const rate = timeDelta > 0 ? (delta / timeDelta) * 60000 : 0;

  const sample: BurnRateSample = {
    timestamp: now,
    consumed: budget.consumed,
    delta,
    elapsed,
    rate,
  };

  data.samples.push(sample);

  if (data.samples.length > data.config.maxSamples) {
    data.samples = data.samples.slice(-data.config.maxSamples);
  }

  return sample;
}

/**
 * Calculate current burn rate (tokens per minute)
 */
export function calculateBurnRate(data: BurnRateData): number {
  if (data.samples.length < 2) return 0;

  const recentSamples = data.samples.slice(-10);
  const totalDelta = recentSamples.reduce((sum, s) => sum + s.delta, 0);
  const timeSpan = recentSamples[recentSamples.length - 1].timestamp - recentSamples[0].timestamp;

  if (timeSpan === 0) return 0;
  return (totalDelta / timeSpan) * 60000;
}

/**
 * Calculate estimated time to budget exhaustion
 */
export function estimateTimeToExhaustion(
  data: BurnRateData,
  budget: ReadBudget
): number | null {
  const rate = calculateBurnRate(data);
  if (rate <= 0) return null;

  const remaining = budget.totalBudget - budget.consumed;
  return remaining / rate;
}

/**
 * Check burn rate and generate alerts
 */
export function checkBurnRate(
  rootDir: string,
  data: BurnRateData,
  budget: ReadBudget
): BurnRateAlert | null {
  const percentUsed = budget.consumed / budget.totalBudget;
  const rate = calculateBurnRate(data);

  const recentAlert = data.alerts[data.alerts.length - 1];
  const alertCooldown = 5 * 60 * 1000;

  if (recentAlert && Date.now() - recentAlert.timestamp < alertCooldown) {
    return null;
  }

  let alert: BurnRateAlert | null = null;

  if (percentUsed >= data.config.criticalThreshold) {
    alert = {
      timestamp: Date.now(),
      type: "critical",
      message: generateCriticalMessage(percentUsed, rate, budget),
      rate,
      percentUsed: Math.round(percentUsed * 100),
    };
  } else if (percentUsed >= data.config.warningThreshold) {
    alert = {
      timestamp: Date.now(),
      type: "warning",
      message: generateWarningMessage(percentUsed, rate, budget),
      rate,
      percentUsed: Math.round(percentUsed * 100),
    };
  }

  if (alert) {
    data.alerts.push(alert);
    saveBurnRate(rootDir, data);
  }

  return alert;
}

/**
 * Generate warning message
 */
function generateWarningMessage(
  percentUsed: number,
  rate: number,
  budget: ReadBudget
): string {
  const percent = Math.round(percentUsed * 100);

  return `⚠️ Session lourde détectée (${percent}% utilisé)
📊 Budget: ${budget.consumed.toLocaleString()}/${budget.totalBudget.toLocaleString()} tokens
🔥 Burn rate: ~${Math.round(rate)} tokens/min
💡 Conseil: Utilise \`rag:checkpoint\` puis \`/new\` pour reset le quota.`;
}

/**
 * Generate critical message
 */
function generateCriticalMessage(
  percentUsed: number,
  rate: number,
  budget: ReadBudget
): string {
  const percent = Math.round(percentUsed * 100);

  return `🔴 ALERTE CRITIQUE: Budget à ${percent}%!
📊 Consommé: ${budget.consumed.toLocaleString()}/${budget.totalBudget.toLocaleString()} tokens
🔥 Burn rate: ~${Math.round(rate)} tokens/min
⚡ ACTION REQUISE: Exécute immédiatement:
   1. pnpm rag:checkpoint
   2. /new (nouvelle session)
   3. Colle le checkpoint`;
}

/**
 * Format burn rate report
 */
export function formatBurnRateReport(data: BurnRateData, budget: ReadBudget): string {
  const rate = calculateBurnRate(data);
  const timeToExhaustion = estimateTimeToExhaustion(data, budget);
  const elapsed = Date.now() - data.startedAt;
  const elapsedMinutes = Math.round(elapsed / 60000);
  const percentUsed = Math.round((budget.consumed / budget.totalBudget) * 100);

  let output = "\n🔥 Burn Rate Report\n\n";

  output += `Session: ${data.sessionId}\n`;
  output += `Durée: ${elapsedMinutes} minutes\n`;
  output += `Budget: ${percentUsed}% utilisé (${budget.consumed.toLocaleString()}/${budget.totalBudget.toLocaleString()})\n\n`;

  output += `📈 Burn Rate: ${Math.round(rate)} tokens/min\n`;

  if (timeToExhaustion !== null) {
    const minutesLeft = Math.round(timeToExhaustion);
    if (minutesLeft < 60) {
      output += `⏱️ Temps estimé avant épuisement: ${minutesLeft} minutes\n`;
    } else {
      output += `⏱️ Temps estimé avant épuisement: ${Math.round(minutesLeft / 60)}h ${minutesLeft % 60}min\n`;
    }
  }

  output += "\n";

  if (data.samples.length > 0) {
    output += "📊 Derniers échantillons:\n";
    for (const sample of data.samples.slice(-5)) {
      const time = new Date(sample.timestamp).toLocaleTimeString();
      output += `  ${time}: +${sample.delta} tokens (${Math.round(sample.rate)}/min)\n`;
    }
  }

  if (data.alerts.length > 0) {
    output += "\n⚠️ Alertes récentes:\n";
    for (const alert of data.alerts.slice(-3)) {
      const time = new Date(alert.timestamp).toLocaleTimeString();
      output += `  ${time}: [${alert.type}] ${alert.percentUsed}%\n`;
    }
  }

  const healthStatus = getHealthStatus(percentUsed);
  output += `\n${healthStatus.icon} Status: ${healthStatus.label}\n`;

  return output;
}

/**
 * Get health status based on percentage
 */
function getHealthStatus(percentUsed: number): { icon: string; label: string } {
  if (percentUsed >= 80) return { icon: "🔴", label: "Critical - Checkpoint recommandé" };
  if (percentUsed >= 60) return { icon: "🟡", label: "Warning - Surveiller la consommation" };
  if (percentUsed >= 40) return { icon: "🟢", label: "Good - Consommation normale" };
  return { icon: "💚", label: "Excellent - Budget confortable" };
}

/**
 * Initialize burn rate tracking for current session
 */
export function initBurnRateTracking(rootDir: string): BurnRateData {
  const budget = loadBudget(rootDir);
  const sessionId = budget?.sessionId || `burn_${Date.now()}`;

  let data = loadBurnRate(rootDir);

  if (!data || data.sessionId !== sessionId) {
    data = createBurnRateTracker(sessionId);
    saveBurnRate(rootDir, data);
  }

  return data;
}

/**
 * Track and check burn rate
 */
export function trackBurnRate(rootDir: string): {
  sample: BurnRateSample | null;
  alert: BurnRateAlert | null;
} {
  const budget = loadBudget(rootDir);
  if (!budget) return { sample: null, alert: null };

  let data = loadBurnRate(rootDir);
  if (!data) {
    data = initBurnRateTracking(rootDir);
  }

  const sample = recordBurnRateSample(data, budget);
  const alert = checkBurnRate(rootDir, data, budget);

  saveBurnRate(rootDir, data);

  return { sample, alert };
}
