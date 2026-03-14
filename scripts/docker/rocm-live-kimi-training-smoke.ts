import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const repoRoot = process.cwd();
const innovationLoopScript = path.join(repoRoot, "scripts", "innovation_loop.py");

async function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: repoRoot,
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}

async function ensureOpencodeConfig() {
  await run("node", ["scripts/docker/setup-opencode-config.mjs"]);
}

function buildTrainPythonCommand() {
  const hostPython = process.env.CONTAINER_HOST_PYTHON;
  if (!hostPython) {
    return {
      command: "python3",
      probeCommand: ["python3", "-c", "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(getattr(torch.version,'hip',None))"],
    };
  }
  const pythonPath = process.env.CONTAINER_HOST_PYTHONPATH ?? "";
  const ldLibraryPath = process.env.CONTAINER_HOST_LD_LIBRARY_PATH ?? "/opt/rocm/lib:/opt/rocm/lib64";
  const command = `env PYTHONPATH=${pythonPath} LD_LIBRARY_PATH=${ldLibraryPath} ${hostPython}`;
  return {
    command,
    probeCommand: [
      "bash",
      "-lc",
      `${command} - <<'PY'
import torch
print(torch.__version__)
print(torch.cuda.is_available())
print(getattr(torch.version, 'hip', None))
PY`,
    ],
  };
}

async function ensureRocmTorch() {
  const trainPython = buildTrainPythonCommand();
  const probe = await run(trainPython.probeCommand[0]!, trainPython.probeCommand.slice(1)).catch(() => null);
  if (probe && /True/.test(probe.stdout) && /rocm|hip/i.test(probe.stdout)) {
    return { probe: probe.stdout.trim(), trainPythonCommand: trainPython.command };
  }
  await run("python3", [
    "-m",
    "pip",
    "install",
    "--break-system-packages",
    "--no-cache-dir",
    "--default-timeout=1000",
    "torch==2.3.1",
    "--index-url",
    "https://download.pytorch.org/whl/rocm5.7",
  ]);
  const verified = await run("python3", [
    "-c",
    "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(getattr(torch.version,'hip',None))",
  ]);
  if (!/True/.test(verified.stdout) || !/rocm|hip/i.test(verified.stdout)) {
    throw new Error(`ROCm torch not ready: ${verified.stdout}\n${verified.stderr}`);
  }
  return { probe: verified.stdout.trim(), trainPythonCommand: "python3" };
}

async function rewriteWorkspaceForTrainPython(workspace: string, trainPythonCommand: string) {
  const goalPath = path.join(workspace, "configs", "goal.yaml");
  const dvcPath = path.join(workspace, "dvc.yaml");
  const replaceFrom = /python3 evaluate\.py/g;
  const goalText = await fs.readFile(goalPath, "utf8");
  await fs.writeFile(goalPath, goalText.replace(replaceFrom, `${trainPythonCommand} evaluate.py`), "utf8");
  const dvcText = await fs.readFile(dvcPath, "utf8");
  await fs.writeFile(dvcPath, dvcText.replace(replaceFrom, `${trainPythonCommand} evaluate.py`), "utf8");
}

