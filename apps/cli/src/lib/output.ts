import chalk from "chalk";
import Table from "cli-table3";
import YAML from "yaml";

export type OutputFormat = "text" | "json" | "yaml" | "table";

export interface OutputOptions {
  format: OutputFormat;
  quiet: boolean;
  verbose: boolean;
}

export class OutputFormatter {
  constructor(private options: OutputOptions) {}

  get format(): OutputFormat {
    return this.options.format;
  }

  get isQuiet(): boolean {
    return this.options.quiet;
  }

  get isVerbose(): boolean {
    return this.options.verbose;
  }

  // Output structured data
  output(data: unknown, textFormatter?: (data: unknown) => string): void {
    if (this.options.quiet && this.options.format === "text") {
      return;
    }

    switch (this.options.format) {
      case "json":
        console.log(JSON.stringify(data, null, 2));
        break;
      case "yaml":
        console.log(YAML.stringify(data));
        break;
      case "table":
        if (Array.isArray(data)) {
          this.printTable(data);
        } else {
          this.printObjectTable(data as Record<string, unknown>);
        }
        break;
      default:
        if (textFormatter) {
          console.log(textFormatter(data));
        } else {
          console.log(data);
        }
    }
  }

  // Print array as table
  printTable(rows: Array<Record<string, unknown>>, columns?: string[]): void {
    if (rows.length === 0) {
      console.log("(empty)");
      return;
    }

    const firstRow = rows[0];
    if (!firstRow) {
      console.log("(empty)");
      return;
    }

    const cols = columns || Object.keys(firstRow);
    const table = new Table({
      head: cols.map((c) => chalk.bold(c.toUpperCase())),
      style: { head: [], border: [] },
    });

    for (const row of rows) {
      table.push(cols.map((c) => String(row[c] ?? "")));
    }

    console.log(table.toString());
  }

  // Print object as key-value table
  printObjectTable(obj: Record<string, unknown>): void {
    const table = new Table({
      style: { head: [], border: [] },
    });

    for (const [key, value] of Object.entries(obj)) {
      table.push([chalk.bold(key), formatValue(value)]);
    }

    console.log(table.toString());
  }

  // Print simple key-value pairs
  printKeyValue(pairs: Array<[string, unknown]>): void {
    const maxKeyLen = Math.max(...pairs.map(([k]) => k.length));
    for (const [key, value] of pairs) {
      console.log(`${chalk.bold(key.padEnd(maxKeyLen))}  ${formatValue(value)}`);
    }
  }

  // Print success message
  success(message: string): void {
    if (!this.options.quiet) {
      console.log(chalk.green("✓"), message);
    }
  }

  // Print error message
  error(message: string): void {
    console.error(chalk.red("✗"), message);
  }

  // Print warning message
  warn(message: string): void {
    if (!this.options.quiet) {
      console.warn(chalk.yellow("⚠"), message);
    }
  }

  // Print info message
  info(message: string): void {
    if (!this.options.quiet) {
      console.log(chalk.blue("ℹ"), message);
    }
  }

  // Print verbose/debug message
  debug(message: string): void {
    if (this.options.verbose) {
      console.log(chalk.gray("⋯"), chalk.gray(message));
    }
  }

  // Print raw text (no formatting)
  raw(text: string): void {
    console.log(text);
  }

  // Print a divider line
  divider(): void {
    if (!this.options.quiet) {
      console.log(chalk.gray("─".repeat(40)));
    }
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return chalk.gray("—");
  }
  if (typeof value === "boolean") {
    return value ? chalk.green("true") : chalk.red("false");
  }
  if (typeof value === "number") {
    return chalk.cyan(String(value));
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

// Helper to create formatter from command options
export function createFormatter(options: {
  format?: string;
  quiet?: boolean;
  verbose?: boolean;
}): OutputFormatter {
  return new OutputFormatter({
    format: (options.format as OutputFormat) || "text",
    quiet: options.quiet || false,
    verbose: options.verbose || false,
  });
}

// Format relative time
export function formatRelativeTime(date: Date | number | string): string {
  const now = Date.now();
  const timestamp = typeof date === "number" ? date : new Date(date).getTime();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 30) {
    return new Date(timestamp).toLocaleDateString();
  }
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

// Format duration
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

// Format file size
export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / 1024 ** i;
  return `${size.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}
