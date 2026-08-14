import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_THRESHOLD = 10 * 1024; // 10 KB

export function shouldExternalize(
  data: string,
  threshold = DEFAULT_THRESHOLD,
): boolean {
  return Buffer.byteLength(data, "utf-8") > threshold;
}

export function computeBlobHash(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function writeBlobIfNeeded(
  data: unknown,
  blobDir: string,
  threshold = DEFAULT_THRESHOLD,
): unknown {
  const serialized =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  if (!shouldExternalize(serialized, threshold)) return data;

  const hash = computeBlobHash(serialized);
  const ref = `blob:sha256-${hash}`;

  mkdirSync(blobDir, { recursive: true });
  const blobPath = join(blobDir, hash);
  if (!existsSync(blobPath)) {
    writeFileSync(blobPath, serialized, "utf-8");
  }

  return ref;
}

export function resolveBlob(value: unknown, blobDir: string): unknown {
  if (typeof value !== "string") return value;
  if (!value.startsWith("blob:sha256-")) return value;

  const hash = value.slice("blob:sha256-".length);
  const blobPath = join(blobDir, hash);
  const content = readFileSync(blobPath, "utf-8");

  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}
