import { describe, expect, it } from "vitest";

describe("StoryboardSegmentsSchema", () => {
  it("rejects duplicate or out-of-order storyboard segment indices", async () => {
    const { StoryboardSegmentsSchema } = await import("@/lib/services/storyboards");

    expect(() =>
      StoryboardSegmentsSchema.parse([
        {
          index: 1,
          durationSeconds: 15,
          scene: "Scene 1",
          shot: "Shot 1",
          action: "Action 1",
          dialogue: "",
          videoPrompt: "Prompt 1",
        },
        {
          index: 1,
          durationSeconds: 15,
          scene: "Scene 2",
          shot: "Shot 2",
          action: "Action 2",
          dialogue: "",
          videoPrompt: "Prompt 2",
        },
      ]),
    ).toThrowError();

    expect(() =>
      StoryboardSegmentsSchema.parse([
        {
          index: 2,
          durationSeconds: 15,
          scene: "Scene 1",
          shot: "Shot 1",
          action: "Action 1",
          dialogue: "",
          videoPrompt: "Prompt 1",
        },
        {
          index: 1,
          durationSeconds: 15,
          scene: "Scene 2",
          shot: "Shot 2",
          action: "Action 2",
          dialogue: "",
          videoPrompt: "Prompt 2",
        },
      ]),
    ).toThrowError();
  });
});
