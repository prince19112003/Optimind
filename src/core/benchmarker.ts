// ─────────────────────────────────────────────────────────────────────────────
// src/core/benchmarker.ts  –  Auto-Benchmarker Subsystem
// Isolates and runs JS/TS code in a sandbox to measure real execution time.
// ─────────────────────────────────────────────────────────────────────────────
import * as vm from 'vm';

export interface BenchmarkResult {
    oldTimeMs: number;
    newTimeMs: number;
    iterations: number;
    percentFaster: number;
    error?: string;
}

export class Benchmarker {
    /**
     * Attempts to run the old vs new code using Node's VM module.
     * Only supports pure JS/TS (transpiled lightly or executed as JS).
     * Sandbox prevents accessing fs/network.
     */
    static async compare(oldCode: string, newCode: string, lang: string): Promise<BenchmarkResult> {
        if (lang !== 'javascript' && lang !== 'typescript') {
            return { oldTimeMs: 0, newTimeMs: 0, iterations: 0, percentFaster: 0, error: 'Unsupported language' };
        }

        const iterations = 10000;
        
        try {
            // Create an isolated context
            const context1 = vm.createContext({ console: { log: () => {} }, Math, Date, parseInt, parseFloat, Array, Object, String, Number });
            const context2 = vm.createContext({ console: { log: () => {} }, Math, Date, parseInt, parseFloat, Array, Object, String, Number });

            // Compile scripts wrapped in a loop
            const scriptOld = new vm.Script(`
                let start = Date.now();
                for(let i=0; i<${iterations}; i++) {
                    ${oldCode}
                }
                Date.now() - start;
            `);

            const scriptNew = new vm.Script(`
                let start = Date.now();
                for(let i=0; i<${iterations}; i++) {
                    ${newCode}
                }
                Date.now() - start;
            `);

            const oldTime = scriptOld.runInContext(context1, { timeout: 2000 }) as number;
            const newTime = scriptNew.runInContext(context2, { timeout: 2000 }) as number;

            let percent = 0;
            if (oldTime > newTime && oldTime > 0) {
                percent = Math.round(((oldTime - newTime) / oldTime) * 100);
            } else if (newTime > oldTime && newTime > 0) {
                percent = -Math.round(((newTime - oldTime) / newTime) * 100);
            }

            return {
                oldTimeMs: oldTime,
                newTimeMs: newTime,
                iterations,
                percentFaster: percent
            };

        } catch (e: any) {
            return {
                oldTimeMs: 0, newTimeMs: 0, iterations, percentFaster: 0,
                error: 'Could not bench. Syntax error or complex types used.'
            };
        }
    }
}
