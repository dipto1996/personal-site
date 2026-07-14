#!/usr/bin/env node

import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIB = 1024 ** 3;

export const WINDOWS_GPU_TEMPERATURE_LIMITS = Object.freeze({
  startup: 60,
  task: 68,
  runtime: 68,
});

const inventoryScript = String.raw`
$os=Get-CimInstance Win32_OperatingSystem
$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1
$disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$nvidia=$null
if(Get-Command nvidia-smi -ErrorAction SilentlyContinue){
  $line=nvidia-smi --query-gpu=name,memory.total,memory.free,utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>$null | Select-Object -First 1
  if($line){
    $parts=$line -split ',' | ForEach-Object { $_.Trim() }
    $nvidia=[pscustomobject]@{name=$parts[0];totalVramMiB=[int]$parts[1];freeVramMiB=[int]$parts[2];utilizationPercent=[int]$parts[3];temperatureCelsius=[int]$parts[4]}
  }
}
[pscustomobject]@{
  windows=[pscustomobject]@{caption=$os.Caption;version=$os.Version;build=$os.BuildNumber}
  cpu=[pscustomobject]@{name=$cpu.Name;cores=$cpu.NumberOfCores;logicalProcessors=$cpu.NumberOfLogicalProcessors;loadPercent=$cpu.LoadPercentage}
  memory=[pscustomobject]@{totalBytes=[uint64]$os.TotalVisibleMemorySize*1KB;availableBytes=[uint64]$os.FreePhysicalMemory*1KB}
  disk=[pscustomobject]@{drive='C:';freeBytes=[uint64]$disk.FreeSpace;sizeBytes=[uint64]$disk.Size}
  nvidia=$nvidia
} | ConvertTo-Json -Depth 5 -Compress
`;

export async function inspectWindowsResources() {
  const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", inventoryScript], {
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout.trim());
}

export function assertApprovedWindowsModel(value) {
  const model = String(value || "");
  if (/qwen3[^\n]*14b|14b[^\n]*qwen3/i.test(model)) throw new Error("Qwen3-14B is prohibited on this worker.");
  if (!/qwen3[-_. ]?4b/i.test(model)) throw new Error("This Windows host is approved only for Qwen3-4B Q4_K_M.");
  if (!/q4[_-]?k[_-]?m/i.test(model)) throw new Error("The approved quantization is Q4_K_M.");
  return true;
}

export function evaluateResourceGuard(inventory, { phase = "task" } = {}) {
  const minimumAvailable = phase === "startup" ? 6 * GIB : phase === "runtime" ? 2.5 * GIB : 4 * GIB;
  const reasons = [];
  if ((inventory.memory?.totalBytes || 0) < 14 * GIB) reasons.push("At least 14 GiB total RAM is required.");
  if ((inventory.memory?.availableBytes || 0) < minimumAvailable) {
    reasons.push(`At least ${minimumAvailable / GIB} GiB available RAM is required for ${phase}.`);
  }
  if ((inventory.disk?.freeBytes || 0) < 10 * GIB) reasons.push("At least 10 GiB free disk space is required.");
  if ((inventory.cpu?.loadPercent || 0) > 85) reasons.push("CPU load is above 85 percent.");
  if (phase === "startup" && inventory.nvidia && inventory.nvidia.freeVramMiB < 4000) {
    reasons.push("At least 4000 MiB free NVIDIA VRAM is required before model startup.");
  }
  const maximumGpuTemperature = WINDOWS_GPU_TEMPERATURE_LIMITS[phase]
    ?? WINDOWS_GPU_TEMPERATURE_LIMITS.task;
  if (inventory.nvidia?.temperatureCelsius >= maximumGpuTemperature) {
    reasons.push(`GPU temperature is ${inventory.nvidia.temperatureCelsius} C; maximum for ${phase} is ${maximumGpuTemperature} C.`);
  }
  return {
    ok: reasons.length === 0,
    phase,
    reasons,
    summary: {
      totalRamGiB: Number(((inventory.memory?.totalBytes || 0) / GIB).toFixed(2)),
      availableRamGiB: Number(((inventory.memory?.availableBytes || 0) / GIB).toFixed(2)),
      freeDiskGiB: Number(((inventory.disk?.freeBytes || 0) / GIB).toFixed(2)),
      gpu: inventory.nvidia?.name || "none",
      totalVramMiB: inventory.nvidia?.totalVramMiB || 0,
      freeVramMiB: inventory.nvidia?.freeVramMiB || 0,
      gpuTemperatureCelsius: inventory.nvidia?.temperatureCelsius ?? null,
      maximumGpuTemperatureCelsius: maximumGpuTemperature,
      cpuLoadPercent: inventory.cpu?.loadPercent || 0,
    },
  };
}

export async function assertResourcesSafe(options) {
  const inventory = await inspectWindowsResources();
  const evaluation = evaluateResourceGuard(inventory, options);
  if (!evaluation.ok) {
    const error = new Error(`Windows resource guard blocked ${evaluation.phase}: ${evaluation.reasons.join(" ")}`);
    error.inventory = inventory;
    error.evaluation = evaluation;
    throw error;
  }
  return { inventory, evaluation };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const phase = process.argv.includes("--startup") ? "startup" : "task";
  const inventory = await inspectWindowsResources();
  const evaluation = evaluateResourceGuard(inventory, { phase });
  process.stdout.write(`${JSON.stringify({ inventory, evaluation }, null, 2)}\n`);
  process.exitCode = evaluation.ok ? 0 : 2;
}
