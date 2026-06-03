const DEPS_DEV_API_BASE = "https://api.deps.dev/v3alpha";

export interface DepsDevPackageInfo {
  packageKey: {
    system: string;
    name: string;
  };
  versions: Array<{
    versionKey: {
      system: string;
      name: string;
      version: string;
    };
    publishedAt: string;
    isDefault: boolean;
  }>;
}

export interface DepsDevDependentNode {
  name: string;
  version: string;
}

export interface DepsDevDependentsResponse {
  dependentCount: number;
  nodes?: DepsDevDependentNode[];
  nextPageToken?: string;
}

type DepsDevSystem = "npm" | "pypi" | "go" | "maven" | "cargo";

function registryToSystem(registry: string): DepsDevSystem {
  const map: Record<string, DepsDevSystem> = {
    npm: "npm",
    pypi: "pypi",
  };
  return map[registry] || (registry as DepsDevSystem);
}

export async function getPackageInfo(
  registry: string,
  pkg: string
): Promise<DepsDevPackageInfo | null> {
  const system = registryToSystem(registry);
  const encodedPkg = encodeURIComponent(pkg);
  const url = `${DEPS_DEV_API_BASE}/systems/${system}/packages/${encodedPkg}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    if (resp.status === 404) return null;
    throw new Error(`deps.dev API error: ${resp.status} ${resp.statusText}`);
  }

  return resp.json();
}

export interface DepsDevVersionResponse {
  relatedProjects?: Array<{ projectKey: { id: string }; relationType: string }>;
  links?: Array<{ label: string; url: string }>;
}

/** Resolve a dependent package's source repo as "github.com/owner/name" via
 *  deps.dev GetVersion (default version looked up when none is stored).
 *  Returns null for unknown packages and non-GitHub sources — callers skip
 *  those dependents. fetchImpl is the test seam. */
export async function getPackageSourceRepo(
  registry: string,
  pkg: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const system = registryToSystem(registry);
  const encodedPkg = encodeURIComponent(pkg);

  let v = version;
  if (!v) {
    const infoResp = await fetchImpl(
      `${DEPS_DEV_API_BASE}/systems/${system}/packages/${encodedPkg}`
    );
    if (!infoResp.ok) return null;
    const info: DepsDevPackageInfo = await infoResp.json();
    v = info.versions?.find((x) => x.isDefault)?.versionKey.version ?? null;
    if (!v) return null;
  }

  const resp = await fetchImpl(
    `${DEPS_DEV_API_BASE}/systems/${system}/packages/${encodedPkg}/versions/${encodeURIComponent(v)}`
  );
  if (!resp.ok) return null;
  const data: DepsDevVersionResponse = await resp.json();

  const related = data.relatedProjects?.find(
    (p) => p.relationType === "SOURCE_REPO" && p.projectKey.id.startsWith("github.com/")
  );
  if (related) return related.projectKey.id;

  const link = data.links?.find((l) => l.label === "SOURCE_REPO" && l.url.includes("github.com/"));
  if (link) {
    const m = link.url.match(/github\.com\/([^/]+)\/([^/?#]+)/);
    if (m) return `github.com/${m[1]}/${m[2].replace(/\.git$/, "")}`;
  }
  return null;
}

export async function getDependents(
  registry: string,
  pkg: string
): Promise<{ count: number; dependents: Array<{ name: string; version: string }> }> {
  const system = registryToSystem(registry);
  const encodedPkg = encodeURIComponent(pkg);
  const url = `${DEPS_DEV_API_BASE}/systems/${system}/packages/${encodedPkg}/dependents`;

  const resp = await fetch(url);
  if (!resp.ok) {
    if (resp.status === 404) return { count: 0, dependents: [] };
    throw new Error(`deps.dev API error: ${resp.status} ${resp.statusText}`);
  }

  const data: DepsDevDependentsResponse = await resp.json();
  return {
    count: data.dependentCount || 0,
    dependents: data.nodes || [],
  };
}