async function makeWorkspace(): Promise<{ workspace: string; configPath: string }> {
  const workspaceRoot = path.join(repoRoot, ".tmp-smokes");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const workspace = await fs.mkdtemp(path.join(workspaceRoot, "auto-exp-rocm-live-kimi-"));
  await fs.mkdir(path.join(workspace, "configs"), { recursive: true });
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.mkdir(path.join(workspace, "data"), { recursive: true });

  await fs.writeFile(
    path.join(workspace, "src", "config.json"),
    JSON.stringify({ learning_rate: 0.02, dropout: 0.1, objective_mode: "baseline" }, null, 2) + "\n",
    "utf8",
  );
  await fs.writeFile(path.join(workspace, "src", "strategy.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(workspace, "src", "module.ts"), "export const variant = 0;\n", "utf8");
  await fs.writeFile(path.join(workspace, "data", "readme.txt"), "synthetic ring classification\n", "utf8");
  await fs.writeFile(
    path.join(workspace, "evaluate.py"),
    [
      "import argparse",
      "import json",
      "import pathlib",
      "import re",
      "import time",
      "",
      "import torch",
      "from torch import nn",
      "from torch.utils.data import DataLoader, TensorDataset",
      "",
      "parser = argparse.ArgumentParser()",
      "parser.add_argument('--stage', default='baseline')",
      "parser.add_argument('--resume-from')",
      "args = parser.parse_args()",
      "",
      "root = pathlib.Path('.')",
      "cfg = json.loads((root / 'src' / 'config.json').read_text())",
      "strategy = (root / 'src' / 'strategy.txt').read_text().strip()",
      "module_text = (root / 'src' / 'module.ts').read_text()",
      "match = re.search(r'(\\d+)', module_text)",
      "variant = int(match.group(1)) if match else 0",
      "device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')",
      "if device.type != 'cuda':",
      "    raise RuntimeError('expected ROCm/CUDA-compatible device inside container')",
      "torch.manual_seed(7)",
      "",
      "def make_ring_dataset(n, seed):",
      "    g = torch.Generator().manual_seed(seed)",
      "    x = torch.empty(n, 2).uniform_(-1.3, 1.3, generator=g)",
      "    radius = torch.sqrt((x ** 2).sum(dim=1))",
      "    y = ((radius > 0.45) & (radius < 0.95)).float().unsqueeze(1)",
      "    return x, y",
      "",
      "def build_features(x):",
      "    if strategy == 'variant_2':",
      "        radius2 = (x[:, :1] ** 2) + (x[:, 1:2] ** 2)",
      "        interaction = x[:, :1] * x[:, 1:2]",
      "        return torch.cat([x, radius2, interaction], dim=1)",
      "    if strategy == 'variant_3':",
      "        return torch.cat([x, torch.sin(3 * x), torch.cos(3 * x)], dim=1)",
      "    return x",
      "",
      "class RingModel(nn.Module):",
      "    def __init__(self, in_features, variant):",
      "        super().__init__()",
      "        if variant >= 2:",
      "            self.net = nn.Sequential(nn.Linear(in_features, 64), nn.ReLU(), nn.Linear(64, 32), nn.ReLU(), nn.Linear(32, 1))",
      "        elif variant == 1:",
      "            self.net = nn.Sequential(nn.Linear(in_features, 32), nn.ReLU(), nn.Linear(32, 1))",
      "        else:",
      "            self.net = nn.Linear(in_features, 1)",
      "    def forward(self, x):",
      "        return self.net(x)",
      "",
      "train_x_raw, train_y = make_ring_dataset(20000, 11)",
      "valid_x_raw, valid_y = make_ring_dataset(4000, 29)",
      "train_x = build_features(train_x_raw)",
      "valid_x = build_features(valid_x_raw)",
      "train_loader = DataLoader(TensorDataset(train_x, train_y), batch_size=512, shuffle=True)",
      "valid_loader = DataLoader(TensorDataset(valid_x, valid_y), batch_size=1024)",
      "model = RingModel(train_x.shape[1], variant).to(device)",
      "optimizer = torch.optim.AdamW(model.parameters(), lr=float(cfg.get('learning_rate', 0.02)))",
      "pos_weight = torch.tensor([2.4], device=device) if cfg.get('objective_mode') == 'stability_loss_v2' else None",
      "criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)",
      "ckpt_dir = root / 'experiments' / 'checkpoints'",
      "ckpt_dir.mkdir(parents=True, exist_ok=True)",
      "ckpt_path = ckpt_dir / 'last.ckpt'",
      "resume_path = pathlib.Path(args.resume_from) if args.resume_from else None",
      "if resume_path and resume_path.exists():",
      "    payload = torch.load(resume_path, map_location=device)",
      "    model.load_state_dict(payload['model'])",
      "    optimizer.load_state_dict(payload['optimizer'])",
      "stage_epochs = {'baseline': 6, 'smoke': 4, 'proxy': 8, 'full': 18}",
      "epochs = stage_epochs.get(args.stage, 6)",
      "for epoch in range(epochs):",
      "    model.train()",
      "    for batch_x, batch_y in train_loader:",
      "        batch_x = batch_x.to(device)",
      "        batch_y = batch_y.to(device)",
      "        optimizer.zero_grad()",
      "        loss = criterion(model(batch_x), batch_y)",
      "        loss.backward()",
      "        optimizer.step()",
      "    torch.save({'model': model.state_dict(), 'optimizer': optimizer.state_dict(), 'epoch': epoch}, ckpt_path)",
      "    if args.stage == 'full':",
      "        time.sleep(0.5)",
      "model.eval()",
      "correct = 0",
      "total = 0",
      "with torch.no_grad():",
      "    for batch_x, batch_y in valid_loader:",
      "        batch_x = batch_x.to(device)",
      "        batch_y = batch_y.to(device)",
      "        preds = (torch.sigmoid(model(batch_x)) > 0.5).float()",
      "        correct += (preds == batch_y).sum().item()",
      "        total += batch_y.numel()",
      "score = round(correct / max(total, 1), 4)",
      "metrics_path = root / 'experiments' / 'metrics.json'",
      "metrics_path.parent.mkdir(parents=True, exist_ok=True)",
      "metrics_path.write_text(json.dumps({'score': score, 'stage': args.stage, 'device': str(device), 'resume_from': args.resume_from}, indent=2) + '\\n')",
      "print(score)",
    ].join("\n"),
    "utf8",
  );

  return { workspace, configPath: path.join(workspace, "configs", "goal.yaml") };
}

async function runInnovationLoop(workspace: string, configPath: string, command: string, extraArgs: string[] = []) {
  const { stdout } = await execFileAsync(
    "python3",
    [innovationLoopScript, command, "--config", configPath, "--workspace", workspace, "--mode", "live", ...extraArgs],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CI: "true",
        INNOVATION_LOOP_AGENT_MODEL: "kimi-for-coding/kimi-k2.5",
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

async function waitForTerminalPhase(workspace: string, configPath: string, timeoutMs = 15 * 60 * 1000): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await runInnovationLoop(workspace, configPath, "tick");
    if (["judge", "done", "failed"].includes(result.phase)) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("timed out waiting for terminal phase");
}

async function main() {
  await ensureOpencodeConfig();
  const { probe: torchProbe, trainPythonCommand } = await ensureRocmTorch();
  const { workspace, configPath } = await makeWorkspace();

  const bootstrap = await runInnovationLoop(workspace, configPath, "bootstrap");
  if (!bootstrap.dvc_bootstrapped) {
    throw new Error(`expected DVC bootstrap, got ${JSON.stringify(bootstrap)}`);
  }
  await rewriteWorkspaceForTrainPython(workspace, trainPythonCommand);

  const baseline = await runInnovationLoop(workspace, configPath, "tick");
  if (baseline.phase !== "baseline") {
    throw new Error(`expected baseline phase, got ${JSON.stringify(baseline)}`);
  }

  const rounds: any[] = [];
  let status = await runInnovationLoop(workspace, configPath, "status");
  let guard = 0;
  while (status.stop_reason !== "goal_reached" && guard < 4) {
    const candidate = await runInnovationLoop(workspace, configPath, status.state === "crash_recoverable" ? "resume" : "tick");
    const settled = ["done", "judge", "failed"].includes(candidate.phase)
      ? candidate
      : await waitForTerminalPhase(workspace, configPath);
    rounds.push({ candidate, settled });
    status = await runInnovationLoop(workspace, configPath, "status");
    if (settled.phase === "failed") {
      throw new Error(`controller entered failed state: ${JSON.stringify(settled)}`);
    }
    guard += 1;
  }

  const best = JSON.parse(await fs.readFile(path.join(workspace, "experiments", "best.json"), "utf8"));
  const attempts = (await fs.readFile(path.join(workspace, "experiments", "attempts.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const proposalsFiles = await fs.readdir(path.join(workspace, "experiments", "proposals"));

  if (status.stop_reason !== "goal_reached") {
    throw new Error(`expected goal_reached, got ${JSON.stringify(status)}`);
  }
  if (!best.metric || best.metric < 0.9) {
    throw new Error(`best metric too low: ${JSON.stringify(best)}`);
  }
  if (attempts.length < 2) {
    throw new Error(`expected at least 2 attempts, got ${attempts.length}`);
  }
  if (!proposalsFiles.some((name) => /^round-\d{4}\.json$/.test(name))) {
    throw new Error(`missing proposals round files: ${JSON.stringify(proposalsFiles)}`);
  }

  const metrics = JSON.parse(await fs.readFile(path.join(workspace, "experiments", "metrics.json"), "utf8"));

  console.log(JSON.stringify({
    ok: true,
    task: "rocm-live-kimi-small-training-loop",
    workspace,
    torch_probe: torchProbe,
    bootstrap,
    baseline,
    rounds,
    status,
    best,
    attempts,
    final_metrics: metrics,
    proposals_files: proposalsFiles,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
