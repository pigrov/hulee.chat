import {
  loadLocalEnvFile,
  loadWebConfig,
  mergeEnvSources,
  type WebConfig
} from "@hulee/config";

const localEnv = loadLocalEnvFile();

export function resolveWebConfig(): WebConfig {
  return loadWebConfig(resolveMergedWebEnv());
}

export function resolveWebEnv(): NodeJS.ProcessEnv {
  resolveWebConfig();

  return resolveMergedWebEnv() as NodeJS.ProcessEnv;
}

function resolveMergedWebEnv(): Record<string, string | undefined> {
  return mergeEnvSources(localEnv, process.env);
}
