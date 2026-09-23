/**
 * TanStack Start adapter for src/components/screens/settings-screen.tsx --
 * identical UX/copy/audit behavior; the React 19 useActionState/<form
 * action> pattern is replaced with local state calling
 * setAutomationStateFn directly, and next/navigation's router.refresh() is
 * replaced with TanStack Router's router.invalidate({ sync: true }) (the
 * documented equivalent -- re-runs the route's loader so the parent
 * _internal layout's counts and this page's own data reflect the change).
 * Only exists on the TanStack port branch.
 */
"use client";

import * as React from "react";
import { useRouter } from "@tanstack/react-router";
import { Power, CircleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { setAutomationStateFn, type AutomationSwitchState } from "@/lib/settings.functions";

export function SettingsScreen({
  enabled: initialEnabled,
  preparedCount,
  portalRunCount,
}: {
  enabled: boolean;
  preparedCount: number;
  portalRunCount: number;
}) {
  const router = useRouter();
  const [state, setState] = React.useState<AutomationSwitchState>({ enabled: initialEnabled, error: null });
  const [pending, setPending] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const { enabled, error } = state;
  const nextValue = !enabled;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await setAutomationStateFn({
        data: { nextEnabled: nextValue, reason, currentEnabled: enabled },
      });
      setState(result);
      if (!result.error) {
        setReason("");
        await router.invalidate({ sync: true });
      }
    } catch {
      setState({ enabled, error: "Failed to change this setting" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Power className="h-4 w-4" /> Global automation kill switch
          </CardTitle>
          <CardDescription>
            Stops new automated external actions. Does not delete queued evidence or close cases;
            internal timers and tasks continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Global automation</p>
              <p className="text-xs text-muted-foreground">Currently {enabled ? "enabled" : "disabled"}</p>
            </div>
            <Badge tone={enabled ? "success" : "danger"}>{enabled ? "ON" : "OFF"}</Badge>
          </div>

          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            {nextValue ? (
              <>Re-enabling resumes scheduling for all prepared work.</>
            ) : (
              <>
                If disabled now: <strong>{preparedCount}</strong> prepared communication
                {preparedCount === 1 ? "" : "s"} pause; <strong>{portalRunCount}</strong> assisted portal
                run{portalRunCount === 1 ? "" : "s"} remain available for manual review; internal timers and
                tasks continue.
              </>
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="kill-reason">Reason for change</Label>
              <Textarea
                id="kill-reason"
                name="reason"
                rows={3}
                required
                placeholder="Required before disabling or re-enabling automation"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={pending} variant={nextValue ? "primary" : "danger"}>
                {pending ? "Saving…" : nextValue ? "Enable automation" : "Disable automation"}
              </Button>
              {error ? (
                <span className="flex items-center gap-1.5 text-xs text-danger" role="alert">
                  <CircleAlert className="h-3.5 w-3.5" /> {error}
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Client and action modes</CardTitle>
          <CardDescription>
            Per-client/action automation mode (manual/prepare/assist/automatic). Government portal
            actions are capped at Assist.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            Per-client mode editing is not available yet. Each case shows and enforces its own automation
            mode in the Automation state panel on the case page.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
