#!/usr/bin/env node
/**
 * Single-file Executable Application (SEA) build script
 */

const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

function main() {
  const platform = os.platform();
  
  // Determine binary name
  const binaryName = 'latex2sre';
  
  console.log(`Building SEA for platform: ${platform}`);
  console.log(`Binary name: ${binaryName}`);
  
  try {
    // Step 1: Copy Node.js executable
    console.log('Copying Node.js executable...');
    fs.copyFileSync(process.execPath, binaryName);
    
    // Step 3: Generate SEA blob
    console.log('Generating SEA blob...');
    execSync('node --experimental-sea-config sea-config.json', { stdio: 'inherit' });
    
    // Step 4: Inject blob with postject
    console.log('Injecting SEA blob...');
    execSync(`npx postject "${binaryName}" NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, { 
      stdio: 'inherit' 
    });
    
    // Step 5: Make executable
    console.log('Making binary executable...');
    fs.chmodSync(binaryName, 0o755);
    
    console.log(`✅ SEA build completed successfully: ${binaryName}`);
    
  } catch (error) {
    console.error('❌ SEA build failed:', error.message);
    
    // Clean up partial binary on failure
    if (fs.existsSync(binaryName)) {
      try {
        fs.unlinkSync(binaryName);
        console.log(`Cleaned up partial binary: ${binaryName}`);
      } catch (cleanupError) {
        console.warn(`Warning: Could not clean up ${binaryName}:`, cleanupError.message);
      }
    }
    
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };