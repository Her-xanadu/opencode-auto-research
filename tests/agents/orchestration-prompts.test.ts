import { describe, expect, it } from "vitest";
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

describe("agent orchestration prompts", () => {
  it("gives the primary agent an explicit multi-agent coordination protocol", () => {
    const primary = experimentAgents[SISYPHUS_ORCHESTRATOR_AGENT];
    expect(primary.mode).toBe("primary");
    expect(primary.tools.delegate_task).toBe(true);
    expect(primary.tools.background_output).toBe(true);
    expect(primary.permission.question).toBe("allow");
    expect(primary.permission.call_omo_agent).toBe("deny");
    expect(primary.prompt).toContain("sole outer orchestrator");
    expect(primary.prompt).toContain("Sisyphus-Junior is the only code executor");
    expect(primary.prompt).toContain("Prometheus appears only for bootstrap or review-blocked replanning");
    expect(primary.prompt).toContain("Apollo");
    expect(primary.prompt).toContain("Athena");
    expect(primary.prompt).toContain("Hermes");
    expect(primary.prompt).toContain("selected primary hypothesis");
  });

  it("keeps specialists read-only and gives Sisyphus-Junior the executor role", () => {
    const subagents = [
      SISYPHUS_JUNIOR_AGENT,
      APOLLO_SPECIALIST_AGENT,
      ATHENA_SPECIALIST_AGENT,
      HERMES_SPECIALIST_AGENT,
    ] as const;

    for (const name of subagents) {
      const agent = experimentAgents[name];
      expect(agent.mode).toBe("subagent");
      if (name === SISYPHUS_JUNIOR_AGENT) {
        expect(agent.prompt).toContain("only code executor");
      } else {
        expect(agent.prompt).toContain("Input contract");
        expect(agent.prompt).toContain("Output contract");
        if (name === ATHENA_SPECIALIST_AGENT) {
          expect(agent.prompt).toContain("paper_id");
          expect(agent.prompt).toContain("research_context");
          expect(agent.prompt).toContain("redirect_if_underperforming");
          expect(agent.prompt).toContain("under target");
          expect(agent.prompt).toContain("failure_signature");
          expect(agent.prompt).toContain("causal_metric_path");
        } else {
          expect(agent.prompt).toContain("paper_grounding");
          expect(agent.prompt).toContain("innovation_brief");
          expect(agent.prompt).toContain("redirect_if_underperforming");
          expect(agent.prompt).toContain("under target");
          expect(agent.prompt).toContain("causal_metric_path");
          expect(agent.prompt).toContain("failure_signature");
          expect(agent.prompt).toContain("pivot_after_failure");
        }
      }
    }
  });

  it("limits Prometheus to bootstrap and review-blocked planning", () => {
    const planner = experimentAgents[PROMETHEUS_PLANNER_AGENT];
    expect(planner.mode).toBe("primary");
    expect(planner.prompt).toContain("bootstrap");
    expect(planner.prompt).toContain("review-blocked");
    expect(planner.prompt).toContain("Do not execute code changes");
  });

  it("routes experiment-run through Sisyphus with a single executor and optional Prometheus gate", () => {
    const template = experimentCommands["experiment-run"].template;
    expect(template).toContain("Prometheus");
    expect(template).toContain("Apollo");
    expect(template).toContain("Athena");
    expect(template).toContain("Hermes");
    expect(template).toContain("sisyphus-junior");
    expect(template).toContain("experiment_controller_status");
    expect(template).toContain("experiment_controller_tick");
  });
});
