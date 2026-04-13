export interface NpmDownloadPoint {
  downloads: number;
  day: string;
}

export interface NpmRangeResponse {
  package: string;
  start: string;
  end: string;
  downloads: NpmDownloadPoint[];
}

export interface NpmPointResponse {
  downloads: number;
  start: string;
  end: string;
  package: string;
}

const NPM_API_BASE = "https://api.npmjs.org/downloads";

export async function getNpmRangeDownloads(
  pkg: string,
  startDate: string,
  endDate: string
): Promise<NpmDownloadPoint[]> {
  // npm API allows max 365 days per request
  const allDownloads: NpmDownloadPoint[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  let chunkStart = new Date(start);
  while (chunkStart < end) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + 364);
    const actualEnd = chunkEnd > end ? end : chunkEnd;

    const startStr = formatDate(chunkStart);
    const endStr = formatDate(actualEnd);
    const encodedPkg = encodeURIComponent(pkg);

    const url = `${NPM_API_BASE}/range/${startStr}:${endStr}/${encodedPkg}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      if (resp.status === 404) {
        console.warn(`Package ${pkg} not found on npm`);
        return [];
      }
      throw new Error(`npm API error: ${resp.status} ${resp.statusText} for ${url}`);
    }

    const data: NpmRangeResponse = await resp.json();
    allDownloads.push(...data.downloads);

    chunkStart = new Date(actualEnd);
    chunkStart.setDate(chunkStart.getDate() + 1);

    // Be a good citizen
    if (chunkStart < end) {
      await sleep(100);
    }
  }

  return allDownloads;
}

export async function getNpmPointDownloads(
  pkg: string,
  period: "last-day" | "last-week" | "last-month" | "last-year"
): Promise<NpmPointResponse> {
  const encodedPkg = encodeURIComponent(pkg);
  const url = `${NPM_API_BASE}/point/${period}/${encodedPkg}`;
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`npm API error: ${resp.status} ${resp.statusText}`);
  }

  return resp.json();
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
