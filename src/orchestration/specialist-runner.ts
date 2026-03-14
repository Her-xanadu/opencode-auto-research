import type { PluginInput, ToolContext } from "../opencode-plugin";

export type SpecialistAgentName =
  | "Prometheus (Plan Builder)"
  | "Apollo"
  | "Athena"
  | "Hermes"
  | "sisyphus-junior";

export interface SpecialistInvocation {
  agent: SpecialistAgentName;
  description: string;
  prompt: string;
}

export interface SpecialistResponse {
  sessionID: string;
  text: string;
  rawExcerpt: string;
}

export class SpecialistInvocationError extends Error {
  constructor(
    message: string,
    readonly sessionID: string | null,
    readonly rawExcerpt: string | null,
  ) {
    super(message);
    this.name = "SpecialistInvocationError";
  }
}

type AssistantMessage = {
  info?: { role?: string; time?: { created?: number } };
  parts?: Array<{ type?: string; text?: string }>;
};

function buildRawExcerpt(text: string, limit = 280): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}...`;
}

function extractAssistantText(messages: AssistantMessage[]): string {
  const assistantMessages = messages
    .filter((message) => message.info?.role === "assistant")
    .sort((left, right) => (right.info?.time?.created ?? 0) - (left.info?.time?.created ?? 0));
  const lastMessage = assistantMessages[0];
  if (!lastMessage) {
    throw new Error("no assistant response found in delegated session");
  }

  return (lastMessage.parts ?? [])
    .filter((part) => part.type === "text" || part.type === "reasoning")
    .map((part) => part.text ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStableMessages(client: NonNullable<PluginInput["client"]>, sessionID: string): Promise<AssistantMessage[]> {
  const POLL_INTERVAL_MS = 500;
  const MIN_STABILITY_TIME_MS = 3000;
  const STABILITY_POLLS_REQUIRED = 3;
  const MAX_WAIT_MS = 60_000;
  const start = Date.now();
  let lastCount = -1;
  let stablePolls = 0;
  let latestMessages: AssistantMessage[] = [];

  while (Date.now() - start < MAX_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const messagesResult = await client.session.messages({ path: { id: sessionID } });
    latestMessages = (((messagesResult as { data?: unknown }).data ?? messagesResult) as AssistantMessage[]) ?? [];
    if (Date.now() - start < MIN_STABILITY_TIME_MS) {
      lastCount = latestMessages.length;
      continue;
    }
    if (latestMessages.length === lastCount) {
      stablePolls += 1;
      if (stablePolls >= STABILITY_POLLS_REQUIRED) {
        return latestMessages;
      }
    } else {
      stablePolls = 0;
      lastCount = latestMessages.length;
    }
  }

  return latestMessages;
}

export async function runSpecialistSession(input: {
  runtime: PluginInput;
  toolContext: ToolContext;
  invocation: SpecialistInvocation;
}): Promise<SpecialistResponse> {
  const { runtime, toolContext, invocation } = input;
  if (!runtime.client) {
    throw new Error("OpenCode client is not available for delegated specialist session");
  }

  const parentSession = await runtime.client.session.get({
    path: { id: toolContext.sessionID },
  }).catch(() => null);
  const parentDirectory = (parentSession as { data?: { directory?: string } } | null)?.data?.directory ?? toolContext.directory ?? runtime.directory;

  const createResult = await runtime.client.session.create({
    body: {
      parentID: toolContext.sessionID,
      title: `${invocation.description} (@${invocation.agent})`,
    },
    query: {
      directory: parentDirectory,
    },
  });

  const sessionID = (createResult as { data?: { id?: string } }).data?.id;
  if (!sessionID) {
    throw new Error(`failed to create delegated session for ${invocation.agent}`);
  }

  await runtime.client.session.prompt({
    path: { id: sessionID },
    body: {
      agent: invocation.agent,
      tools: {
        task: false,
        delegate_task: false,
        call_omo_agent: false,
      },
      parts: [{ type: "text", text: invocation.prompt }],
    },
  });

  const messages = await waitForStableMessages(runtime.client, sessionID);
  const text = extractAssistantText(messages);
  return {
    sessionID,
    text,
    rawExcerpt: buildRawExcerpt(text),
  };
}
