// ─────────────────────────────────────────────────────────────────────────────
// src/core/systemInfo.ts  –  Hardware-Aware Model Recommendations
// ─────────────────────────────────────────────────────────────────────────────
import * as os from 'os';

export interface HardwareProfile {
    ramGb:          number;
    recommendedModel: string;
    tier:           'ultra-light' | 'balanced' | 'high' | 'enterprise';
}

export const MODEL_TIERS: Record<string, { minRam: number; title: string, desc: string }> = {
    'deepseek-coder:1.3b':   { minRam: 4,  title: 'Fast & Light (4GB)', desc: 'Best for old PCs' },
    'qwen2.5-coder:7b':      { minRam: 8,  title: 'Balanced (8GB) Recommended', desc: 'Smart & fast for daily use' },
    'deepseek-coder:6.7b':   { minRam: 16, title: 'High Logic (16GB)', desc: 'Deep context analysis' },
    'deepseek-coder-v2':     { minRam: 32, title: 'Enterprise (32GB)', desc: 'Maximum intelligence' },
};

export class SystemInfo {
    static getTiers(): Record<string, { minRam: number; title: string, desc: string }> {
        return MODEL_TIERS;
    }

    static getProfile(): HardwareProfile {
        const ramGb = Math.floor(os.totalmem() / 1024 / 1024 / 1024);

        let recommendedModel = 'deepseek-coder:1.3b';
        let tier: HardwareProfile['tier'] = 'ultra-light';

        if (ramGb >= 32) { recommendedModel = 'deepseek-coder-v2';   tier = 'enterprise'; }
        else if (ramGb >= 16) { recommendedModel = 'deepseek-coder:6.7b'; tier = 'high'; }
        else if (ramGb >= 8)  { recommendedModel = 'qwen2.5-coder:7b';    tier = 'balanced'; }

        return { ramGb, recommendedModel, tier };
    }

    static getSummary(): string {
        const p = this.getProfile();
        return `${p.ramGb} GB RAM · ${p.tier} tier · Recommended: ${p.recommendedModel}`;
    }

    /** Split pulled models into safe (fits RAM) and risky (exceeds RAM) */
    static categorizePulledModels(models: string[]): { safe: string[]; risky: string[] } {
        const { ramGb } = this.getProfile();
        const safe:  string[] = [];
        const risky: string[] = [];
        for (const m of models) {
            const tier = MODEL_TIERS[m];
            if (!tier || tier.minRam <= ramGb) safe.push(m);
            else                               risky.push(m);
        }
        return { safe, risky };
    }
}
