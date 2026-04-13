"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Play, Loader2, MessageSquare } from "lucide-react";

interface TrackedRepo {
  id: number;
  owner: string;
  name: string;
  displayName: string | null;
}

interface TrackedPackage {
  id: number;
  registry: string;
  name: string;
  displayName: string | null;
  repoId: number | null;
}

export default function SettingsPage() {
  const [repos, setRepos] = useState<TrackedRepo[]>([]);
  const [packages, setPackages] = useState<TrackedPackage[]>([]);
  const [collecting, setCollecting] = useState(false);
  const [collectResult, setCollectResult] = useState<string[]>([]);

  // Form state
  const [showRepoForm, setShowRepoForm] = useState(false);
  const [repoOwner, setRepoOwner] = useState("");
  const [repoName, setRepoName] = useState("");
  const [repoDisplayName, setRepoDisplayName] = useState("");

  const [showPkgForm, setShowPkgForm] = useState(false);
  const [pkgRegistry, setPkgRegistry] = useState("npm");
  const [pkgName, setPkgName] = useState("");
  const [pkgDisplayName, setPkgDisplayName] = useState("");

  async function fetchConfig() {
    const res = await fetch("/api/config");
    const data = await res.json();
    setRepos(data.repos);
    setPackages(data.packages);
  }

  useEffect(() => {
    fetchConfig();
  }, []);

  async function addRepo(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "repo",
        data: {
          owner: repoOwner,
          name: repoName,
          displayName: repoDisplayName || undefined,
        },
      }),
    });
    setRepoOwner("");
    setRepoName("");
    setRepoDisplayName("");
    setShowRepoForm(false);
    fetchConfig();
  }

  async function addPackage(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "package",
        data: {
          registry: pkgRegistry,
          name: pkgName,
          displayName: pkgDisplayName || undefined,
        },
      }),
    });
    setPkgName("");
    setPkgDisplayName("");
    setShowPkgForm(false);
    fetchConfig();
  }

  async function triggerCollection() {
    setCollecting(true);
    setCollectResult([]);
    try {
      const res = await fetch("/api/collect", { method: "POST" });
      const data = await res.json();
      setCollectResult(data.results || [data.error || "Unknown error"]);
    } catch (err) {
      setCollectResult([`Error: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setCollecting(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="border-b px-6 py-4">
        <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
      </header>

      <div className="flex-1 p-6 space-y-6 max-w-4xl">
        {/* Tracked Repos */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Tracked Repositories</CardTitle>
                <CardDescription>GitHub repos to monitor for stars, forks, traffic, and releases</CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowRepoForm(!showRepoForm)}>
                <Plus className="h-4 w-4" />
                Add Repo
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showRepoForm && (
              <form onSubmit={addRepo} className="border rounded-lg p-4 mb-4 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-sm font-medium block mb-1">Owner</label>
                    <input
                      type="text"
                      value={repoOwner}
                      onChange={(e) => setRepoOwner(e.target.value)}
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                      placeholder="anthropics"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Name</label>
                    <input
                      type="text"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                      placeholder="claude-code"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Display Name</label>
                    <input
                      type="text"
                      value={repoDisplayName}
                      onChange={(e) => setRepoDisplayName(e.target.value)}
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                      placeholder="Claude Code"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm">Add</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowRepoForm(false)}>Cancel</Button>
                </div>
              </form>
            )}

            {repos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No repos tracked yet.</p>
            ) : (
              <div className="space-y-2">
                {repos.map((repo) => (
                  <div key={repo.id} className="flex items-center justify-between border rounded-md px-3 py-2">
                    <div>
                      <span className="font-medium text-sm">{repo.owner}/{repo.name}</span>
                      {repo.displayName && (
                        <span className="text-muted-foreground text-sm ml-2">({repo.displayName})</span>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs">GitHub</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tracked Packages */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Tracked Packages</CardTitle>
                <CardDescription>npm and PyPI packages to monitor for downloads and dependencies</CardDescription>
              </div>
              <Button size="sm" onClick={() => setShowPkgForm(!showPkgForm)}>
                <Plus className="h-4 w-4" />
                Add Package
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showPkgForm && (
              <form onSubmit={addPackage} className="border rounded-lg p-4 mb-4 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-sm font-medium block mb-1">Registry</label>
                    <select
                      value={pkgRegistry}
                      onChange={(e) => setPkgRegistry(e.target.value)}
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                    >
                      <option value="npm">npm</option>
                      <option value="pypi">PyPI</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Package Name</label>
                    <input
                      type="text"
                      value={pkgName}
                      onChange={(e) => setPkgName(e.target.value)}
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                      placeholder="@anthropic-ai/sdk"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Display Name</label>
                    <input
                      type="text"
                      value={pkgDisplayName}
                      onChange={(e) => setPkgDisplayName(e.target.value)}
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                      placeholder="Anthropic JS SDK"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm">Add</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowPkgForm(false)}>Cancel</Button>
                </div>
              </form>
            )}

            {packages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No packages tracked yet.</p>
            ) : (
              <div className="space-y-2">
                {packages.map((pkg) => (
                  <div key={pkg.id} className="flex items-center justify-between border rounded-md px-3 py-2">
                    <div>
                      <span className="font-medium text-sm">{pkg.name}</span>
                      {pkg.displayName && (
                        <span className="text-muted-foreground text-sm ml-2">({pkg.displayName})</span>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs">{pkg.registry}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Slack Integration */}
        <SlackConfigCard />

        {/* Data Collection */}
        <Card>
          <CardHeader>
            <CardTitle>Data Collection</CardTitle>
            <CardDescription>Manually trigger data collection from all configured sources (includes sales intelligence pipeline)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Button onClick={triggerCollection} disabled={collecting}>
                {collecting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Collecting...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Run Collection Now
                  </>
                )}
              </Button>

              {collectResult.length > 0 && (
                <div className="border rounded-lg p-3 space-y-1">
                  {collectResult.map((r, i) => (
                    <p key={i} className="text-sm text-muted-foreground">
                      {r}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SlackConfigCard() {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [channelName, setChannelName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/slack")
      .then((r) => r.json())
      .then((data: { configured: boolean; channelName: string; enabled: boolean }) => {
        setConfigured(data.configured);
        setChannelName(data.channelName);
        setEnabled(data.enabled);
      });
  }, []);

  async function saveSlack(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/settings/slack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookUrl: webhookUrl || undefined, channelName, enabled }),
    });
    setConfigured(!!webhookUrl);
    setTestResult("Saved!");
  }

  async function testSlack() {
    if (!webhookUrl) return;
    setTesting(true);
    const res = await fetch("/api/settings/slack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: true, webhookUrl }),
    });
    const data = await res.json();
    setTestResult(data.success ? "Test message sent!" : "Failed to send test message");
    setTesting(false);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          <div>
            <CardTitle>Slack Integration</CardTitle>
            <CardDescription>Send sales signal alerts to a Slack channel</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={saveSlack} className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1">Webhook URL</label>
            <input
              type="password"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              placeholder={configured ? "••••••• (configured)" : "https://hooks.slack.com/services/..."}
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Channel Name (optional)</label>
            <input
              type="text"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              placeholder="#sales-signals"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="slack-enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="slack-enabled" className="text-sm">Enable notifications</label>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">Save</Button>
            <Button type="button" variant="outline" size="sm" onClick={testSlack} disabled={!webhookUrl || testing}>
              {testing ? "Sending..." : "Test Connection"}
            </Button>
          </div>
          {testResult && (
            <p className="text-sm text-muted-foreground">{testResult}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
