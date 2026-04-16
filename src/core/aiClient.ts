// ─────────────────────────────────────────────────────────────────────────────
// src/core/aiClient.ts  –  Unified AI Client (Ollama + OpenAI + Gemini)
// Supports streaming, circuit-breaker fallback, and model pull with progress.
// ─────────────────────────────────────────────────────────────────────────────
import * as vscode from 'vscode';
import axios       from 'axios';

export type Provider = 'ollama' | 'openai' | 'gemini';

export interface GenerateOptions {
    prompt:    string;
    language?: string;
    onToken?:  (token: string) => void;   // streaming callback
}

function cfg<T>(key: string): T {
    return vscode.workspace.getConfiguration('optimind-pro').get<T>(key)!;
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────
let _failures = 0;
const FAILURE_THRESHOLD = 3;

function recordSuccess() { _failures = 0; }
function recordFailure() { _failures++; }
function isOpen()        { return _failures >= FAILURE_THRESHOLD; }

// ── AI Client ────────────────────────────────────────────────────────────────
export class AIClient {

    // ── Generate (main entry point) ───────────────────────────────────────────
    static async generate(opts: GenerateOptions): Promise<string> {
        if (isOpen()) {
            const choice = await vscode.window.showWarningMessage(
                `OptiMind: AI engine has failed ${_failures} times. Switch provider?`,
                'Switch to OpenAI', 'Switch to Gemini', 'Keep Trying'
            );
            if (choice === 'Switch to OpenAI') {
                await vscode.workspace.getConfiguration('optimind-pro')
                    .update('provider', 'openai', vscode.ConfigurationTarget.Global);
            } else if (choice === 'Switch to Gemini') {
                await vscode.workspace.getConfiguration('optimind-pro')
                    .update('provider', 'gemini', vscode.ConfigurationTarget.Global);
            }
            // Reset so next call goes through
            _failures = 0;
        }

        const provider = cfg<Provider>('provider');
        try {
            let result: string;
            if (provider === 'ollama')      result = await this._ollama(opts);
            else if (provider === 'openai') result = await this._openai(opts);
            else                           result = await this._gemini(opts);
            recordSuccess();
            return result;
        } catch (err: any) {
            recordFailure();
            let details = err.message;

            if (err.response?.data) {
                if (typeof err.response.data === 'string') {
                    try { details = JSON.parse(err.response.data).error || details; } catch { details = err.response.data; }
                } else if (err.response.data.error && typeof err.response.data.error === 'string') {
                    details = err.response.data.error;
                }
            }
            
            // Helpful hint for local 500s which are almost exclusively context constraints
            if (err.response?.status === 500 && details.includes('500')) {
                details += ' (Likely "Out of Memory" or Context Limit Exceeded on local GPU)';
            }
            
            throw new Error(`[${provider}] ${details}`);
        }
    }

    // ── Health check ──────────────────────────────────────────────────────────
    static async isOllamaOnline(): Promise<boolean> {
        try {
            const url = cfg<string>('ollamaUrl');
            await axios.get(`${url}/api/tags`, { timeout: 3000 });
            return true;
        } catch { return false; }
    }

    // ── List local Ollama models ──────────────────────────────────────────────
    static async getOllamaModels(): Promise<string[]> {
        try {
            const url = cfg<string>('ollamaUrl');
            const res = await axios.get(`${url}/api/tags`, { timeout: 5000 });
            return (res.data?.models ?? []).map((m: any) => m.name as string);
        } catch { return []; }
    }

    // ── Pull a model with progress callback ───────────────────────────────────
    static async pullModel(
        model: string,
        onProgress: (pct: number, status: string) => void
    ): Promise<void> {
        const url  = cfg<string>('ollamaUrl');
        const resp = await axios.post(
            `${url}/api/pull`,
            { name: model, stream: true },
            { responseType: 'stream', timeout: 0 }
        );

        return new Promise((resolve, reject) => {
            let buf = '';
            resp.data.on('data', (chunk: Buffer) => {
                buf += chunk.toString();
                const lines = buf.split('\n');
                buf = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const obj = JSON.parse(line);
                        const pct = obj.total
                            ? Math.round((obj.completed / obj.total) * 100)
                            : 0;
                        onProgress(pct, obj.status ?? '');
                        if (obj.status === 'success') resolve();
                    } catch { /* incomplete JSON */ }
                }
            });
            resp.data.on('end',   resolve);
            resp.data.on('error', reject);
        });
    }

    // ── Ollama provider ───────────────────────────────────────────────────────
    private static async _ollama(opts: GenerateOptions): Promise<string> {
        const url   = cfg<string>('ollamaUrl');
        const model = cfg<string>('defaultModel');

        if (opts.onToken) {
            // Streaming mode
            const resp = await axios.post(
                `${url}/api/generate`,
                { model, prompt: opts.prompt, stream: true, options: { num_ctx: 16000 } },
                { responseType: 'stream', timeout: 120_000 }
            );
            return new Promise((resolve, reject) => {
                let full = '';
                let buf  = '';
                resp.data.on('data', (chunk: Buffer) => {
                    buf += chunk.toString();
                    const lines = buf.split('\n');
                    buf = lines.pop() ?? '';
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const obj = JSON.parse(line);
                            if (obj.response) {
                                full += obj.response;
                                opts.onToken!(obj.response);
                            }
                        } catch { /* incomplete JSON */ }
                    }
                });
                resp.data.on('end',   () => resolve(full));
                resp.data.on('error', reject);
            });
        } else {
            // Non-streaming mode
            const resp = await axios.post(
                `${url}/api/generate`,
                { model, prompt: opts.prompt, stream: false, options: { num_ctx: 16000 } },
                { timeout: 120_000 }
            );
            return resp.data?.response ?? '';
        }
    }

    // ── OpenAI provider ───────────────────────────────────────────────────────
    private static async _openai(opts: GenerateOptions): Promise<string> {
        const key   = await this._getSecret('openai');
        const model = cfg<string>('openaiModel');
        const resp  = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model,
                messages: [
                    { role: 'system', content: 'You are an expert code optimizer. Return raw optimized code only, no explanations.' },
                    { role: 'user',   content: opts.prompt }
                ],
                stream: false
            },
            {
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                timeout: 60_000
            }
        );
        return resp.data?.choices?.[0]?.message?.content ?? '';
    }

    // ── Google Gemini provider ────────────────────────────────────────────────
    private static async _gemini(opts: GenerateOptions): Promise<string> {
        const key   = await this._getSecret('gemini');
        const model = cfg<string>('geminiModel');
        const resp  = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            { contents: [{ parts: [{ text: opts.prompt }] }] },
            { timeout: 60_000 }
        );
        return resp.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }

    // ── Secret storage ────────────────────────────────────────────────────────
    private static _secrets?: vscode.SecretStorage;
    static setSecretStorage(s: vscode.SecretStorage) { this._secrets = s; }

    static async saveSecret(provider: string, key: string): Promise<void> {
        await this._secrets?.store(`optimind-pro.${provider}.apiKey`, key);
    }

    private static async _getSecret(provider: string): Promise<string> {
        const key = await this._secrets?.get(`optimind-pro.${provider}.apiKey`);
        if (!key) throw new Error(`No API key for ${provider}. Run "Set API Key" command.`);
        return key;
    }
}
