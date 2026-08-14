import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  scaffoldRepro,
  readManifest,
  writeManifest,
  addEntry,
} from "../src/manifest.js";

const TEST_DIR = join(
  import.meta.dirname,
  "..",
  ".test-manifest-" + process.pid,
);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("scaffoldRepro", () => {
  it("creates .repro/ and REPRO.md", () => {
    scaffoldRepro(TEST_DIR);
    expect(existsSync(join(TEST_DIR, ".repro"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "REPRO.md"))).toBe(true);
  });

  it("adds blob pattern to existing .gitignore", () => {
    writeFileSync(join(TEST_DIR, ".gitignore"), "node_modules/\n", "utf-8");
    scaffoldRepro(TEST_DIR);
    const content = readFileSync(join(TEST_DIR, ".gitignore"), "utf-8");
    expect(content).toContain(".repro/*/blobs/");
    expect(content).toContain("node_modules/");
  });

  it("creates .gitignore if none exists", () => {
    scaffoldRepro(TEST_DIR);
    const content = readFileSync(join(TEST_DIR, ".gitignore"), "utf-8");
    expect(content).toContain(".repro/*/blobs/");
  });
});

describe("readManifest / writeManifest", () => {
  it("round-trips entries", () => {
    const entries = [
      { id: "r-abc123", title: "Agent loops on read_file", status: "open" as const, firstSeen: "2026-08-15" },
      { id: "r-def456", title: "Agent modifies src/gen/", status: "fixed" as const, firstSeen: "2026-08-14" },
    ];
    writeManifest(TEST_DIR, entries);
    const read = readManifest(TEST_DIR);
    expect(read).toEqual(entries);
  });

  it("returns empty array for missing file", () => {
    expect(readManifest(TEST_DIR)).toEqual([]);
  });
});

describe("addEntry", () => {
  it("adds a new entry", () => {
    writeManifest(TEST_DIR, []);
    addEntry(TEST_DIR, {
      id: "r-new123",
      title: "New failure",
      status: "open",
      firstSeen: "2026-08-15",
    });
    const entries = readManifest(TEST_DIR);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("r-new123");
  });

  it("updates existing entry", () => {
    writeManifest(TEST_DIR, [
      {
        id: "r-exist1",
        title: "Old title",
        status: "open",
        firstSeen: "2026-08-14",
      },
    ]);
    addEntry(TEST_DIR, {
      id: "r-exist1",
      title: "New title",
      status: "fixed",
      firstSeen: "2026-08-14",
    });
    const entries = readManifest(TEST_DIR);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("New title");
    expect(entries[0].status).toBe("fixed");
  });
});
