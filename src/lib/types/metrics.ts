export interface GithubRepoMetric {
  date: string;
  stars: number | null;
  forks: number | null;
  watchers: number | null;
  openIssues: number | null;
  contributors: number | null;
}

export interface GithubTrafficMetric {
  date: string;
  total: number;
  unique: number;
}

export interface DownloadMetric {
  date: string;
  downloads: number;
}

export interface ReverseDependencyInfo {
  dependentName: string;
  dependentRegistry: string;
  dependentVersion: string | null;
  firstSeen: string;
}

export interface ReverseDependencyCount {
  date: string;
  count: number;
}

export interface PackageMetricSummary {
  packageName: string;
  registry: string;
  displayName: string | null;
  totalDownloadsLast7d: number;
  totalDownloadsLast30d: number;
  growthPercent7d: number; // WoW change
}

export interface RepoMetricSummary {
  owner: string;
  name: string;
  displayName: string | null;
  stars: number;
  forks: number;
  starsGrowth7d: number;
}
