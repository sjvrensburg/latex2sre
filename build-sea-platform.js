// build-sea-platform.js
const fs = require("fs");
const { execSync } = require("child_process");

const isWindows = process.platform === "win32";
const binaryName = isWindows ? "latex2sre.exe" : "latex2sre";
const nodeBinary = process.execPath;

console.log(`🔧 Building SEA binary for ${process.platform}`);
console.log(`Node binary: ${nodeBinary}`);
console.log(`Target binary: ${binaryName}`);

try {
  // Copy Node binary
  fs.copyFileSync(nodeBinary, binaryName);
  console.log(`✅ Copied Node binary to ${binaryName}`);

  // Inject SEA blob
  const injectCmd = `npx postject ${binaryName} NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`;
  console.log(`Running: ${injectCmd}`);
  execSync(injectCmd, { stdio: "inherit" });
  console.log(`✅ Injected SEA blob into ${binaryName}`);

  // Make executable (Unix only)
  if (!isWindows) {
    fs.chmodSync(binaryName, 0o755);
    console.log(`✅ Set executable permissions on ${binaryName}`);
  }

  // Verify
  if (fs.existsSync(binaryName)) {
    const stats = fs.statSync(binaryName);
    console.log(`✅ Binary ready: ${binaryName} (${stats.size} bytes)`);
  } else {
    throw new Error(`Binary ${binaryName} not found after build`);
  }
} catch (err) {
  console.error(`❌ SEA build failed: ${err.message}`);
  process.exit(1);
}
