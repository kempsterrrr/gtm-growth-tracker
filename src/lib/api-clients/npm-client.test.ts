import { describe, it, expect, vi, afterEach } from "vitest";
import { getNpmRangeDownloads } from "./npm-client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getNpmRangeDownloads", () => {
  it("returns the single day's downloads when start === end (daily collection)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        package: "@irys/sdk",
        start: "2026-06-09",
        end: "2026-06-09",
        downloads: [{ downloads: 4462, day: "2026-06-09" }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getNpmRangeDownloads("@irys/sdk", "2026-06-09", "2026-06-09");

    expect(result).toEqual([{ downloads: 4462, day: "2026-06-09" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches a sub-365-day range in a single request without double-counting", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        package: "pkg",
        start: "2026-06-07",
        end: "2026-06-09",
        downloads: [
          { downloads: 1, day: "2026-06-07" },
          { downloads: 2, day: "2026-06-08" },
          { downloads: 3, day: "2026-06-09" },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getNpmRangeDownloads("pkg", "2026-06-07", "2026-06-09");

    expect(result).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
