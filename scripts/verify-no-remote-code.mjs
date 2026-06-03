import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const FORBIDDEN_PATTERNS = [
  { name: "cdnjs URL", regex: /cdnjs/gi },
  { name: "jsPDF PDFObject remote viewer mode", regex: /pdfobjectnewwindow/gi },
  { name: "jsPDF pdfObjectUrl option", regex: /pdfObjectUrl/g },
  { name: "remote script import", regex: /importScripts\(["']https?:\/\//gi },
  { name: "remote script tag source", regex: /<script[^>]+src=["']https?:\/\//gi },
];

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".mjs",
  ".svg",
  ".txt",
]);

function collectFiles(targetPath) {
  const stat = statSync(targetPath);
  if (stat.isFile()) return [targetPath];

  const files = [];
  for (const entry of readdirSync(targetPath)) {
    files.push(...collectFiles(path.join(targetPath, entry)));
  }
  return files;
}

function isTextFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function snippet(text, index) {
  const start = Math.max(0, index - 120);
  const end = Math.min(text.length, index + 180);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function scanTarget(targetPath) {
  if (!existsSync(targetPath)) {
    throw new Error(`Remote-code verification target does not exist: ${targetPath}`);
  }

  const findings = [];
  for (const filePath of collectFiles(targetPath)) {
    if (!isTextFile(filePath)) continue;

    const text = readFileSync(filePath, "utf8");
    for (const pattern of FORBIDDEN_PATTERNS) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(text);
      if (match) {
        findings.push({
          filePath,
          pattern: pattern.name,
          snippet: snippet(text, match.index),
        });
      }
    }
  }
  return findings;
}

function extractZip(zipPath) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "cookbooklm-remote-code-scan-"));
  execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${tempDir.replace(/'/g, "''")}' -Force`],
    { stdio: "pipe" },
  );
  return tempDir;
}

const args = process.argv.slice(2);
const targets = [];
const tempDirs = [];

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--zip") {
    const zipPath = args[i + 1];
    if (!zipPath) throw new Error("--zip requires a path");
    const tempDir = extractZip(path.resolve(process.cwd(), zipPath));
    tempDirs.push(tempDir);
    targets.push(tempDir);
    i += 1;
  } else {
    targets.push(path.resolve(process.cwd(), args[i]));
  }
}

if (!targets.length) targets.push(path.resolve(process.cwd(), "dist"));

try {
  const findings = targets.flatMap((target) => scanTarget(target));
  if (findings.length) {
    console.error("Remote-hosted-code verification failed:");
    for (const finding of findings) {
      console.error(`- ${finding.pattern}: ${finding.filePath}`);
      console.error(`  ${finding.snippet}`);
    }
    process.exit(1);
  }
  console.log("Remote-hosted-code verification passed.");
} finally {
  for (const tempDir of tempDirs) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
