import fs from "node:fs/promises";
import path from "node:path";

const targetConfigDir = process.env.CONTAINER_OPENCODE_CONFIG_DIR ?? "/root/.config/opencode";

function normalizeBaseUrl(value) {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

async function main() {
  const apiKey = process.env.KIMI_CODING_API_KEY;
  const baseUrl = process.env.KIMI_CODING_BASE_URL;

  if (!apiKey) {
    throw new Error("KIMI_CODING_API_KEY is required for Docker-only configuration");
  }

  if (!baseUrl) {
    throw new Error("KIMI_CODING_BASE_URL is required for Docker-only configuration");
  }

  await fs.mkdir(targetConfigDir, { recursive: true });

  const containerConfig = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      "kimi-for-coding": {
        name: "Kimi For Coding",
        npm: "@ai-sdk/anthropic",
        options: {
          apiKey,
          baseURL: normalizeBaseUrl(baseUrl),
        },
        models: {
          "kimi-k2.5": {
            name: "Kimi K2.5",
            reasoning: true,
            attachment: false,
            limit: {
              context: 262144,
              output: 32768,
            },
            modalities: {
              input: ["text", "image", "video"],
              output: ["text"],
            },
            options: {
              interleaved: {
                field: "reasoning_content",
              },
            },
          },
        },
      },
    },
  };

  await fs.writeFile(path.join(targetConfigDir, "config.json"), `${JSON.stringify(containerConfig, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
