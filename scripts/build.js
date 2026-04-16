// ─────────────────────────────────────────────────────────────────────────────
// scripts/build.js  –  ESBuild entrypoint (CommonJS, no shell restrictions)
// ─────────────────────────────────────────────────────────────────────────────
const esbuild = require('esbuild');
const path    = require('path');

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
    entryPoints: [path.resolve(__dirname, '../src/extension.ts')],
    bundle:      true,
    outfile:     path.resolve(__dirname, '../dist/extension.js'),
    external:    ['vscode'],
    format:      'cjs',
    platform:    'node',
    sourcemap:   !isWatch,
    minify:      !isWatch,
    logLevel:    'info',
};

if (isWatch) {
    esbuild.context(options).then(ctx => {
        ctx.watch();
        console.log('[OptiMind] Watching for changes...');
    });
} else {
    esbuild.build(options).then(() => {
        console.log('[OptiMind] Build complete.');
    }).catch(() => process.exit(1));
}
