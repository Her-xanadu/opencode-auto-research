import { PROMETHEUS_PLANNER_AGENT, SISYPHUS_ORCHESTRATOR_AGENT } from "../agents";

export const experimentCommands = {
  "innovate-loop": {
    description: "Run the fixed Sisyphus experiment optimization loop.",
    agent: SISYPHUS_ORCHESTRATOR_AGENT,
    template:
      "You are running /innovate-loop as Sisyphus. Read AGENTS.md and configs/goal.yaml first. Use experiment_controller_bootstrap if bootstrap facts are missing. If bootstrap or review-blocked handling needs replanning, consult Prometheus only for that narrow step. Then use experiment_controller_start in live mode to make the Python controller the authority path. In each normal round, require exactly three read-only specialists: Apollo, Athena, and Hermes. Require sisyphus-junior to be the sole code executor through the controller path. Summarize current stage, selected primary hypothesis, best metric, latest decision, and stop reason from experiment_controller_status.",
  },
  "experiment-init": {
    description: "Initialize a governed experiment session under Sisyphus.",
    agent: SISYPHUS_ORCHESTRATOR_AGENT,
    template:
      "You are running /experiment-init as Sisyphus. Read AGENTS.md and configs/goal.yaml if present, call experiment_validate_spec, fix invalid fields if needed, call experiment_init once, and report the current session stage. Use Prometheus only if bootstrap facts are still unresolved.",
  },
  "experiment-run": {
    description: "Run or resume the current Sisyphus-governed experiment loop.",
    agent: SISYPHUS_ORCHESTRATOR_AGENT,
    template:
      "You are running /experiment-run as Sisyphus. Read experiment_controller_status first. If bootstrap is unresolved, call experiment_controller_bootstrap. If the session is review-blocked, consult Prometheus only for that narrow replanning step before continuing. If the session is crash_recoverable, call experiment_controller_resume in live mode. Otherwise call experiment_controller_tick or experiment_controller_start in live mode to continue the Python controller authority path. In each normal round, require exactly the three read-only specialists: Apollo, Athena, and Hermes. Require sisyphus-junior to be the sole code executor. Summarize updated best result, stop reason, and next action from structured controller output.",
  },
  "experiment-status": {
    description: "Show the current experiment session state.",
    agent: SISYPHUS_ORCHESTRATOR_AGENT,
    template: "Call experiment_controller_status and summarize the structured session, best-run state, controller health, and loop progress as Sisyphus would report it.",
  },
  "research-context": {
    description: "Generate one research evidence pack without running the full loop.",
    agent: SISYPHUS_ORCHESTRATOR_AGENT,
    template:
      "You are running /research-context as Sisyphus. Read AGENTS.md, configs/goal.yaml, configs/research_brain.yaml, experiments/session.json, experiments/best.json, and experiments/attempts.jsonl if present. Use the local research-brain controller path to ensure the index exists, generate one retrieval result plus one evidence pack, and report the selected papers, evidence pack path, and grounding-ready paper_id values. Do not continue the experiment loop or execute code changes.",
  },
  "experiment-bootstrap": {
    description: "Ask Prometheus for bootstrap or review-blocked replanning only.",
    agent: PROMETHEUS_PLANNER_AGENT,
    template:
      "You are running /experiment-bootstrap as Prometheus. Read AGENTS.md and configs/goal.yaml, then produce only the narrowest bootstrap or review-blocked recovery plan needed for Sisyphus to continue. Do not execute code changes.",
  },
} as const;
