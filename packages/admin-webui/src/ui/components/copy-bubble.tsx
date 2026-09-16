import { useId, useState } from "react";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/lib/utils.js";

function copyMessages(label: string) {
  const language = document.documentElement.lang || navigator.language || "en";
  if (/^zh(?:-|$)/i.test(language)) {
    const traditional = /^zh-(?:Hant|TW|HK|MO)(?:-|$)/i.test(language);
    return {
      action: traditional ? `\u8907\u88fd ${label}` : `\u590d\u5236 ${label}`,
      success: `${label} ${traditional ? "\u5df2\u8907\u88fd" : "\u5df2\u590d\u5236"}`,
      failure: traditional ? `\u7121\u6cd5\u8907\u88fd ${label}\uff0c\u8acb\u91cd\u8a66\u3002` : `\u65e0\u6cd5\u590d\u5236 ${label}\uff0c\u8bf7\u91cd\u8bd5\u3002`,
      notifications: "\u901a\u77e5",
    };
  }
  return {
    action: `Copy ${label}`,
    success: `${label} copied`,
    failure: `Could not copy ${label}. Try again.`,
    notifications: "Notifications",
  };
}

export function CopyNotifications() {
  return <Toaster position="top-center" theme="light" closeButton duration={2000} containerAriaLabel={copyMessages("").notifications} />;
}

export function CopyBubble({ value, label, className }: {
  value: string;
  label: string;
  className?: string;
}) {
  const notificationId = useId();
  const [copying, setCopying] = useState(false);
  const messages = copyMessages(label);

  async function copy() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(value);
      toast.success(messages.success, { id: notificationId });
    } catch {
      toast.error(messages.failure, { id: notificationId });
    } finally {
      setCopying(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={cn("h-auto min-h-8 max-w-full cursor-pointer whitespace-normal rounded-md px-3 font-mono text-xs", className)}
      aria-label={`${messages.action} ${value}`}
      title={messages.action}
      disabled={copying}
      onClick={() => void copy()}
    >
      <code className="min-w-0 break-all">{value}</code>
    </Button>
  );
}