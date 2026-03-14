import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const innovationLoopScript = path.join(repoRoot, "scripts", "innovation_loop.py");

async function makeWorkspace(): Promise<{ workspace: string; configPath: string; fakeBin: string }> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "auto-exp-python-controller-live-"));
  tempDirs.push(workspace);
  await fs.mkdir(path.join(workspace, "configs"), { recursive: true });
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.mkdir(path.join(workspace, "data"), { recursive: true });
  await fs.cp(path.join(repoRoot, "fixtures", "kb", "vault"), path.join(workspace, "vault"), { recursive: true });
  const fakeBin = path.join(workspace, "fake-bin");
  await fs.mkdir(fakeBin, { recursive: true });

  await fs.writeFile(
    path.join(workspace, "src", "config.json"),
    JSON.stringify({ learning_rate: 0.2, dropout: 0.1, objective_mode: "baseline" }, null, 2) + "\n",
    "utf8",
  );
  await fs.writeFile(path.join(workspace, "src", "strategy.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(workspace, "src", "module.ts"), "export const variant = 0;\n", "utf8");
  await fs.writeFile(path.join(workspace, "data", "observations.csv"), "split,value\ntrain,1\nvalid,1\n", "utf8");
  await fs.writeFile(
    path.join(workspace, "evaluate.py"),
    [
      "import argparse",
      "import json",
      "import pathlib",
      "import re",
      "import time",
      "",
      "parser = argparse.ArgumentParser()",
      "parser.add_argument('--stage', default='baseline')",
      "parser.add_argument('--resume-from')",
      "args = parser.parse_args()",
      "cfg = json.loads(pathlib.Path('src/config.json').read_text())",
      "strategy = pathlib.Path('src/strategy.txt').read_text().strip()",
      "module_text = pathlib.Path('src/module.ts').read_text()",
      "match = re.search(r'(\\d+)', module_text)",
      "variant = int(match.group(1)) if match else 0",
      "score = 0.72",
      "if cfg.get('objective_mode') == 'stability_loss_v2':",
      "    score += 0.14",
      "if strategy == 'variant_2':",
      "    score -= 0.03",
      "elif strategy == 'variant_3':",
      "    score += 0.01",
      "if variant >= 2:",
      "    score += 0.06",
      "if args.stage == 'full':",
      "    time.sleep(0.2)",
      "pathlib.Path('experiments').mkdir(parents=True, exist_ok=True)",
      "pathlib.Path('experiments/metrics.json').write_text(json.dumps({'score': min(0.99, round(score, 4)), 'stage': args.stage, 'resume_from': args.resume_from}, indent=2) + '\\n')",
      "pathlib.Path('experiments/checkpoints').mkdir(parents=True, exist_ok=True)",
      "pathlib.Path('experiments/checkpoints/last.ckpt').write_text('checkpoint\\n')",
      "print(min(0.99, round(score, 4)))",
    ].join("\n"),
    "utf8",
  );

  await fs.writeFile(
    path.join(workspace, "configs", "research_brain.yaml"),
    [
      `vault_root: ${path.join(workspace, "vault")}`,
      "index_output_dir: experiments/research/index",
      "retrieval_cache_dir: experiments/research/retrieval-cache",
      "evidence_output_dir: experiments/research",
      "feedback_output: experiments/research/paper-feedback.jsonl",
      "posterior_rank_output: experiments/research/posterior-rank.json",
      "paper_id_map_output: experiments/research/paper-id-map.jsonl",
      "frontier_map_output: experiments/research/index/frontier-map.json",
    ].join("\n") + "\n",
    "utf8",
  );

  const fakeOpencode = path.join(fakeBin, "opencode");
  await fs.writeFile(
    fakeOpencode,
    `#!/usr/bin/env python3
import json
import os
import pathlib
import re
import sys

args = sys.argv[1:]
prompt = args[-1] if args else ""
log_path = pathlib.Path(os.environ["FAKE_OPENCODE_LOG"])
log_path.parent.mkdir(parents=True, exist_ok=True)
with log_path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(args) + "\\n")

agent = None
for index, value in enumerate(args):
    if value == "--agent" and index + 1 < len(args):
        agent = args[index + 1]
        break

if agent == "Apollo":
    print(json.dumps({
        "title": "objective-stability-loss-v2",
        "choice": "objective",
        "family": "objective.loss",
        "innovation_tags": ["objective"],
        "mechanism": "improve the objective family",
        "files_to_touch": ["src/config.json"],
        "expected_gain": 0.02,
        "risk": "low",
        "why_not_parameter_only": "changes the objective family",
        "smoke_checks": ["syntax_check", "smoke_eval"],
        "proxy_plan": {"epochs": 1, "data_fraction": 0.2},
        "minimal_ablation": ["revert objective mode"],
        "paper_grounding": [
            {"paper_id": "doi:10.1145/3718958.3750493", "why_relevant": "high relevance", "mechanism_transfer": "online adaptation"},
            {"paper_id": "doi:10.1145/3711896.3736964", "why_relevant": "ood guard", "mechanism_transfer": "ood detection"}
        ],
        "change_class": "objective",
        "change_unit": "objective-stability-loss-v2",
        "target_file": "src/config.json",
        "params": {"key": "objective_mode", "value": "stability_loss_v2"}
    }))
elif agent == "Hermes":
    print(json.dumps({
        "title": "strategy-variant-3",
        "choice": "representation",
        "family": "repr.feature",
        "innovation_tags": ["representation"],
        "mechanism": "test an orthogonal representation path",
        "files_to_touch": ["src/strategy.txt"],
        "expected_gain": 0.01,
        "risk": "medium",
        "why_not_parameter_only": "changes representation path",
        "smoke_checks": ["syntax_check", "smoke_eval"],
        "proxy_plan": {"epochs": 1, "data_fraction": 0.2},
        "minimal_ablation": ["revert strategy"],
        "paper_grounding": [
            {"paper_id": "doi:10.1145/3711896.3736964", "why_relevant": "orthogonal", "mechanism_transfer": "semantic prompt"},
            {"paper_id": "paper:arxiv:2024:ffffeeee11", "why_relevant": "adaptation", "mechanism_transfer": "test-time training"}
        ],
        "change_class": "representation",
        "change_unit": "strategy-variant-3",
        "target_file": "src/strategy.txt",
        "params": {"search": "baseline", "replace": "variant_3"}
    }))
elif agent == "Athena":
    print(json.dumps({
        "verdict": "approve",
        "validity_risks": [],
        "smallest_repair": None,
        "single_change_ok": True,
        "paper_support_ok": True
    }))
elif agent == "sisyphus-junior":
    workspace_line = next((line for line in prompt.splitlines() if line.startswith('WORKSPACE_ROOT:')), None)
    mutation_line = next((line for line in prompt.splitlines() if line.startswith('MUTATION_JSON:')), None)
    if not workspace_line or not mutation_line:
        raise SystemExit("missing workspace or mutation")
    workspace = pathlib.Path(workspace_line.split(':', 1)[1].strip())
    mutation = json.loads(mutation_line.split(':', 1)[1].strip())
    if mutation["change_class"] == "objective":
        cfg = json.loads((workspace / mutation["target_file"]).read_text())
        cfg[mutation["params"]["key"]] = mutation["params"]["value"]
        (workspace / mutation["target_file"]).write_text(json.dumps(cfg, indent=2) + "\\n")
    elif mutation["change_class"] == "representation":
        target = workspace / mutation["target_file"]
        target.write_text(target.read_text().replace(mutation["params"]["search"], mutation["params"]["replace"]))
    else:
        (workspace / mutation["target_file"]).write_text(mutation["params"]["content"])
    print(json.dumps({
        "touched_files": mutation.get("files_to_touch") or [mutation["target_file"]],
        "diff_summary": mutation["change_unit"],
        "change_manifest": {"primary_object": mutation["change_unit"], "secondary_objects": []}
    }))
else:
    print(json.dumps({"agent": agent, "ok": True}))
`,
    "utf8",
  );
  await fs.chmod(fakeOpencode, 0o755);

  return {
    workspace,
    configPath: path.join(workspace, "configs", "goal.yaml"),
    fakeBin,
  };
}

async function runInnovationLoop(
  workspace: string,
  configPath: string,
  command: string,
  env: NodeJS.ProcessEnv,
  extraArgs: string[] = [],
): Promise<any> {
  const { stdout } = await execFileAsync(
    "python3",
    [innovationLoopScript, command, "--config", configPath, "--workspace", workspace, "--mode", "live", ...extraArgs],
    { cwd: workspace, env },
  );
  return JSON.parse(stdout);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
    ),
  );
});

