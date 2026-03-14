import type { Plugin, PluginInput } from "./opencode-plugin";
import { experimentAgents } from "./agents";
import { experimentCommands } from "./commands";
import { createExperimentTools } from "./tools";

type PluginConfigShape = {
  command?: Record<string, unknown>;
  agent?: Record<string, unknown>;
};

function applyExperimentConfig(config: PluginConfigShape): void {
  config.command = {
    ...(config.command ?? {}),
    ...experimentCommands,
  };
  config.agent = {
    ...(config.agent ?? {}),
    ...experimentAgents,
  };
}

export const OpenCodeAutoExperimentPlugin: Plugin = async (input?: PluginInput) => ({
  tool: createExperimentTools(input),
  config: async (config: PluginConfigShape) => {
    applyExperimentConfig(config);
  },
});
