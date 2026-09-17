import { BookOpenText, Cable, CircleUserRound, LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import type { AppAdminMeResponse } from "@unicas/admin-client";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * Migrated to shadcn DropdownMenu.
 * Shows avatar, display name, effective context, and dropdown items:
 * Documentation (external link), Connect AI tools, separator, Sign out (destructive).
 */
export function UserMenu({
  me,
  onOpenMcpConfiguration,
  onLogout,
}: {
  me: AppAdminMeResponse;
  onOpenMcpConfiguration: () => void;
  onLogout: () => void;
}) {
  const displayName = me.account.displayName ?? me.account.primaryVerifiedEmail?.normalizedEmail ?? "Account";
  const membershipCount = me.memberships.length;
  const contextLabel = membershipCount === 1
    ? "1 App membership"
    : `${membershipCount} App memberships`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="console-user-menu-trigger"
          aria-label="Open user menu"
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs bg-primary text-primary-foreground">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="console-user-menu-info">
            <span className="console-user-menu-name">{displayName}</span>
            <span className="console-user-menu-context">{contextLabel}</span>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{displayName}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {me.account.primaryVerifiedEmail?.normalizedEmail ?? me.account.accountId}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="#/account" className="cursor-pointer">
            <CircleUserRound className="mr-2 h-4 w-4" />
            <span>Account</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href="https://docs.unicas.work"
            target="_blank"
            rel="noreferrer"
            className="cursor-pointer"
          >
            <BookOpenText className="mr-2 h-4 w-4" />
            <span>Documentation</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenMcpConfiguration} className="cursor-pointer">
          <Cable className="mr-2 h-4 w-4" />
          <span>Connect AI tools</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onLogout}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
