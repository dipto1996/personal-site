export function workerFailureCategory(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (/resource guard|available ram|available vram|cpu load is above/.test(message)) return "resource_pressure";
  if (/fetch failed|network|econn|socket|timed?\s*out|abort|local model returned (?:429|5\d\d)|llama-server|model process exited/.test(message)) {
    return "infrastructure";
  }
  return "task_output";
}

export function isInfrastructureWorkerFailure(error) {
  return workerFailureCategory(error) === "infrastructure";
}

export function shouldRetryWorkerTask(task) {
  return Number(task?.attempt || 0) < 3;
}
