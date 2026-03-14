import { athenaValidityGuardAgent } from "./athena";
import { apolloExploitArchitectAgent } from "./apollo";
import { prometheusBootstrapPlannerAgent } from "./prometheus-bootstrap-planner";
import { hermesDivergenceScoutAgent } from "./hermes";
import { sisyphusExperimentOrchestratorAgent } from "./sisyphus-experiment-orchestrator";
import { sisyphusJuniorExecutorAgent } from "./sisyphus-junior-executor";

export const SISYPHUS_ORCHESTRATOR_AGENT = "Sisyphus (Ultraworker)";
export const PROMETHEUS_PLANNER_AGENT = "Prometheus (Plan Builder)";
export const SISYPHUS_JUNIOR_AGENT = "sisyphus-junior";
export const APOLLO_SPECIALIST_AGENT = "Apollo";
export const ATHENA_SPECIALIST_AGENT = "Athena";
export const HERMES_SPECIALIST_AGENT = "Hermes";

export const experimentAgents = {
  [SISYPHUS_ORCHESTRATOR_AGENT]: sisyphusExperimentOrchestratorAgent,
  [PROMETHEUS_PLANNER_AGENT]: prometheusBootstrapPlannerAgent,
  [SISYPHUS_JUNIOR_AGENT]: sisyphusJuniorExecutorAgent,
  [APOLLO_SPECIALIST_AGENT]: apolloExploitArchitectAgent,
  [ATHENA_SPECIALIST_AGENT]: athenaValidityGuardAgent,
  [HERMES_SPECIALIST_AGENT]: hermesDivergenceScoutAgent,
} as const;
