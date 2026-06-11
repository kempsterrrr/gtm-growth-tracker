import { describe, it, expect, vi, afterEach } from "vitest";
import { getPypiOverallDownloads } from "./pypi-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getPypiOverallDownloads", () => {
  it("requests real installs only, excluding mirror/CDN traffic", async () => {
    let requestedUrl = "";
    const fetchMock = vi.fn(async (url: string) => {
      requestedUrl = url;
      return new Response(
        JSON.stringify({ data: [], package: "turbo-sdk", type: "overall" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await getPypiOverallDownloads("turbo-sdk");

    expect(requestedUrl).toContain("mirrors=false");
    expect(requestedUrl).not.toContain("mirrors=true");
  });
});