describe("python controller live dispatch", () => {
  it("consults three live specialists and routes mutation through sisyphus-junior", async () => {
    const { workspace, configPath, fakeBin } = await makeWorkspace();
    const logPath = path.join(workspace, "experiments", "fake-opencode-log.jsonl");
    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      FAKE_OPENCODE_LOG: logPath,
      INNOVATION_LOOP_OPENCODE_DIR: repoRoot,
      INNOVATION_LOOP_AGENT_MODEL: "kimi-for-coding/kimi-k2.5",
      INNOVATION_LOOP_DISABLE_REAL_DVC: "1",
    };

    await runInnovationLoop(workspace, configPath, "bootstrap", env);
    const baseline = await runInnovationLoop(workspace, configPath, "tick", env);
    expect(baseline.phase).toBe("baseline");

    const candidate = await runInnovationLoop(workspace, configPath, "tick", env);
    expect(candidate.phase).toBe("candidate");
    expect(candidate.proposals.execution_mode).toBe("live");
    expect(candidate.proposals.model).toBe("kimi-for-coding/kimi-k2.5");
    expect(candidate.candidate.queued).toBe(true);

    const logs = (await fs.readFile(logPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const rendered = logs.map((entry: string[]) => entry.join(" ")).join("\n");
    expect(rendered).toContain("--agent Apollo");
    expect(rendered).toContain("--agent Athena");
    expect(rendered).toContain("--agent Hermes");
    expect(rendered).toContain("--agent sisyphus-junior");

    const proposalsRound1 = JSON.parse(await fs.readFile(path.join(workspace, "experiments", "proposals", "round-0001.json"), "utf8"));
    expect(proposalsRound1.next_primary_hypothesis.family).toBe("objective.loss");
    expect(proposalsRound1.next_primary_hypothesis.paper_grounding).toHaveLength(2);
    expect(proposalsRound1.evidence_pack_path).toContain("evidence-round-0001.md");
    expect(JSON.parse(await fs.readFile(path.join(workspace, "src", "config.json"), "utf8")).objective_mode).toBe("stability_loss_v2");
  }, 15000);
});
