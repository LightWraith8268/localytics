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
  // Update version.json
  fs.writeFileSync('./version.json', JSON.stringify(versionConfig, null, 2));

  // Update fallback versions in version.js
  const versionJsPath = './assets/js/version.js';
  if (fs.existsSync(versionJsPath)) {
    let versionJsContent = fs.readFileSync(versionJsPath, 'utf8');
    versionJsContent = versionJsContent
      .replace(/version: '[^']+', timestamp: '[^']+'/g, `version: '${newVersion}', timestamp: '${timestamp}'`)
      .replace(/return versionConfig\?.version \|\| '[^']+'/g, `return versionConfig?.version || '${newVersion}'`)
      .replace(/return versionConfig\?.timestamp \|\| '[^']+'/g, `return versionConfig?.timestamp || '${timestamp}'`);
    fs.writeFileSync(versionJsPath, versionJsContent);
  }

  // Update fallback version in service-worker.js
  const swPath = './service-worker.js';
  if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, 'utf8');
    swContent = swContent.replace(/VERSION = 'wb-[^']+'/g, `VERSION = 'wb-${newVersion}-${timestamp}'`);
    fs.writeFileSync(swPath, swContent);
  }

  console.log(`✅ Updated version to ${newVersion} with timestamp ${timestamp}`);
  console.log('📄 Updated files:');
  console.log('   - version.json');
  console.log('   - assets/js/version.js (fallback values)');
  console.log('   - service-worker.js (fallback value)');
  console.log('');
  console.log('🚀 Next steps:');
  console.log('   1. git add .');
  console.log(`   2. git commit -m "bump version to ${newVersion}"`);
  console.log('   3. git push origin main');
} catch (error) {
  console.error('Error updating version files:', error);
  process.exit(1);
}