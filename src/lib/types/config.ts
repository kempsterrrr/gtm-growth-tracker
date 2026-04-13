export interface TrackedRepoConfig {
  owner: string;
  name: string;
  display_name?: string;
}

export interface TrackedPackageConfig {
  name: string;
  display_name?: string;
  github_repo?: string; // "owner/name" format
}

export interface GtmConfig {
  github: {
    repos: TrackedRepoConfig[];
  };
  packages: {
    npm: TrackedPackageConfig[];
    pypi: TrackedPackageConfig[];
  };
  collection: {
    npm_backfill_from?: string; // "YYYY-MM-DD"
  };
}
