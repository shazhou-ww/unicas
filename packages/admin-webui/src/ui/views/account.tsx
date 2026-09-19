import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Link2,
  LoaderCircle,
  Save,
  Trash2,
} from "lucide-react";
import type { AccountSelf, ExternalIdentitySummary, ProviderKind } from "@unicas/admin-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar.js";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip.js";
import { api } from "../api.js";
import { formatErrorSafe } from "./view-helpers.js";

const providerNames: Record<ProviderKind, string> = {
  google: "Google",
  microsoft: "Microsoft",
  github: "GitHub",
};

const avatarColors = ["#374151", "#1d4ed8", "#047857", "#a16207", "#b91c1c", "#6d28d9"];

const verificationSourceNames: Record<NonNullable<AccountSelf["primaryVerifiedEmail"]>["source"], string> = {
  "google-oidc": "Google",
  "github-emails-api": "GitHub",
  "unicas-email-challenge": "UniCAS email challenge",
};

function formatDate(value: number | null): string {
  return value === null ? "Never" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value);
}

function AccountAvatar({ account }: { readonly account: AccountSelf }) {
  const [imageFailed, setImageFailed] = useState(false);
  const fallback = account.avatar;
  return (
    <Avatar className="h-14 w-14 shrink-0">
      {account.avatar.kind === "image" && !imageFailed ? (
        <AvatarImage src={account.avatar.url} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
      ) : null}
      <AvatarFallback
        className="text-sm font-semibold text-white"
        style={{ backgroundColor: avatarColors[fallback.colorIndex % avatarColors.length] }}
      >
        {fallback.initials}
      </AvatarFallback>
    </Avatar>
  );
}

