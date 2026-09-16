export function MyAppsView({ canCreateApps = true }: { readonly canCreateApps?: boolean }) {
  return (
    <section className="grid min-h-[60dvh] place-items-center px-4" aria-label="Get started">
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        {canCreateApps ? "Select an App to get started, or use + to create one." : "Select an App to get started."}
      </p>
    </section>
  );
}