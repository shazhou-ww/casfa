function createInputImagePathError(message: string): Error {
  return new Error(`inputImagePath ${message}`);
}

export function normalizeInputImagePath(inputImagePath: string): string {
  const trimmed = inputImagePath.trim();
  if (!trimmed) throw createInputImagePathError("must not be empty");

  const slashNormalized = trimmed.replace(/\\/g, "/");
  if (slashNormalized.startsWith("/")) {
    throw createInputImagePathError("must be a relative path");
  }
  if (slashNormalized.includes("//")) {
    throw createInputImagePathError("must not contain consecutive '/'");
  }

  const parts = slashNormalized.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..") {
      throw createInputImagePathError("contains invalid path segment");
    }
  }

  return parts.join("/");
}
