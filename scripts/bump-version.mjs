#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const cwd = process.cwd();

function parseSemver(v) {
  const m = String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/i);
  if (!m) return [1, 0, 0];
  return [Number(m[1]) || 0, Number(m[2]) || 0, Number(m[3]) || 0];
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function formatSemver([maj, min, pat]) {
  return `${maj}.${min}.${pat}`;
}

function incrementPatch(v) {
  const [maj, min, pat] = parseSemver(v);
  return formatSemver([maj, min, pat + 1]);
}

const args = process.argv.slice(2);
let minNextFrom = '';
let explicitSet = '';
let releaseTitle = '';
let releaseSummary = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--min-next-from' && args[i + 1]) {
    minNextFrom = args[i + 1];
    i++;
  } else if (args[i] === '--set' && args[i + 1]) {
    explicitSet = args[i + 1];
    i++;
  } else if (args[i] === '--title' && args[i + 1]) {
    releaseTitle = args[i + 1];
    i++;
  } else if (args[i] === '--summary' && args[i + 1]) {
    releaseSummary = args[i + 1];
    i++;
  }
}

const pkgPath = path.join(cwd, 'package.json');
const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(pkgRaw);
const currentVersion = String(pkg.version || '1.0.9').trim();

let nextVersion;
if (explicitSet) {
  nextVersion = formatSemver(parseSemver(explicitSet));
} else if (minNextFrom) {
  // Ensure version is strictly greater than minNextFrom without double-bumping if already bumped
  if (compareSemver(currentVersion, minNextFrom) > 0) {
    nextVersion = formatSemver(parseSemver(currentVersion));
  } else {
    nextVersion = incrementPatch(minNextFrom);
  }
} else {
  nextVersion = incrementPatch(currentVersion);
}

// 1. Update package.json
if (pkg.version !== nextVersion) {
  pkg.version = nextVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

// 2. Update src/version.ts
const versionTsPath = path.join(cwd, 'src', 'version.ts');
if (fs.existsSync(versionTsPath)) {
  const raw = fs.readFileSync(versionTsPath, 'utf8');
  const updated = raw.replace(/(['"])\d+\.\d+\.\d+\1/, `'${nextVersion}'`);
  if (updated !== raw) {
    fs.writeFileSync(versionTsPath, updated, 'utf8');
  }
}

// 3. Update server.ts fallback version
const serverTsPath = path.join(cwd, 'server.ts');
if (fs.existsSync(serverTsPath)) {
  const raw = fs.readFileSync(serverTsPath, 'utf8');
  const updated = raw.replace(
    /(readLocalAppVersion[\s\S]*?return\s+['"])\d+\.\d+\.\d+(['"];)/,
    `$1${nextVersion}$2`
  );
  if (updated !== raw) {
    fs.writeFileSync(serverTsPath, updated, 'utf8');
  }
}

// 4. Update index.html title & meta tags
const indexHtmlPath = path.join(cwd, 'index.html');
if (fs.existsSync(indexHtmlPath)) {
  const raw = fs.readFileSync(indexHtmlPath, 'utf8');
  const updated = raw.replace(/GaConPro V\d+\.\d+\.\d+/g, `GaConPro V${nextVersion}`);
  if (updated !== raw) {
    fs.writeFileSync(indexHtmlPath, updated, 'utf8');
  }
}

// 5. Prepend new version entry into src/changelog.json if not already present
const changelogPath = path.join(cwd, 'src', 'changelog.json');
if (fs.existsSync(changelogPath)) {
  try {
    const entries = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));
    if (Array.isArray(entries) && !entries.some((e) => e && e.version === nextVersion)) {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      const dateStr = `${dd}/${mm}/${yyyy}`;
      const cleanSummary = String(releaseSummary || '').trim();
      const cleanTitle =
        String(releaseTitle || '').trim() ||
        (cleanSummary ? cleanSummary.slice(0, 90) : `Cập nhật tính năng & tối ưu hệ thống V${nextVersion}`);
      const changeLines = cleanSummary
        ? cleanSummary
            .split(/\s*[;|]\s*|\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [
            `Đồng bộ mã nguồn, vá lỗi và cải thiện hiệu năng trong phiên bản V${nextVersion}.`,
          ];
      entries.unshift({
        version: nextVersion,
        date: dateStr,
        title: cleanTitle,
        changes: changeLines,
      });
      fs.writeFileSync(changelogPath, JSON.stringify(entries.slice(0, 20), null, 2) + '\n', 'utf8');
    }
  } catch {
    // ignore changelog parse failure
  }
}

console.log(nextVersion);
