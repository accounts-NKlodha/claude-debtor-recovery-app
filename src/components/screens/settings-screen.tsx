"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Power, CircleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { setAutomationStateAction, type AutomationSwitchState } from "@/app/actions/settings";

function SaveButton({ nextValue }: { nextValue: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant={nextValue ? "primary" : "danger"}>
      {pending ? "Saving…" : nextValue ? "Enable automation" : "Disable automation"}
    </Button>
  );
}

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
  const [state, formAction] = useActionState<AutomationSwitchState, FormData>(setAutomationStateAction, {
    enabled: initialEnabled,
    error: null,
  });
  const { enabled, error } = state;
  const nextValue = !enabled;
  const prevEnabledRef = React.useRef(initialEnabled);

  React.useEffect(() => {
    if (state.enabled !== prevEnabledRef.current) {
      prevEnabledRef.current = state.enabled;
      router.refresh();
    }
  }, [state.enabled, router]);

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

          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="nextEnabled" value={String(nextValue)} />
            <div className="flex flex-col gap-1">
              <Label htmlFor="kill-reason">Reason for change</Label>
              <Textarea
                id="kill-reason"
                name="reason"
                rows={3}
                required
                placeholder="Required before disabling or re-enabling automation"
              />
            </div>

            <div className="flex items-center gap-3">
              <SaveButton nextValue={nextValue} />
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
            Per-client mode editing is not built in this slice — each case already shows and enforces
            its own automation mode in the case-detail Automation state panel. See{" "}
            <span className="font-mono text-xs">docs/PLAN.md</span> for the tracked follow-up.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
