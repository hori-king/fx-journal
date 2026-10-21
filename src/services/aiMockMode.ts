export type AIMockModeEnvironment = {
  development: boolean;
  production: boolean;
  setting: string | undefined;
};

export function shouldUseAIMockMode(environment: AIMockModeEnvironment): boolean {
  return environment.development && !environment.production && environment.setting === "true";
}

export async function runWithAIMockMode<T>(
  enabled: boolean,
  createMockResult: () => T,
  runLiveRequest: () => Promise<T>,
): Promise<T> {
  if (enabled) return createMockResult();
  return runLiveRequest();
}
