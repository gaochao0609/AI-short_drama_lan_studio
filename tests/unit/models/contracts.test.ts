import { describe, expect, it } from "vitest";

const validTaskTypes = [
  "script_question_generate",
  "script_finalize",
  "storyboard_split",
  "image_generate",
  "image_edit",
  "video_generate",
] as const;

describe("model contracts", () => {
  it("accepts the supported task types and fills request defaults", async () => {
    const { ModelRequestSchema } = await import("@/lib/models/contracts");

    for (const taskType of validTaskTypes) {
      const parsed = ModelRequestSchema.parse({
        taskType,
        providerKey: "script",
        model: "gpt-4.1-mini",
        traceId: "trace-123",
      });

      expect(parsed).toEqual({
        taskType,
        providerKey: "script",
        model: "gpt-4.1-mini",
        inputFiles: [],
        options: {},
        traceId: "trace-123",
      });
    }
  });

  it("rejects unsupported task types", async () => {
    const { ModelRequestSchema } = await import("@/lib/models/contracts");

    expect(() =>
      ModelRequestSchema.parse({
        taskType: "voice_clone",
        providerKey: "script",
        model: "gpt-4.1-mini",
        traceId: "trace-123",
      }),
    ).toThrowError();
  });
});
