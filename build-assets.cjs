#!/usr/bin/env node
/**
 * Build-time asset discovery for Speech Rule Engine mathmaps.
 * Populates sea-config.json assets map dynamically.
 */

const fs = require('fs');
const path = require('path');

function main() {
  const root = process.cwd();
  const seaCfgPath = path.join(root, 'sea-config.json');
  const sreMathmapsDir = path.join(root, 'node_modules', 'speech-rule-engine', 'lib', 'mathmaps');

  if (!fs.existsSync(sreMathmapsDir)) {
    console.error('SRE mathmaps directory not found:', sreMathmapsDir);
    process.exit(1);
  }
  if (!fs.existsSync(seaCfgPath)) {
    console.error('sea-config.json not found at', seaCfgPath);
    process.exit(1);
  }

  const seaConfig = JSON.parse(fs.readFileSync(seaCfgPath, 'utf8'));
  seaConfig.assets = seaConfig.assets || {};

  const files = fs.readdirSync(sreMathmapsDir).filter(f => f.endsWith('.json'));
  files.forEach(file => {
    seaConfig.assets[`mathmaps/${file}`] = path.relative(root, path.join(sreMathmapsDir, file));
  });

  // Write a manifest file listing locales for SEA runtime extraction
  const distDir = path.join(root, 'dist');
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir);
  const manifestPath = path.join(distDir, 'mathmaps-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ files }, null, 2));
  seaConfig.assets['mathmaps/manifest.json'] = path.relative(root, manifestPath);

  fs.writeFileSync(seaCfgPath, JSON.stringify(seaConfig, null, 2) + '\n');
  console.log(`Added ${files.length} mathmaps assets to sea-config.json`);
}

main();
