import type { AppUsage } from "@unicas/admin-protocol";

export interface AppUsageProjection extends AppUsage {
  readonly unobservedNodeCount: number;
}

export interface AppUsageRepository {
  readAppUsage(appId: string): Promise<AppUsageProjection>;
}

export class AppUsageUnavailableError extends Error {
  constructor() {
    super("App usage accounting is still being reconciled");
    this.name = "AppUsageUnavailableError";
  }
}

export async function readAppUsage(input: {
  readonly repository: AppUsageRepository;
  readonly appId: string;
}): Promise<AppUsage> {
  const projection = await input.repository.readAppUsage(input.appId);
  if (projection.unobservedNodeCount > 0) {
    throw new AppUsageUnavailableError();
  }
  const { unobservedNodeCount: _, ...usage } = projection;
  return usage;
}