export function workerFailureCategory(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (/resource guard|available ram|available vram|cpu load is above|gpu temperature/.test(message)) return "resource_pressure";
  if (/fetch failed|network|econn|socket|timed?\s*out|abort|local model returned (?:429|5\d\d)|llama-server|model process exited/.test(message)) {
    return "infrastructure";
  }
  return "task_output";
}

export function resolveThermalCycleState(state, {
  now = Date.now(),
  activeMs = 120 * 60_000,
  cooldownMs = 60 * 60_000,
} = {}) {
  const phase = state?.phase;
  const until = new Date(state?.until || 0).getTime();
  if (phase === "active" && Number.isFinite(until) && until > now) return { phase, until };
  if (phase === "cooldown" && Number.isFinite(until) && until > now) return { phase, until };
  if (phase === "active") return { phase: "cooldown", until: now + cooldownMs };
  return { phase: "active", until: now + activeMs };
}

export function isInfrastructureWorkerFailure(error) {
  return workerFailureCategory(error) === "infrastructure";
}

export function shouldRetryWorkerTask(task) {
  return Number(task?.attempt || 0) < 3;
}