export function AccountView({
  navigateExternal = url => window.location.assign(url),
  identityError = null,
}: {
  readonly navigateExternal?: (url: string) => void;
  readonly identityError?: string | null;
}) {
  const [account, setAccount] = useState<AccountSelf | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [avatarSource, setAvatarSource] = useState("unchanged");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [startingAuth, setStartingAuth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [linkProvider, setLinkProvider] = useState<ProviderKind | null>(null);
  const [unlinkIdentity, setUnlinkIdentity] = useState<ExternalIdentitySummary | null>(null);
  const [remainingIdentityId, setRemainingIdentityId] = useState("");

  async function loadAccount() {
    setLoading(true);
    setError(null);
    try {
      const result = await api<AccountSelf>("/admin/account");
      setAccount(result);
      setDisplayName(result.displayName ?? "");
      setAvatarSource("unchanged");
    } catch (caught) {
      setError(formatErrorSafe(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAccount();
  }, []);

  async function saveProfile() {
    if (!account) return;
    const trimmedName = displayName.trim();
    const body: { displayName?: string | null; avatarExternalIdentityId?: string | null } = {};
    if (trimmedName !== (account.displayName ?? "")) body.displayName = trimmedName || null;
    if (avatarSource !== "unchanged") {
      body.avatarExternalIdentityId = avatarSource === "fallback" ? null : avatarSource;
    }
    if (Object.keys(body).length === 0) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      await api<null>("/admin/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await loadAccount();
      setStatus("Profile saved.");
    } catch (caught) {
      setError(formatErrorSafe(caught));
    } finally {
      setSaving(false);
    }
  }

  async function beginIdentityMutation(path: string, body?: Record<string, string>) {
    setStartingAuth(true);
    setError(null);
    setStatus(null);
    try {
      const result = await api<{ redirectTo: string }>(path, {
        method: "POST",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      navigateExternal(result.redirectTo);
    } catch (caught) {
      setStartingAuth(false);
      setError(formatErrorSafe(caught));
    }
  }

  function openUnlink(identity: ExternalIdentitySummary) {
    const remaining = account?.identities.find(candidate => candidate.externalIdentityId !== identity.externalIdentityId);
    setRemainingIdentityId(remaining?.externalIdentityId ?? "");
    setUnlinkIdentity(identity);
  }

  if (loading && !account) {
    return <div className="page flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading Account...</div>;
  }

  if (!account) {
    return <div className="page flex items-center gap-2 text-sm text-destructive" role="alert"><CircleAlert className="h-4 w-4" />{error ?? "Account unavailable"}</div>;
  }

  const profileChanged = displayName.trim() !== (account.displayName ?? "") || avatarSource !== "unchanged";
  const identityErrorMessage = identityError === "link-conflict"
    ? "That login method could not be linked. No Account access was changed."
    : null;

  return (
    <section className="page space-y-6" aria-labelledby="account-heading">
      <header>
        <h1 id="account-heading" className="console-page-heading-title">Account</h1>
        <p className="mt-2 text-sm text-muted-foreground">Manage your profile and login methods.</p>
      </header>

      {identityErrorMessage || error ? <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">{identityErrorMessage ?? error}</div> : null}
      {status ? <div className="rounded-md border bg-muted/50 p-3 text-sm" role="status">{status}</div> : null}

      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <AccountAvatar account={account} />
            <div className="min-w-0">
              <p className="truncate font-medium">{account.displayName ?? "Unnamed Account"}</p>
              <p className="truncate text-sm text-muted-foreground">{account.primaryVerifiedEmail?.normalizedEmail ?? "No verified contact email"}</p>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="account-display-name">Display name</Label>
              <Input id="account-display-name" maxLength={120} value={displayName} onChange={event => setDisplayName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-avatar-source">Avatar</Label>
              <Select value={avatarSource} onValueChange={setAvatarSource}>
                <SelectTrigger id="account-avatar-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unchanged">Keep current avatar</SelectItem>
                  <SelectItem value="fallback">Use initials</SelectItem>
                  {account.identities.map(identity => (
                    <SelectItem key={identity.externalIdentityId} value={identity.externalIdentityId}>
                      Use {providerNames[identity.provider]} avatar
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <dl className="grid gap-4 border-t pt-5 text-sm md:grid-cols-2">
            <div><dt className="text-muted-foreground">Primary verified contact</dt><dd className="mt-1 font-medium">{account.primaryVerifiedEmail?.normalizedEmail ?? "Not available"}</dd></div>
            <div><dt className="text-muted-foreground">Verification source</dt><dd className="mt-1 font-medium">{account.primaryVerifiedEmail ? verificationSourceNames[account.primaryVerifiedEmail.source] : "Not available"}</dd></div>
          </dl>
        </CardContent>
        <CardFooter>
          <Button type="button" onClick={() => void saveProfile()} disabled={saving || !profileChanged}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle>Login methods</CardTitle>
          {account.linkableProviders.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" disabled={startingAuth}>
                  <Link2 className="h-4 w-4" />Link login method<ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {account.linkableProviders.map(provider => (
                  <DropdownMenuItem key={provider} onSelect={() => setLinkProvider(provider)}>
                    {providerNames[provider]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </CardHeader>
        <CardContent>
          <div className="divide-y rounded-md border">
            {account.identities.map(identity => {
              const canUnlink = account.identities.length > 1;
              return (
                <div key={identity.externalIdentityId} className="flex items-center gap-4 px-4 py-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border bg-muted text-xs font-semibold">
                    {providerNames[identity.provider].slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{providerNames[identity.provider]}</p>
                      {identity.currentLogin ? <Badge variant="secondary"><Check className="mr-1 h-3 w-3" />Current session</Badge> : null}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{identity.accountHint ?? "Provider identity"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Linked {formatDate(identity.linkedAt)} · Last used {formatDate(identity.lastAuthenticatedAt)}</p>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={!canUnlink || startingAuth}
                            aria-label={`Unlink ${providerNames[identity.provider]}`}
                            onClick={() => openUnlink(identity)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{canUnlink ? `Unlink ${providerNames[identity.provider]}` : "At least one login method is required"}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={linkProvider !== null} onOpenChange={open => { if (!open) setLinkProvider(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link {linkProvider ? providerNames[linkProvider] : "login method"}?</DialogTitle>
            <DialogDescription>
              You will authenticate this Account and the new login method. A matching email does not transfer access or combine Accounts.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLinkProvider(null)}>Cancel</Button>
            <Button
              type="button"
              disabled={!linkProvider || startingAuth}
              onClick={() => linkProvider && void beginIdentityMutation(`/admin/auth/link/${linkProvider}`)}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unlinkIdentity !== null} onOpenChange={open => { if (!open) setUnlinkIdentity(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink {unlinkIdentity ? providerNames[unlinkIdentity.provider] : "login method"}?</DialogTitle>
            <DialogDescription>
              You will freshly authenticate a remaining login method. Memberships, authorities, and data will stay with this Account.
            </DialogDescription>
          </DialogHeader>
          {unlinkIdentity?.currentLogin && account.identities.length > 2 ? (
            <div className="space-y-2">
              <Label htmlFor="remaining-login-method">Login method to keep using</Label>
              <Select value={remainingIdentityId} onValueChange={setRemainingIdentityId}>
                <SelectTrigger id="remaining-login-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {account.identities.filter(identity => identity.externalIdentityId !== unlinkIdentity.externalIdentityId).map(identity => (
                    <SelectItem key={identity.externalIdentityId} value={identity.externalIdentityId}>{providerNames[identity.provider]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUnlinkIdentity(null)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!unlinkIdentity || !remainingIdentityId || startingAuth}
              onClick={() => unlinkIdentity && void beginIdentityMutation(
                `/admin/auth/unlink/${encodeURIComponent(unlinkIdentity.externalIdentityId)}`,
                { remainingExternalIdentityId: remainingIdentityId },
              )}
            >
              Unlink and continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
