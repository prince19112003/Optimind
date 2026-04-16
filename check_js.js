const fs = require('fs');
const content = fs.readFileSync('src/providers/dashboardProvider.ts', 'utf8');
const match = content.match(/<script nonce="\$\{scriptNonce\}">\n([\s\S]*?)<\/script>/);
if (!match) {
    console.error("No script match");
    process.exit(1);
}
const js = match[1];
try {
    // We expect ReferenceError for 'document' or 'acquireVsCodeApi' but NOT SyntaxError
    new Function(js);
    console.log("Syntax is valid!");
} catch (e) {
    if (e instanceof SyntaxError) {
        console.error("SyntaxError found:", e.message);
        process.exit(1);
    }
    console.log("Valid syntax but runtime error, which is fine:", e.message);
}
