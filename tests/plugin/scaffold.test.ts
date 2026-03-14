import { describe, expect, it } from "vitest";
import plugin from "../../src";
import {
  APOLLO_SPECIALIST_AGENT,
  ATHENA_SPECIALIST_AGENT,
  HERMES_SPECIALIST_AGENT,
  PROMETHEUS_PLANNER_AGENT,
  SISYPHUS_JUNIOR_AGENT,
  SISYPHUS_ORCHESTRATOR_AGENT,
  experimentAgents,
} from "../../src/agents";
import { experimentCommands } from "../../src/commands";
import { experimentTools } from "../../src/tools";

describe("plugin scaffold", () => {
  it("registers plugin entry, experiment namespace commands, agents, and tools", async () => {
    const loaded = await plugin();
    expect(Object.keys(loaded.tool)).toEqual(Object.keys(experimentTools));
    expect(Object.keys(experimentCommands)).toEqual(
      expect.arrayContaining(["innovate-loop", "experiment-init", "experiment-run", "experiment-status", "experiment-bootstrap"]),
    );
    expect(Object.keys(experimentAgents)).toEqual(
      expect.arrayContaining([
        SISYPHUS_ORCHESTRATOR_AGENT,
        PROMETHEUS_PLANNER_AGENT,
        SISYPHUS_JUNIOR_AGENT,
        APOLLO_SPECIALIST_AGENT,
        ATHENA_SPECIALIST_AGENT,
        HERMES_SPECIALIST_AGENT,
      ]),
    );
    expect(experimentAgents[SISYPHUS_ORCHESTRATOR_AGENT].mode).toBe("primary");
    expect(experimentAgents[PROMETHEUS_PLANNER_AGENT].mode).toBe("primary");
    expect(experimentAgents[SISYPHUS_JUNIOR_AGENT].mode).toBe("subagent");
    expect(experimentAgents[SISYPHUS_ORCHESTRATOR_AGENT].tools.delegate_task).toBe(true);
    expect(Object.keys(experimentTools)).toEqual(
      expect.arrayContaining([
        "experiment_init",
        "experiment_validate_spec",
        "experiment_status",
        "experiment_run_governed_workflow",
        "experiment_controller_bootstrap",
        "experiment_controller_start",
        "experiment_controller_tick",
        "experiment_controller_status",
        "experiment_controller_resume",
        "experiment_controller_stop",
        "experiment_controller_apply_mutation",
      ]),
    );
  });
});
