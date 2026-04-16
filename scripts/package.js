// ─────────────────────────────────────────────────────────────────────────────
// scripts/package.js  –  VSIX packaging (deletes old + builds new)
// ─────────────────────────────────────────────────────────────────────────────
const { execSync } = require('child_process');
const fs           = require('fs');
const path         = require('path');

const buildDir = path.resolve(__dirname, '../build');

// 1. Ensure build/ folder exists
if (!fs.existsSync(buildDir)) { fs.mkdirSync(buildDir); }

// 2. Delete any old .vsix files so only the latest remains
const oldFiles = fs.readdirSync(buildDir).filter(f => f.endsWith('.vsix'));
oldFiles.forEach(f => {
    fs.unlinkSync(path.join(buildDir, f));
    console.log(`[OptiMind] Deleted old: ${f}`);
});

// 3. Bundle first
console.log('[OptiMind] Bundling...');
require('./build.js');

// 4. Package with vsce
setTimeout(() => {
    console.log('[OptiMind] Packaging VSIX...');
    try {
        execSync(
            `node "${path.resolve(__dirname, '../node_modules/@vscode/vsce/bin/vsce')}" package --out "${buildDir}/" --allow-star-activation`,
            { stdio: 'inherit', cwd: path.resolve(__dirname, '..') }
        );
        console.log('[OptiMind] Package complete! Check build/ folder.');
    } catch (e) {
        console.error('[OptiMind] Packaging failed:', e.message);
        process.exit(1);
    }
}, 4000); // wait for esbuild
