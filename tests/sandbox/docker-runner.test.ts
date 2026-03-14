import { describe, expect, it } from "vitest";
import { prepareDockerSandbox } from "../../src/sandbox/docker-runner";
import { experiment_prepare_sandbox } from "../../src/tools";

describe("docker sandbox runner", () => {
  it("allows writes inside editable paths and blocks non-whitelisted writes", () => {
    const allowed = prepareDockerSandbox({
      workspace_root: "/tmp/workspace",
      editable_paths: ["src/**"],
      read_only_paths: ["data/**"],
      allowed_runtime_outputs: ["outputs/**"],
      sample_write_path: "src/train.py",
    });
    const blocked = prepareDockerSandbox({
      workspace_root: "/tmp/workspace",
      editable_paths: ["src/**"],
      read_only_paths: ["data/**"],
      allowed_runtime_outputs: ["outputs/**"],
      sample_write_path: "secrets/token.txt",
    });
    expect(allowed.valid).toBe(true);
    expect(blocked.status).toBe("sandbox_violation");
  });

  it("accepts direct sandbox arguments without requiring an input wrapper", async () => {
    const result = JSON.parse(
      await experiment_prepare_sandbox.execute({
        workspace_root: "/tmp/workspace",
        editable_paths: ["src/**"],
        read_only_paths: ["data/**"],
        allowed_runtime_outputs: ["outputs/**"],
      }),
    );
    expect(result.status).toBe("ready");
  });
});
