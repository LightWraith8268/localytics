#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get version from command line argument
const newVersion = process.argv[2];

if (!newVersion) {
  console.error('Usage: node update-version.js <version>');
  console.error('Example: node update-version.js 1.2.58');
  process.exit(1);
}

// Validate version format (simple semantic version check)
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error('Error: Version must be in format x.y.z (e.g., 1.2.58)');
  process.exit(1);
}

// Generate timestamp
const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

// Update version.json
const versionConfig = {
  version: newVersion,
  timestamp: timestamp
};

try {
  fs.writeFileSync('./version.json', JSON.stringify(versionConfig, null, 2));
  console.log(`✅ Updated version to ${newVersion} with timestamp ${timestamp}`);
  console.log('📄 Updated files:');
  console.log('   - version.json');
  console.log('');
  console.log('🚀 Next steps:');
  console.log('   1. git add .');
  console.log(`   2. git commit -m "bump version to ${newVersion}"`);
  console.log('   3. git push origin main');
} catch (error) {
  console.error('Error updating version.json:', error);
  process.exit(1);
}