const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

const content = fs.readFileSync('src/providers/dashboardProvider.ts', 'utf8');
const match = content.match(/return \/\* html \*\/\`([\s\S]*?)\`;/);
const htmlStr = match[1];

// Extract JS
const htmlNoVars = htmlStr.replace(/\$\{scriptNonce\}/g, 'nonce');
const dom = new JSDOM(htmlNoVars, { runScripts: "dangerously" });

console.log("JSDOM initialization completed successfully.");
