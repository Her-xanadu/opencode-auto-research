import AutoExperimentPlugin from "../../dist/index.js";

const KIMI_MODEL = "kimi-for-coding/kimi-k2.5";

export default async function OpenCodeAutoExperimentDockerPlugin(input) {
  const plugin = await AutoExperimentPlugin(input);
  const originalConfig = plugin.config;

  return {
    ...plugin,
    config: async (config) => {
      if (originalConfig) {
        await originalConfig(config);
      }
      config.agent = {
        ...(config.agent ?? {}),
        "Sisyphus (Ultraworker)": {
          ...(config.agent?.["Sisyphus (Ultraworker)"] ?? {}),
          model: KIMI_MODEL,
        },
        "Prometheus (Plan Builder)": {
          ...(config.agent?.["Prometheus (Plan Builder)"] ?? {}),
          model: KIMI_MODEL,
        },
        "sisyphus-junior": {
          ...(config.agent?.["sisyphus-junior"] ?? {}),
          model: KIMI_MODEL,
        },
      };
    },
  };
}
