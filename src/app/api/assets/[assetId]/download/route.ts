export const runtime = "nodejs";

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { requireUser } from "@/lib/auth/guards";
import { toErrorResponse } from "@/lib/services/errors";
import { readOwnedProjectAsset } from "@/lib/services/projects";

type AssetRouteContext = {
  params: Promise<{ assetId: string }> | { assetId: string };
};

type RangeParseResult =
  | {
      ok: true;
      start: number;
      end: number;
    }
  | {
      ok: false;
    };

function parseRangeHeader(rangeHeader: string | null, sizeBytes: number) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return { ok: false } satisfies RangeParseResult;
  }

  const [, startText, endText] = match;
  let start: number;
  let end: number;

  if (startText === "" && endText === "") {
    return { ok: false } satisfies RangeParseResult;
  }

  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return { ok: false } satisfies RangeParseResult;
    }

    start = Math.max(sizeBytes - suffixLength, 0);
    end = sizeBytes - 1;
  } else {
    start = Number(startText);
    end = endText === "" ? sizeBytes - 1 : Number(endText);
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= sizeBytes
  ) {
    return { ok: false } satisfies RangeParseResult;
  }

  return {
    ok: true,
    start,
    end: Math.min(end, sizeBytes - 1),
  } satisfies RangeParseResult;
}

async function readAssetId(context: AssetRouteContext) {
  const params = await context.params;
  return params.assetId;
}

export async function GET(request: Request, context: AssetRouteContext) {
  try {
    const user = await requireUser();
    const assetId = await readAssetId(context);
    const asset = await readOwnedProjectAsset(assetId, user.userId);

    if (asset.mimeType.startsWith("video/")) {
      const fileStat = await stat(asset.filePath);
      const range = parseRangeHeader(request.headers.get("range"), fileStat.size);

      if (range && !range.ok) {
        return new Response(null, {
          status: 416,
          headers: {
            "accept-ranges": "bytes",
            "cache-control": "private, max-age=60",
            "content-range": `bytes */${fileStat.size}`,
          },
        });
      }

      const start = range?.start ?? 0;
      const end = range?.end ?? fileStat.size - 1;
      const contentLength = end - start + 1;
      const body = Readable.toWeb(createReadStream(asset.filePath, { start, end })) as ReadableStream;

      return new Response(body, {
        status: range ? 206 : 200,
        headers: {
          "accept-ranges": "bytes",
          "cache-control": "private, max-age=60",
          "content-length": String(contentLength),
          "content-type": asset.mimeType,
          "content-disposition": `inline; filename="${asset.originalName ?? `${asset.id}.bin`}"`,
          ...(range
            ? {
                "content-range": `bytes ${start}-${end}/${fileStat.size}`,
              }
            : {}),
        },
      });
    }

    const bytes = await readFile(asset.filePath);

    return new Response(bytes, {
      status: 200,
      headers: {
        "cache-control": "private, max-age=60",
        "content-length": String(bytes.length),
        "content-type": asset.mimeType,
        "content-disposition": `inline; filename="${asset.originalName ?? `${asset.id}.bin`}"`,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
