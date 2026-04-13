"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Bell, Check, Plus, Trash2, MessageSquare } from "lucide-react";
import type { FiredAlert, AlertRuleType, AlertRuleConfig } from "@/lib/types/sales-intelligence";

interface AlertRule {
  id: number;
  name: string;
  description: string | null;
  ruleType: AlertRuleType;
  config: string;
  enabled: number;
  notifySlack: number;
}

const RULE_TYPE_LABELS: Record<AlertRuleType, string> = {
  score_threshold: "Score Threshold",
  new_company: "New Company",
  engagement_spike: "Engagement Spike",
  new_enterprise_user: "Enterprise User",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<FiredAlert[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState<AlertRuleType>("score_threshold");
  const [ruleConfig, setRuleConfig] = useState('{"min_score": 15, "min_users": 2}');

  useEffect(() => {
    Promise.all([
      fetch("/api/alerts?acknowledged=false").then((r) => r.json()),
      fetch("/api/alerts/rules").then((r) => r.json()),
    ]).then(([a, r]: [FiredAlert[], AlertRule[]]) => {
      setAlerts(a);
      setRules(r);
      setLoading(false);
    });
  }, []);

  async function acknowledgeAlert(id: number) {
    await fetch("/api/alerts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, acknowledged: 1 }),
    });
    setAlerts(alerts.filter((a) => a.id !== id));
  }

  async function toggleRule(id: number, enabled: number) {
    await fetch("/api/alerts/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled: enabled ? 0 : 1 }),
    });
    setRules(rules.map((r) => (r.id === id ? { ...r, enabled: enabled ? 0 : 1 } : r)));
  }

  async function deleteRule(id: number) {
    await fetch(`/api/alerts/rules?id=${id}`, { method: "DELETE" });
    setRules(rules.filter((r) => r.id !== id));
  }

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    let config: AlertRuleConfig;
    try {
      config = JSON.parse(ruleConfig);
    } catch {
      alert("Invalid JSON config");
      return;
    }
    const res = await fetch("/api/alerts/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: ruleName, ruleType, config }),
    });
    const newRule: AlertRule = await res.json();
    setRules([...rules, newRule]);
    setShowRuleForm(false);
    setRuleName("");
  }

  return (
    <div className="flex flex-col h-full">
      <header className="border-b px-6 py-4">
        <h2 className="text-xl font-semibold tracking-tight">Alerts</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Sales signals and configurable triggers
        </p>
      </header>

      <div className="flex-1 p-6">
        <Tabs defaultValue="alerts">
          <TabsList>
            <TabsTrigger value="alerts">
              Alerts {alerts.length > 0 && `(${alerts.length})`}
            </TabsTrigger>
            <TabsTrigger value="rules">Rules ({rules.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="alerts">
            <div className="space-y-3 mt-4">
              {!loading && alerts.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-center">
                  <Bell className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No active alerts</h3>
                  <p className="text-muted-foreground">
                    Alerts will appear here when engagement thresholds are crossed.
                  </p>
                </div>
              )}

              {alerts.map((alert) => (
                <Card key={alert.id}>
                  <CardContent className="flex items-center justify-between py-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{alert.title}</span>
                        <Badge variant="outline" className="text-xs">
                          {RULE_TYPE_LABELS[alert.ruleType]}
                        </Badge>
                        {alert.slackSent && (
                          <MessageSquare className="h-3 w-3 text-muted-foreground" />
                        )}
                      </div>
                      {alert.detail && (
                        <p className="text-sm text-muted-foreground">{alert.detail}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(alert.firedAt).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => acknowledgeAlert(alert.id)}
                    >
                      <Check className="h-4 w-4" /> Dismiss
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="rules">
            <div className="space-y-4 mt-4">
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setShowRuleForm(!showRuleForm)}>
                  <Plus className="h-4 w-4" /> Add Rule
                </Button>
              </div>

              {showRuleForm && (
                <form onSubmit={createRule} className="border rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium block mb-1">Name</label>
                      <input
                        type="text"
                        value={ruleName}
                        onChange={(e) => setRuleName(e.target.value)}
                        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                        placeholder="My alert rule"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium block mb-1">Type</label>
                      <select
                        value={ruleType}
                        onChange={(e) => setRuleType(e.target.value as AlertRuleType)}
                        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                      >
                        {Object.entries(RULE_TYPE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Config (JSON)</label>
                    <textarea
                      value={ruleConfig}
                      onChange={(e) => setRuleConfig(e.target.value)}
                      className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono min-h-[60px]"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">Create</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowRuleForm(false)}>Cancel</Button>
                  </div>
                </form>
              )}

              {rules.map((rule) => {
                let configObj: AlertRuleConfig = {};
                try { configObj = JSON.parse(rule.config); } catch { /* ignore */ }
                return (
                  <Card key={rule.id}>
                    <CardHeader className="py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-sm">{rule.name}</CardTitle>
                          <CardDescription className="text-xs">
                            {RULE_TYPE_LABELS[rule.ruleType]}
                            {configObj.min_score && ` · Score ≥ ${configObj.min_score}`}
                            {configObj.min_users && ` · Users ≥ ${configObj.min_users}`}
                            {configObj.percent_increase && ` · +${configObj.percent_increase}% in ${configObj.window_days || 7}d`}
                            {configObj.domains && ` · ${configObj.domains.join(", ")}`}
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant={rule.enabled ? "default" : "outline"}
                            onClick={() => toggleRule(rule.id, rule.enabled)}
                          >
                            {rule.enabled ? "Enabled" : "Disabled"}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteRule(rule.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
