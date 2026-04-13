const PYPISTATS_API_BASE = "https://pypistats.org/api";

export interface PypiOverallData {
  data: Array<{
    category: string;
    date: string;
    downloads: number;
  }>;
  package: string;
  type: string;
}

export interface PypiRecentData {
  data: {
    last_day: number;
    last_month: number;
    last_week: number;
  };
  package: string;
  type: string;
}

export interface PypiSystemData {
  data: Array<{
    category: string;
    date: string;
    downloads: number;
  }>;
  package: string;
  type: string;
}

export async function getPypiOverallDownloads(pkg: string): Promise<PypiOverallData> {
  const url = `${PYPISTATS_API_BASE}/packages/${encodeURIComponent(pkg)}/overall?mirrors=true`;
  const resp = await fetch(url);

  if (!resp.ok) {
    if (resp.status === 404) {
      console.warn(`Package ${pkg} not found on PyPI`);
      return { data: [], package: pkg, type: "overall" };
    }
    throw new Error(`PyPI Stats API error: ${resp.status} ${resp.statusText}`);
  }

  return resp.json();
}

export async function getPypiRecentDownloads(pkg: string): Promise<PypiRecentData> {
  const url = `${PYPISTATS_API_BASE}/packages/${encodeURIComponent(pkg)}/recent`;
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`PyPI Stats API error: ${resp.status} ${resp.statusText}`);
  }

  return resp.json();
}

export async function getPypiSystemDownloads(pkg: string): Promise<PypiSystemData> {
  const url = `${PYPISTATS_API_BASE}/packages/${encodeURIComponent(pkg)}/system?mirrors=true`;
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`PyPI Stats API error: ${resp.status} ${resp.statusText}`);
  }

  return resp.json();
}

export async function getPypiPythonVersionDownloads(pkg: string): Promise<PypiSystemData> {
  const url = `${PYPISTATS_API_BASE}/packages/${encodeURIComponent(pkg)}/python_major?mirrors=true`;
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`PyPI Stats API error: ${resp.status} ${resp.statusText}`);
  }

  return resp.json();
}
