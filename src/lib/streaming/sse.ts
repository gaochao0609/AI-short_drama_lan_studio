const encoder = new TextEncoder();

type SseEvent = {
  event?: string;
  data?: unknown;
};

function serializeEvent(input: SseEvent) {
  const lines: string[] = [];

  if (input.event) {
    lines.push(`event: ${input.event}`);
  }

  if (input.data !== undefined) {
    const serialized =
      typeof input.data === "string" ? input.data : JSON.stringify(input.data);
    for (const line of serialized.split(/\r?\n/)) {
      lines.push(`data: ${line}`);
    }
  }

  return `${lines.join("\n")}\n\n`;
}

export function createSseResponse(
  stream: ReadableStream<Uint8Array>,
  init: ResponseInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-cache, no-transform");
  headers.set("connection", "keep-alive");

  return new Response(stream, {
    ...init,
    headers,
  });
}

export function streamTextAsSse(input: {
  upstream: ReadableStream<Uint8Array>;
  initialEvents?: SseEvent[];
  onComplete?: (fullText: string) => Promise<void> | void;
}) {
  const decoder = new TextDecoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = input.upstream.getReader();
      let fullText = "";

      try {
        for (const event of input.initialEvents ?? []) {
          controller.enqueue(encoder.encode(serializeEvent(event)));
        }

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          const chunk = decoder.decode(value, { stream: true });

          if (!chunk) {
            continue;
          }

          fullText += chunk;
          controller.enqueue(
            encoder.encode(
              serializeEvent({
                event: "question",
                data: {
                  delta: chunk,
                },
              }),
            ),
          );
        }

        fullText += decoder.decode();
        const questionText = fullText.trim();

        if (input.onComplete) {
          await input.onComplete(questionText);
        }

        controller.enqueue(
          encoder.encode(
            serializeEvent({
              event: "done",
              data: {
                questionText,
              },
            }),
          ),
        );
        controller.close();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to stream SSE response";

        controller.enqueue(
          encoder.encode(
            serializeEvent({
              event: "error",
              data: {
                message,
              },
            }),
          ),
        );
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
  });
}
