export type TransferMode = "replace" | "fail_if_exists" | "merge_dir";

export type TransferSpec = {
  source: string;
  target: string;
  mapping: Record<string, string>;
  mode?: TransferMode;
};
