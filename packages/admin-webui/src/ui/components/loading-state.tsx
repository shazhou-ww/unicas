import { cn } from "@/lib/utils.js";

export function LoadingState({
  label,
  detail,
  className,
}: {
  readonly label: string;
  readonly detail?: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("console-loading-region", className)}>
      <div className="console-loading-state" role="status" aria-live="polite" aria-busy="true">
        <strong>{label}</strong>
        {detail ? <p>{detail}</p> : null}
      </div>
    </div>
  );
}