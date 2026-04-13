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
