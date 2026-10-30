export const SHIPPED_DEV_DEPENDENCIES: string[];
export const BUILD_ONLY_NUGET: string[];
export function classifyLicense(expression: string): 'ok' | 'reviewed' | 'flag';
export function shippedLockKeys(
  lock: { packages: Record<string, { version: string }> },
  manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
  shippedDev?: string[],
): string[];
