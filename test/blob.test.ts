import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writeBlobIfNeeded, resolveBlob } from "../src/blob.js";

const TEST_DIR = join(
  import.meta.dirname,
  "..",
  ".test-blobs-" + process.pid,
);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("writeBlobIfNeeded", () => {
  it("returns data inline when below threshold", () => {
    const result = writeBlobIfNeeded("short string", TEST_DIR, 1024);
    expect(result).toBe("short string");
  });

  it("externalizes data above threshold", () => {
    const bigData = "x".repeat(2000);
    const result = writeBlobIfNeeded(bigData, TEST_DIR, 1024);
    expect(typeof result).toBe("string");
    expect((result as string).startsWith("blob:sha256-")).toBe(true);

    const files = readdirSync(TEST_DIR);
    expect(files.length).toBe(1);
  });

  it("deduplicates identical blobs", () => {
    const data = "x".repeat(2000);
    writeBlobIfNeeded(data, TEST_DIR, 1024);
    writeBlobIfNeeded(data, TEST_DIR, 1024);

    const files = readdirSync(TEST_DIR);
    expect(files.length).toBe(1);
  });
});

describe("resolveBlob", () => {
  it("returns non-blob values as-is", () => {
    expect(resolveBlob("hello", TEST_DIR)).toBe("hello");
    expect(resolveBlob(42, TEST_DIR)).toBe(42);
  });

  it("resolves blob references to content", () => {
    const data = "x".repeat(2000);
    const ref = writeBlobIfNeeded(data, TEST_DIR, 1024) as string;
    const resolved = resolveBlob(ref, TEST_DIR);
    expect(resolved).toBe(data);
  });

  it("resolves JSON blob references to parsed objects", () => {
    const obj = { key: "value", nested: { a: 1 } };
    const data = JSON.stringify(obj, null, 2);
    const ref = writeBlobIfNeeded(data, TEST_DIR, 10) as string;
    const resolved = resolveBlob(ref, TEST_DIR);
    expect(resolved).toEqual(obj);
  });
});
