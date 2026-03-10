import type { Command } from "commander";
import { clearCache, formatSize, getCachePath, getCacheStats } from "../lib/cache";
import { loadConfig, saveConfig } from "../lib/config";
import { createFormatter } from "../lib/output";

export function registerCacheCommands(program: Command): void {
  const cache = program.command("cache").description("Local cache management");

  cache
    .command("stats")
    .description("Show cache statistics")
    .action(() => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const stats = getCacheStats();
      const config = loadConfig();

      formatter.output(
        {
          enabled: config.cache.enabled,
          path: stats.path,
          files: stats.totalFiles,
          size: stats.totalSize,
          maxSize: config.cache.maxSize,
        },
        () => {
          const lines = [
            `Enabled:     ${config.cache.enabled ? "Yes" : "No"}`,
            `Path:        ${stats.path}`,
            `Files:       ${stats.totalFiles}`,
            `Size:        ${formatSize(stats.totalSize)}`,
            `Max Size:    ${config.cache.maxSize}`,
          ];
          return lines.join("\n");
        }
      );
    });

  cache
    .command("clear")
    .description("Clear all cached data")
    .action(() => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const deletedCount = clearCache();
      formatter.success(`Cleared ${deletedCount} cached files`);
    });

  cache
    .command("path")
    .description("Show cache directory path")
    .action(() => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const cachePath = getCachePath();
      formatter.output({ path: cachePath }, () => cachePath);
    });

  cache
    .command("enable")
    .description("Enable local caching")
    .action(() => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const config = loadConfig();
      config.cache.enabled = true;
      saveConfig(config);

      formatter.success("Cache enabled");
    });

  cache
    .command("disable")
    .description("Disable local caching")
    .action(() => {
      const opts = program.opts();
      const formatter = createFormatter(opts);

      const config = loadConfig();
      config.cache.enabled = false;
      saveConfig(config);

      formatter.success("Cache disabled");
    });
}
