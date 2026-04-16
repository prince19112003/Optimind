// ─────────────────────────────────────────────────────────────────────────────
// src/core/analyzer.ts  –  AST-Based Code Analyzer + Security Auditor
// Uses ts-morph lazily (loaded on first use to avoid blocking extension host)
// ─────────────────────────────────────────────────────────────────────────────
import * as vscode from 'vscode';
import { AIClient } from './aiClient';
import { Benchmarker } from './benchmarker';

// ───────────────────────── Types ─────────────────────────────────────────────

export interface AnalysisResult {
    original:     string;
    optimized:    string;
    explanation:  string;
    improvement:  string;   // e.g. "O(n²) → O(n)"
    language:     string;
}

export interface SecurityFinding {
    category:    string;
    severity:    'critical' | 'high' | 'medium' | 'low';
    line:        number;
    description: string;
    fix:         string;
}

export interface SecurityAuditResult {
    findings: SecurityFinding[];
    summary:  string;
}

// ─────────── Prompt builders ──────────────────────────────────────────────────

function buildOptimizePrompt(code: string, lang: string, context?: string): string {
    return `You are an expert ${lang} performance engineer.
Analyze this code for: nested loops, redundant computations, memory leaks, and suboptimal patterns.

CRITICAL RULES:
1. Preserve the EXACT functional context and variable names.
2. SIMPLIFY the code for readability. Do NOT overcomplicate it.
3. DO NOT add unnecessary boilerplate, classes, or external dependencies.
4. OPTIMIZE FOR BOTH: Seek a balance between Time Complexity (speed) and Space Complexity (memory usage). Avoid massive memory trade-offs for minor speed gains.
5. IF the code is ALREADY optimally written and highly readable, respond with exactly its ORIGINAL code, and put "Already optimized" in the explanation. Only rewrite if you can genuinely improve readability, simplicity, or performance (Time/Space).

Return your response exactly in this format using XML tags:

<desc>
- <bullet point 1: strictly summarizing Time/Space complexity>
- <bullet point 2: brief note on optimization>
</desc>

<code>
\`\`\`${lang}
<full optimized code here, ENSURE 100% CORRECT SYNTAX>
\`\`\`
</code>

${context ? `AVAILABLE SIBLING CONTEXT (Do not redefine these, just know they exist):\n\`\`\`${lang}\n${context}\n\`\`\`\n` : ''}
CODE TO OPTIMIZE:
\`\`\`${lang}
${code}
\`\`\``;
}

function buildSecurityPrompt(code: string, lang: string): string {
    return `You are a senior ${lang} security engineer.
Scan this code for vulnerabilities: SQL injection, XSS, hardcoded secrets, path traversal, command injection, insecure deserialization, SSRF, weak crypto, missing auth checks, race conditions.
Return a JSON object ONLY:
{
  "findings": [
    { "category": "SQL Injection", "severity": "critical", "line": 12, "description": "...", "fix": "..." }
  ],
  "summary": "<1-sentence audit summary>"
}

CODE:
\`\`\`${lang}
${code}
\`\`\``;
}

function buildTestPrompt(code: string, lang: string): string {
    const framework = lang === 'python' ? 'pytest' : lang === 'java' ? 'JUnit 5' : lang === 'cpp' ? 'Catch2' : 'Jest';
    return `Generate comprehensive ${framework} unit tests for this ${lang} code.
Cover: happy path, edge cases, null/undefined inputs, boundary values.
Return only the test code, no explanations.

CODE:
\`\`\`${lang}
${code}
\`\`\``;
}

// ─────────── Response parser ──────────────────────────────────────────────────

function extractJson<T>(raw: string): T {
    // Strip markdown code fences
    let clean = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();

    // Find the first { } block
    const start = clean.indexOf('{');
    const end   = clean.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
        clean = clean.slice(start, end + 1);
    }
    return JSON.parse(clean) as T;
}

// ─────────── Analyzer class ───────────────────────────────────────────────────

export class CodeAnalyzer {

