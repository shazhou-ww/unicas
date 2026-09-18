import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";

export function McpConfigurationDialog({ open, onClose }: {
  open: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"url" | "prompt" | "cli" | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const serverUrl = `${window.location.origin}/mcp`;
  const skillUrl = `${window.location.origin}/admin/assets/skills/unicas-cli/SKILL.md`;
  const configurationPrompt = `Add a remote MCP server named "UniCAS" with this URL: ${serverUrl}
Use Streamable HTTP. Authentication is handled with OAuth in the browser; no API key is required.`;
  const cliPrompt = `Install the UniCAS CLI and its agent skill, then operate the control plane with it:
1. Install the CLI (from the UniCAS repository):
    pnpm --filter @unicas/admin-cli build && pnpm install --global ./packages/admin-cli
2. Log in once in a browser: unicas login
3. Fetch ${skillUrl}, install it in this tool's standard agent-skills location, and follow it.
  Determine the correct location from the tool's own conventions.
4. Use the CLI (JSON on stdout) or connect over stdio MCP:
  unicas account | unicas apps list | unicas apps get <appId> | unicas apps create "Operations" --idempotency-key ops-1
   stdio MCP: command "unicas", args ["mcp"]`;

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  async function copy(value: string, target: "url" | "prompt" | "cli") {
    await navigator.clipboard.writeText(value);
    setCopied(target);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!nextOpen) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Connect an AI tool</DialogTitle>
          <DialogDescription>
            Use the server URL directly, or paste a prompt into your AI tool — the MCP prompt for
            tools that manage MCP connections, or the CLI prompt for tools that cannot handle
            OAuth MCP.
          </DialogDescription>
        </DialogHeader>
        <Button
          variant="outline"
          className="h-auto w-full justify-between whitespace-normal break-all py-3 text-left font-mono text-xs"
          aria-label="Copy MCP server URL"
          onClick={() => void copy(serverUrl, "url")}
        >
          <span>{serverUrl}</span>
          {copied === "url" ? <Check size={14} /> : <Copy size={14} />}
        </Button>
        <div className="grid gap-5 md:grid-cols-2">
          <section className="min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <code className="text-xs">Configuration prompt</code>
              <Button type="button" size="sm" variant="outline" onClick={() => void copy(configurationPrompt, "prompt")}>
                {copied === "prompt" ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied === "prompt" ? "Prompt copied" : "Copy prompt"}</span>
              </Button>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs"><code>{configurationPrompt}</code></pre>
          </section>
          <section className="min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <code className="text-xs">CLI prompt</code>
              <Button type="button" size="sm" variant="outline" onClick={() => void copy(cliPrompt, "cli")}>
                {copied === "cli" ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied === "cli" ? "CLI prompt copied" : "Copy CLI prompt"}</span>
              </Button>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs"><code>{cliPrompt}</code></pre>
          </section>
        </div>
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <p className="font-medium">No API key required</p>
          <p className="text-muted-foreground">On first use, your AI tool opens a browser and asks you to approve UniCAS access.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
