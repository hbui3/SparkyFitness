#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import prettier from "prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const newVersion = process.argv[2];
if (!newVersion) {
  console.error("Error: Please provide a version number.");
  console.error("Usage: pnpm run set-version <version>");
  console.error("Example: pnpm run set-version 1.6.0");
  process.exit(1);
}

const cleanVersion = newVersion.replace(/^v/, "");

if (/^[0-9]+\.[0-9]+\.[0-9]+\.0[0-9]+$/.test(cleanVersion)) {
  console.error(
    "Error: numeric fourth version segments must not contain leading zeros (e.g. use 1.7.3.1, not 1.7.3.01).",
  );
  process.exit(1);
}

/**
 * Writes JSON back in the exact shape Prettier would produce for that file.
 *
 * JSON.stringify puts every array element on its own line, which re-expands
 * entries Prettier keeps inline -- app.json's single-element plugin arrays
 * (["expo-notifications"], ["@bacons/apple-targets"]) are the ones that bite.
 * Writing raw stringify output left `pnpm run validate` failing format:check
 * after every version bump. resolveConfig() picks up each package's own
 * .prettierrc, so each file keeps its package's formatting.
 */
async function writeJsonFormatted(fullPath, json) {
  const options = await prettier.resolveConfig(fullPath);
  const formatted = await prettier.format(JSON.stringify(json, null, 2), {
    ...options,
    filepath: fullPath,
  });
  fs.writeFileSync(fullPath, formatted);
}

const targetFiles = [
  "SparkyFitnessServer/package.json",
  "SparkyFitnessFrontend/package.json",
  "SparkyFitnessMobile/package.json",
  "shared/package.json",
];

let updatedCount = 0;

for (const relPath of targetFiles) {
  const fullPath = path.join(rootDir, relPath);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, "utf8");
    const json = JSON.parse(content);
    json.version = cleanVersion;
    await writeJsonFormatted(fullPath, json);
    console.log(`✓ Updated ${relPath} -> ${cleanVersion}`);
    updatedCount++;
  } else {
    console.warn(`⚠ Skipping missing file: ${relPath}`);
  }
}

// Also update SparkyFitnessMobile/app.json (expo.version)
const appJsonPath = path.join(rootDir, "SparkyFitnessMobile/app.json");
if (fs.existsSync(appJsonPath)) {
  const content = fs.readFileSync(appJsonPath, "utf8");
  const json = JSON.parse(content);
  if (json.expo) {
    json.expo.version = cleanVersion;
    await writeJsonFormatted(appJsonPath, json);
    console.log(
      `✓ Updated SparkyFitnessMobile/app.json (expo.version) -> ${cleanVersion}`,
    );
    updatedCount++;
  }
}

// Also update helm/chart/Chart.yaml (version and appVersion)
const chartYamlPath = path.join(rootDir, "helm/chart/Chart.yaml");
if (fs.existsSync(chartYamlPath)) {
  let chartVersion = cleanVersion;
  const fourSegmentMatch = cleanVersion.match(
    /^([0-9]+\.[0-9]+\.[0-9]+)\.(.+)$/,
  );
  if (fourSegmentMatch) {
    chartVersion = `${fourSegmentMatch[1]}-${fourSegmentMatch[2]}`;
  }

  let content = fs.readFileSync(chartYamlPath, "utf8");
  content = content.replace(/^version:\s*.+$/m, `version: ${chartVersion}`);
  content = content.replace(
    /^appVersion:\s*.+$/m,
    `appVersion: "v${cleanVersion}"`,
  );
  fs.writeFileSync(chartYamlPath, content, "utf8");
  console.log(
    `✓ Updated helm/chart/Chart.yaml -> version: ${chartVersion}, appVersion: "v${cleanVersion}"`,
  );
  updatedCount++;
}

console.log(
  `\nSuccessfully updated ${updatedCount} file(s) to version v${cleanVersion}!`,
);