    /** Optimize code using AI */
    async optimize(
        code: string,
        language: string,
        fullFileContext: string = '',
        onToken?: (t: string) => void
    ): Promise<AnalysisResult> {
        let smartCtx = '';
        if (fullFileContext && (language === 'typescript' || language === 'javascript')) {
            smartCtx = this._extractSmartContext(fullFileContext, language);
        }

        const prompt = buildOptimizePrompt(code, language, smartCtx);
        const raw    = await AIClient.generate({ prompt, language, onToken });

        let optimized   = code;  // safe fallback
        let explanation = 'AI returned non-standard output.';
        let improvement = '';

        try {
            // Attempt standard JSON parsing first just in case
            const parsed = extractJson<{ optimized: string; explanation: string; improvement: string }>(raw);
            optimized   = parsed.optimized   || code;
            explanation = parsed.explanation || explanation;
            improvement = parsed.improvement || '';
        } catch {
            // Parse XML tags if JSON fails
            const codeMatch = raw.match(/<code>[\s\S]*?```[\w]*\n([\s\S]+?)```[\s\S]*?<\/code>/) || raw.match(/```[\w]*\n([\s\S]+?)```/);
            if (codeMatch) optimized = codeMatch[1].trim();

            const descMatch = raw.match(/<desc>([\s\S]+?)<\/desc>/i);
            if (descMatch) improvement = descMatch[1].replace(/^- /gm, '').trim();
        }

        let finalImprovement = improvement;
        
        // Auto-Benchmark performance if JS/TS
        if (optimized && optimized !== code && (language === 'javascript' || language === 'typescript')) {
            const bench = await Benchmarker.compare(code, optimized, language);
            if (bench.percentFaster !== 0 && !bench.error) {
                const spd = bench.percentFaster > 0 ? `⚡ ${bench.percentFaster}% Faster` : `🐌 ${Math.abs(bench.percentFaster)}% Slower`;
                finalImprovement = `${spd} (Old: ${bench.oldTimeMs}ms vs New: ${bench.newTimeMs}ms)`;
            }
        }

        return { original: code, optimized, explanation, improvement: finalImprovement, language };
    }

    /** Security audit using AI */
    async securityAudit(code: string, language: string): Promise<SecurityAuditResult> {
        const prompt = buildSecurityPrompt(code, language);
        const raw    = await AIClient.generate({ prompt, language });

        try {
            return extractJson<SecurityAuditResult>(raw);
        } catch {
            return {
                findings: [],
                summary:  'Could not parse security audit response. Raw: ' + raw.slice(0, 200)
            };
        }
    }

    /** Generate unit tests using AI */
    async generateTests(code: string, language: string): Promise<string> {
        const prompt = buildTestPrompt(code, language);
        return AIClient.generate({ prompt, language });
    }

    /** Calculate a heuristic "health score" for the active file */
    calculateScore(code: string, language: string): { score: number, details: string[] } {
        let score = 100;
        const details: string[] = [];
        const lines = code.split('\n');

        // Penalise for common anti-patterns
        const patterns = [
            { regex: /for\s*\(.*\)\s*\{[\s\S]*?for\s*\(/,  penalty: 15, name: 'Nested loops (Complexity)' },
            { regex: /catch\s*\([^)]*\)\s*\{\s*\}/,         penalty: 10, name: 'Empty catch blocks' },
            { regex: /console\.log/g,                        penalty: 2,  name: 'Console logs remaining' },
            { regex: /var\s+/g,                              penalty: 3,  name: 'Legacy "var" usage' },
            { regex: /==(?!=)/g,                             penalty: 2,  name: 'Loose equality (==)' },
            { regex: /TODO|FIXME|HACK/gi,                    penalty: 5,  name: 'Unresolved TODOs' },
            { regex: /password\s*=\s*["'][^"']+["']/i,       penalty: 20, name: 'Hardcoded secrets' },
        ];

        for (const p of patterns) {
            const matches = (code.match(p.regex) || []).length;
            if (matches > 0) {
                score -= Math.min(matches * p.penalty, 25);
                details.push(`${p.name}: Found ${matches}`);
            }
        }

        // Penalise very long files
        if (lines.length > 500) {
            score -= 10;
            details.push('File length (>500 lines)');
        }

        // Language-specific checks
        if (language === 'javascript' || language === 'typescript') {
            if (/\.innerHTML\s*=/.test(code)) {
                score -= 10;
                details.push('DOM XSS risk (.innerHTML)');
            }
            if (/eval\(/.test(code)) {
                score -= 15;
                details.push('Security risk (eval usage)');
            }
        }

        if (details.length === 0) details.push('No major issues found. Code is clean.');

        return { 
            score: Math.max(0, Math.min(100, Math.round(score))),
            details 
        };
    }

    private _extractSmartContext(fullCode: string, lang: string): string {
        try {
            const { Project } = require('ts-morph');
            const project = new Project({ useInMemoryFileSystem: true });
            const sf = project.createSourceFile(`temp.${lang === 'typescript'? 'ts' : 'js'}`, fullCode);
            let skeleton = '';
            sf.getFunctions().forEach((f: any) => skeleton += `function ${f.getName()}() { ... }\n`);
            sf.getClasses().forEach((c: any) => skeleton += `class ${c.getName()} { ... }\n`);
            sf.getInterfaces().forEach((i: any) => skeleton += `interface ${i.getName()} { ... }\n`);
            
            // Safety: Cap context to avoid overloading small local models
            if (skeleton.length > 2000) {
                return skeleton.slice(0, 2000) + '\n... [context truncated]';
            }
            return skeleton.trim();
        } catch { return ''; }
    }

    /** Quick check whether text is actually code (not a markdown doc etc.) */
    isCodeFile(document: vscode.TextDocument): boolean {
        const SUPPORTED = ['javascript', 'typescript', 'python', 'cpp', 'c', 'java', 'go', 'rust'];
        return SUPPORTED.includes(document.languageId);
    }
}
