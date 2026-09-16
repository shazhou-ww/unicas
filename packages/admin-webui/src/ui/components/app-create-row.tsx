import { useEffect, useId, useRef, useState } from "react";
import { Check, LoaderCircle, Plus, X } from "lucide-react";
import { Portal } from "@radix-ui/react-tooltip";
import { Input } from "@/components/ui/input.js";
import { Button } from "@/components/ui/button.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip.js";
import { api } from "../api.js";
import { formatErrorSafe } from "../views/view-helpers.js";

export function AppCreateRow({ onCreated, onCancel }: {
  onCreated: (appId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const cancelled = useRef(false);
  const mounted = useRef(true);
  const attempt = useRef<string | null>(null);
  const receiptKey = useRef<{ name: string; key: string } | null>(null);
  const hintId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function cancel() {
    if (busy.current || cancelled.current) return;
    cancelled.current = true;
    onCancel();
  }

  async function submit(explicit: boolean) {
    if (busy.current || cancelled.current) return;
    const value = name.trim();
    if (!value && !explicit) { cancelled.current = true; onCancel(); return; }
    if (!explicit && attempt.current === value) return;
    attempt.current = value;
    const validation = !value ? "App name is required."
      : value.length > 120 ? "App name must be at most 120 characters."
        : /[\u0000-\u001f\u007f]/.test(value) ? "App name contains control characters." : null;
    if (validation) { setError(validation); return; }
    if (receiptKey.current?.name !== value) receiptKey.current = { name: value, key: crypto.randomUUID() };
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ appId: string }>("/admin/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": receiptKey.current.key },
        body: JSON.stringify({ displayName: value }),
      });
      if (mounted.current) onCreated(result.appId);
    } catch (caught) {
      if (mounted.current) setError(formatErrorSafe(caught));
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <div className="console-sidebar-app-item" role="group" aria-label="New App" aria-busy={saving}>
      <div className="console-sidebar-app-mark">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</div>
      <div className="relative min-w-0 flex-1" onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void submit(false);
      }} onKeyDown={event => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); cancel(); }
      }}>
        <TooltipProvider><Tooltip open={error !== null}>
          <TooltipTrigger asChild>
            <Input autoFocus aria-label="App display name" placeholder="App name" className="h-8 min-w-0 w-full px-2 text-sm" style={{ paddingRight: "4rem" }} value={name}
              readOnly={saving} aria-invalid={error !== null} aria-describedby={error ? hintId : undefined}
              onChange={event => { setName(event.target.value); setError(null); attempt.current = null; }}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") { event.preventDefault(); void submit(true); }
              }} />
          </TooltipTrigger>
          {error ? <Portal><TooltipContent side="bottom" align="start" collisionPadding={12} className="max-w-[min(20rem,calc(100vw-24px))] break-words text-destructive"><span id={hintId} role="alert">{error}</span></TooltipContent></Portal> : null}
        </Tooltip></TooltipProvider>
        <div className="absolute inset-y-0 right-1 flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Confirm App creation" aria-label="Confirm App creation" disabled={saving} onClick={() => void submit(true)}><Check className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Cancel App creation" aria-label="Cancel App creation" disabled={saving} onClick={cancel}><X className="h-4 w-4" /></Button>
        </div>
      </div>
      {saving ? <span role="status" className="sr-only">Creating App...</span> : null}
    </div>
  );
}