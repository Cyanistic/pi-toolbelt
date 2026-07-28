#!/usr/bin/env node
/**
 * Prepare a release working tree for pi-toolbelt.
 *
 * Accepts exactly one stable SemVer X.Y.Z, validates the tree and version
 * rules, runs checks, updates package metadata, generates CHANGELOG.md via
 * local git-cliff, and dry-runs the pack. Stops before commit/tag/push/publish.
 *
 * Usage: npm run release:prepare -- <version>
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import semver from "semver";

const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const STABLE_TAG = /^v(\d+\.\d+\.\d+)$/;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(root, "package.json");
const gitCliffBin = path.join(root, "node_modules", ".bin", "git-cliff");

/** @param {string} message */
function fail(message) {
  console.error(`release:prepare: ${message}`);
  process.exit(1);
}

/**
 * @param {string} stage
 * @param {string} command
 * @param {string[]} args
 * @param {{ allowFailure?: boolean }} [opts]
 */
function run(stage, command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    console.error(`release:prepare: stage "${stage}" failed to start: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0 && !opts.allowFailure) {
    console.error(
      `release:prepare: stage "${stage}" failed with exit code ${result.status ?? "unknown"}. ` +
        "Any already-written files were left inspectable; nothing was committed, tagged, pushed, or published.",
    );
    process.exit(result.status ?? 1);
  }

  return result;
}

/**
 * @param {string} stage
 * @param {string} command
 * @param {string[]} args
 */
function capture(stage, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  if (result.error) {
    fail(`stage "${stage}" failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    fail(`stage "${stage}" failed with exit code ${result.status ?? "unknown"}`);
  }
  return (result.stdout ?? "").trim();
}

function requireRepoRoot() {
  if (!existsSync(packageJsonPath)) {
    fail("package.json not found; run from the repository root");
  }

  const gitRoot = capture("repo-root", "git", ["rev-parse", "--show-toplevel"]);
  if (path.resolve(gitRoot) !== root) {
    fail(`must run from repository root (${gitRoot})`);
  }
}

function requireCleanWorkingTree() {
  const status = capture("clean-tree", "git", ["status", "--porcelain"]);
  if (status.length > 0) {
    fail(
      "working tree is dirty. Commit or stash unrelated changes first so release:prepare can leave an inspectable release-only diff.",
    );
  }
}

/**
 * @param {string[]} argv
 * @returns {string}
 */
function parseTargetVersion(argv) {
  const args = argv.slice(2);
  if (args.length === 0) {
    fail("missing version. Usage: npm run release:prepare -- <version>");
  }
  if (args.length > 1) {
    fail(`expected exactly one version argument, got ${args.length}: ${args.join(" ")}`);
  }

  const input = args[0];
  if (input.startsWith("v") || input.startsWith("V")) {
    fail(`version must be bare SemVer X.Y.Z without a "v" prefix (got ${input})`);
  }
  if (input.includes("+")) {
    fail(`build metadata is not supported (got ${input})`);
  }
  if (input.includes("-")) {
    fail(`prerelease versions are not supported (got ${input})`);
  }
  if (!STABLE_VERSION.test(input)) {
    fail(`version must be stable SemVer X.Y.Z (got ${input})`);
  }
  if (semver.valid(input) !== input) {
    fail(`version is not a valid SemVer X.Y.Z (got ${input})`);
  }
  return input;
}

/** @returns {string[]} */
function listStableVersionTags() {
  const raw = capture("list-tags", "git", ["tag", "--list", "v*"]);
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((tag) => STABLE_TAG.test(tag));
}

/**
 * @param {string} target
 * @param {string} packageVersion
 * @param {string[]} tags
 */
function validateVersionAgainstHistory(target, packageVersion, tags) {
  if (tags.length === 0) {
    if (target !== packageVersion) {
      fail(
        `initial release (no vX.Y.Z tags) must use the package's existing version ${packageVersion} (got ${target})`,
      );
    }
    return;
  }

  const tagVersions = tags
    .map((tag) => tag.slice(1))
    .filter((version) => semver.valid(version) === version);
  const highestTag = tagVersions.sort(semver.rcompare)[0];

  if (!semver.gt(target, highestTag)) {
    fail(
      `target ${target} must be strictly greater than the highest version tag v${highestTag}`,
    );
  }
  if (!semver.gt(target, packageVersion)) {
    fail(
      `target ${target} must be strictly greater than the package version ${packageVersion} once release tags exist`,
    );
  }
}

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (typeof pkg.version !== "string" || semver.valid(pkg.version) !== pkg.version) {
    fail(`package.json version is missing or invalid: ${pkg.version}`);
  }
  return pkg.version;
}

function main() {
  process.chdir(root);

  const target = parseTargetVersion(process.argv);
  requireRepoRoot();
  requireCleanWorkingTree();

  const packageVersion = readPackageVersion();
  const tags = listStableVersionTags();
  validateVersionAgainstHistory(target, packageVersion, tags);

  if (!existsSync(gitCliffBin)) {
    fail("local git-cliff binary missing; run npm install");
  }
  if (!existsSync(path.join(root, "cliff.toml"))) {
    fail("cliff.toml missing at repository root");
  }

  // Pre-mutation gate
  run("check", "npm", ["run", "check"]);

  // Mutations begin here. Failures leave the tree inspectable.
  run("version-files", "npm", [
    "version",
    target,
    "--no-git-tag-version",
    "--allow-same-version",
  ]);

  run("changelog", gitCliffBin, [
    "--config",
    "cliff.toml",
    "--tag",
    `v${target}`,
    "--output",
    "CHANGELOG.md",
  ]);

  run("pack-dry-run", "npm", ["pack", "--dry-run"]);

  console.log("");
  console.log(`release:prepare: prepared ${target} in the working tree.`);
  console.log(
    "Stopped before commit, tag, push, and publish. Inspect with `git diff` (and `git status`), then follow docs/releasing.md for the manual release steps.",
  );
}

main();
