import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface ManifestEntry {
  id: string;
  title: string;
  status: "open" | "fixed" | "wontfix";
  firstSeen: string;
}

const HEADER = `# REPRO.md — Known Agent Failures

This file is maintained by [repro](https://github.com/vgudzhev/repro). Each row is a recorded agent failure that replays without an API key.

Run \`repro test\` to replay all open failures. See \`.repro/<id>/\` for trace data.

| ID | Title | Status | First Seen |
|----|-------|--------|------------|
`;

export function readManifest(repoDir: string): ManifestEntry[] {
  const path = join(repoDir, "REPRO.md");
  if (!existsSync(path)) return [];

  const content = readFileSync(path, "utf-8");
  const entries: ManifestEntry[] = [];

  for (const line of content.split("\n")) {
    const match = line.match(
      /^\|\s*(\S+)\s*\|\s*(.+?)\s*\|\s*(open|fixed|wontfix)\s*\|\s*(.+?)\s*\|$/,
    );
    if (match && match[1] !== "ID" && match[1] !== "----") {
      entries.push({
        id: match[1],
        title: match[2],
        status: match[3] as ManifestEntry["status"],
        firstSeen: match[4],
      });
    }
  }

  return entries;
}

export function writeManifest(
  repoDir: string,
  entries: ManifestEntry[],
): void {
  const rows = entries
    .map(
      (e) =>
        `| ${e.id} | ${e.title} | ${e.status} | ${e.firstSeen} |`,
    )
    .join("\n");

  const content = HEADER + rows + (rows ? "\n" : "");
  writeFileSync(join(repoDir, "REPRO.md"), content, "utf-8");
}

export function addEntry(
  repoDir: string,
  entry: ManifestEntry,
): void {
  const entries = readManifest(repoDir);
  const existing = entries.findIndex((e) => e.id === entry.id);
  if (existing >= 0) {
    entries[existing] = entry;
  } else {
    entries.push(entry);
  }
  writeManifest(repoDir, entries);
}

export function scaffoldRepro(repoDir: string): void {
  const reproPath = join(repoDir, ".repro");
  mkdirSync(reproPath, { recursive: true });

  if (!existsSync(join(repoDir, "REPRO.md"))) {
    writeManifest(repoDir, []);
  }

  const gitignorePath = join(repoDir, ".gitignore");
  const blobPattern = ".repro/*/blobs/";
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (!content.includes(blobPattern)) {
      writeFileSync(
        gitignorePath,
        content.trimEnd() + "\n" + blobPattern + "\n",
        "utf-8",
      );
    }
  } else {
    writeFileSync(gitignorePath, blobPattern + "\n", "utf-8");
  }
}
