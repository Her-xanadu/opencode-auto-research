import { z } from "zod";

export type PluginInput = {
  client?: any;
  project?: any;
  directory: string;
  worktree: string;
  serverUrl?: URL;
  $?: unknown;
};

export type ToolContext = {
  sessionID: string;
  messageID: string;
  agent: string;
  directory: string;
  worktree: string;
  abort: AbortSignal;
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void;
  ask?: (input: {
    permission: string;
    patterns: string[];
    always: string[];
    metadata: Record<string, unknown>;
  }) => Promise<void>;
};

export type ToolDefinition = {
  description: string;
  args: Record<string, unknown>;
  execute: (args: any, context?: ToolContext) => Promise<string> | string;
};

export type Plugin = (input?: PluginInput) => Promise<{
  tool: Record<string, ToolDefinition>;
  config?: (config: Record<string, unknown>) => Promise<void> | void;
}>;

type SchemaApi = typeof z & {
  any: () => z.ZodAny;
};

const schema = Object.assign({}, z, {
  any: () => z.any(),
});

export const tool = Object.assign(
  <T extends ToolDefinition>(definition: T): T => definition,
  {
    schema: schema as SchemaApi,
  },
);
