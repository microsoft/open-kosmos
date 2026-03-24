#!/usr/bin/env node
/**
 * fetch-runtime-versions.js
 *
 * Fetches the latest stable version lists for Bun, UV, and Python
 * from official sources (GitHub Releases API + endoflife.date).
 *
 * Usage:
 *   node scripts/fetch-runtime-versions.js
 *   node scripts/fetch-runtime-versions.js --json
 *   node scripts/fetch-runtime-versions.js --json > scripts/runtime-versions.json
 */

const https = require('https');

const SOURCES = {
  bun: 'https://api.github.com/repos/oven-sh/bun/releases?per_page=100',
  uv: 'https://api.github.com/repos/astral-sh/uv/releases?per_page=100',
  // Official Python.org release API — returns all published releases
  python: 'https://www.python.org/api/v2/downloads/release/?format=json&is_published=true&version=3',
};

// Minimum Python minor version to include (e.g. "3.9" → only 3.9+)
const PYTHON_MIN_VERSION = '3.9';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'openkosmos-version-fetcher/1.0',
        Accept: 'application/json',
      },
    };
    https
      .get(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
          }
        });
      })
      .on('error', reject);
  });
}

function parseBunVersions(releases) {
  return releases
    .filter((r) => !r.prerelease && !r.draft)
    .map((r) => ({
      version: r.tag_name.replace(/^bun-v/, ''),
      date: r.published_at ? r.published_at.slice(0, 10) : null,
    }))
    .filter((r) => /^\d+\.\d+\.\d+$/.test(r.version));
}

function parseUvVersions(releases) {
  return releases
    .filter((r) => !r.prerelease && !r.draft)
    .map((r) => ({
      version: r.tag_name.replace(/^v/, ''),
      date: r.published_at ? r.published_at.slice(0, 10) : null,
    }))
    .filter((r) => /^\d+\.\d+\.\d+$/.test(r.version));
}

/**
 * Parse all individual Python patch versions from python.org API.
 * Returns a sorted array of version strings, newest first.
 */
function parsePythonAllVersions(releases) {
  const [minMajor, minMinor] = PYTHON_MIN_VERSION.split('.').map(Number);

  return releases
    .filter((r) => {
      if (r.pre_release) return false;
      // name is like "Python 3.10.12"
      const m = r.name.match(/^Python (\d+)\.(\d+)\.(\d+)$/);
      if (!m) return false;
      const major = parseInt(m[1], 10);
      const minor = parseInt(m[2], 10);
      return major === minMajor ? minor >= minMinor : major > minMajor;
    })
    .map((r) => {
      const m = r.name.match(/^Python (\d+\.\d+\.\d+)$/);
      return {
        version: m[1],
        date: r.release_date ? r.release_date.slice(0, 10) : null,
      };
    })
    .sort((a, b) => {
      const pa = a.version.split('.').map(Number);
      const pb = b.version.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pb[i] - pa[i];
      }
      return 0;
    });
}

async function main() {
  const isJson = process.argv.includes('--json');

  if (!isJson) {
    console.log('Fetching runtime versions from official sources...\n');
  }

  const [bunReleases, uvReleases, pythonReleases] = await Promise.all([
    fetchJson(SOURCES.bun),
    fetchJson(SOURCES.uv),
    fetchJson(SOURCES.python),
  ]);

  const bunVersions = parseBunVersions(bunReleases);
  const uvVersions = parseUvVersions(uvReleases);
  const pythonVersions = parsePythonAllVersions(pythonReleases);

  const result = {
    fetchedAt: new Date().toISOString(),
    bun: {
      latest: bunVersions[0].version,
      versions: bunVersions,
    },
    uv: {
      latest: uvVersions[0].version,
      versions: uvVersions,
    },
    python: {
      latest: pythonVersions[0].version,
      versions: pythonVersions,
    },
  };

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Human-readable output
  console.log(`=== Bun (latest: ${result.bun.latest}) ===`);
  result.bun.versions.forEach((r) => console.log(`  ${r.version}  ${r.date}`));

  console.log(`\n=== UV (latest: ${result.uv.latest}) ===`);
  result.uv.versions.forEach((r) => console.log(`  ${r.version}  ${r.date}`));

  console.log(`\n=== Python (${result.python.versions.length} versions, latest: ${result.python.latest}) ===`);
  result.python.versions.forEach((r) => console.log(`  ${r.version}  ${r.date}`));

  console.log(`\nFetched at: ${result.fetchedAt}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
