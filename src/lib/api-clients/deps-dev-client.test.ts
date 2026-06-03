import { describe, it, expect } from "vitest";
import { getPackageSourceRepo } from "./deps-dev-client";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("getPackageSourceRepo", () => {
  it("resolves the SOURCE_REPO related project for a versioned dependent", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      expect(String(url)).toContain("/systems/npm/packages/acme-app/versions/1.2.3");
      return jsonResponse({
        relatedProjects: [
          { projectKey: { id: "github.com/acme/app" }, relationType: "SOURCE_REPO" },
        ],
      });
    }) as typeof fetch;
    expect(await getPackageSourceRepo("npm", "acme-app", "1.2.3", fetchImpl)).toBe(
      "github.com/acme/app"
    );
  });

  it("falls back to the default version, then to SOURCE_REPO links", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith("/packages/acme-app")) {
        return jsonResponse({
          packageKey: { system: "NPM", name: "acme-app" },
          versions: [
            {
              versionKey: { system: "NPM", name: "acme-app", version: "2.0.0" },
              publishedAt: "",
              isDefault: true,
            },
          ],
        });
      }
      return jsonResponse({
        links: [{ label: "SOURCE_REPO", url: "https://github.com/acme/app" }],
      });
    }) as typeof fetch;
    expect(await getPackageSourceRepo("npm", "acme-app", null, fetchImpl)).toBe(
      "github.com/acme/app"
    );
    expect(calls[1]).toContain("/versions/2.0.0");
  });

  it("returns null on 404s and non-github sources", async () => {
    expect(
      await getPackageSourceRepo(
        "npm",
        "ghost",
        "1.0.0",
        (async () => jsonResponse({}, 404)) as typeof fetch
      )
    ).toBeNull();
    expect(
      await getPackageSourceRepo(
        "npm",
        "gl",
        "1.0.0",
        (async () =>
          jsonResponse({
            relatedProjects: [
              { projectKey: { id: "gitlab.com/x/y" }, relationType: "SOURCE_REPO" },
            ],
          })) as typeof fetch
      )
    ).toBeNull();
  });
});
