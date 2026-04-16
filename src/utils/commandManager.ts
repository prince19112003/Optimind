// ─────────────────────────────────────────────────────────────────────────────
// src/utils/commandManager.ts  –  All Command Registrations + Business Logic
// ─────────────────────────────────────────────────────────────────────────────
import * as vscode from 'vscode';
import { AIClient }         from '../core/aiClient';
import { CodeAnalyzer }     from '../core/analyzer';
import { SystemInfo }       from '../core/systemInfo';
import { DashboardProvider } from '../providers/dashboardProvider';
import { HistoryProvider, HistoryEntry } from '../providers/historyProvider';

import { GhostTextProvider } from '../providers/ghostTextProvider';

export class CommandManager {
    private _analyzer = new CodeAnalyzer();

    constructor(
        private readonly _ctx:       vscode.ExtensionContext,
        private readonly _dashboard: DashboardProvider,
        private readonly _history:   HistoryProvider,
        private readonly _ghostText: GhostTextProvider,
        private readonly _out:       vscode.OutputChannel
    ) {}

    register(): void {
        AIClient.setSecretStorage(this._ctx.secrets);
        this._wireDashboard();
        this._registerCommands();
        this._registerEditorListener();
    }

    // ── Wire dashboard callbacks ───────────────────────────────────────────────
    private _wireDashboard(): void {
        this._dashboard.onReady = async () => {
            this._out.appendLine('[OptiMind] Dashboard ready — refreshing state...');

            const cfg      = vscode.workspace.getConfiguration('optimind-pro');
            const provider = cfg.get<string>('provider') ?? 'ollama';
            this._dashboard.updateProvider(provider);
            this._dashboard.updateSystemInfo(SystemInfo.getSummary());

            if (provider === 'ollama') {
                await this._refreshOllamaState();
            }
        };

        this._dashboard.onMessage = async (msg) => {
            switch (msg.type) {
                case 'analyzeNow':    await vscode.commands.executeCommand('optimind-pro.analyze');      break;
                case 'scanWorkspace': await vscode.commands.executeCommand('optimind-pro.workspaceScan'); break;
                case 'healthCheck':   await vscode.commands.executeCommand('optimind-pro.healthCheck');   break;
                case 'setApiKey':     await vscode.commands.executeCommand('optimind-pro.setApiKey');     break;
                case 'changeProvider': await this._onProviderChange(msg.provider); break;
                case 'changeModel':    await this._onModelChange(msg.model);       break;
                case 'pullModel':      await this._onPullModel(msg.model);         break;
                case 'refreshModels':  await this._refreshOllamaState();           break;
                case 'applyInline':    await this._applyInline();                  break;
            }
        };
    }

    // ── Register all VS Code commands ─────────────────────────────────────────
    private _registerCommands(): void {
        const reg = (id: string, fn: () => Promise<void>) =>
            this._ctx.subscriptions.push(
                vscode.commands.registerCommand(id, async () => {
                    try { await fn(); }
                    catch (e: any) {
                        this._out.appendLine(`[OptiMind ERROR] ${e.message}`);
                        vscode.window.showErrorMessage(`OptiMind: ${e.message}`);
                        this._dashboard.showError(e.message);
                        this._dashboard.setLoading(false);
                    }
                })
            );

        reg('optimind-pro.analyze',       () => this._cmdAnalyze());
        reg('optimind-pro.healthCheck',   () => this._cmdHealthCheck());
        reg('optimind-pro.generateTests', () => this._cmdGenerateTests());
        reg('optimind-pro.workspaceScan', () => this._cmdWorkspaceScan());
        reg('optimind-pro.securityAudit', () => this._cmdSecurityAudit());
        reg('optimind-pro.setApiKey',     () => this._cmdSetApiKey());
        reg('optimind-pro.applyLast',     () => this._cmdApplyLast());

        this._ctx.subscriptions.push(
            vscode.commands.registerCommand('optimind-pro.showDiff', (entry: HistoryEntry) => {
                this._showDiff(entry);
            }),
            vscode.commands.registerCommand('optimind-pro.clearHistory', () => {
                this._history.clear();
            }),
            vscode.commands.registerCommand('optimind-pro.applyHistory', async (item: import('../providers/historyProvider').HistoryItem) => {
                if (!item || !item.entry) return;
                
                // Find matching active editor if possible, or any visible editor
                const editors = vscode.window.visibleTextEditors;
                let targetEditor = editors.find(e => e.document.fileName.endsWith(item.entry.fileName));
                
                if (!targetEditor) {
                    targetEditor = vscode.window.activeTextEditor;
                }
                
                if (!targetEditor) {
                    vscode.window.showWarningMessage('OptiMind: Open the original file to apply this code.');
                    return;
                }
                
                await this._applyEntry(item.entry, targetEditor);
            })
        );
    }

    // ── Editor change listener (updates health score) ──────────────────────────
    private _registerEditorListener(): void {
        const update = (editor?: vscode.TextEditor) => {
            if (!editor || !this._analyzer.isCodeFile(editor.document)) return;
            const scoreData = this._analyzer.calculateScore(
                editor.document.getText(),
                editor.document.languageId
            );
            this._dashboard.setScore(scoreData.score, scoreData.details);
        };

        this._ctx.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(update),
            vscode.workspace.onDidSaveTextDocument(doc => {
                if (vscode.window.activeTextEditor?.document === doc) {
                    update(vscode.window.activeTextEditor);
                }
            })
        );

        // Run immediately for the currently open file
        update(vscode.window.activeTextEditor);
    }

    // ── Command implementations ────────────────────────────────────────────────

    private _lastOptimized?: { entry: HistoryEntry; document: vscode.TextDocument };

    private async _applyInline(): Promise<void> {
        if (!this._lastOptimized) {
            vscode.window.showErrorMessage('OptiMind: No recent optimization available to apply.');
            return;
        }

        const targetUri = this._lastOptimized.document.uri.toString();
        let editor = vscode.window.activeTextEditor;
        
        // When clicking dashboard, the active editor might lose focus. Search visible editors.
        if (!editor || editor.document.uri.toString() !== targetUri) {
            editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === targetUri);
        }

        if (!editor) {
            vscode.window.showErrorMessage('OptiMind: Please keep the original file open and visible to apply code.');
            return;
        }
        await this._applyEntry(this._lastOptimized.entry, editor);
    }

    private async _cmdAnalyze(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) throw new Error('No active editor.');

        const selection = editor.selection;
        if (selection.isEmpty) throw new Error('Select code to optimize first.');

        const code = editor.document.getText(selection);
        const lang = editor.document.languageId;

        this._dashboard.setLoading(true);
        this._dashboard.startStream();
        this._out.appendLine(`[OptiMind] Analyzing ${code.length} chars of ${lang}...`);

        const fullFile = editor.document.getText();
        const result = await this._analyzer.optimize(code, lang, fullFile, (token) => {
            this._dashboard.streamToken(token);
        });

        this._dashboard.setLoading(false);

        if (result.optimized.trim() === code.trim() || result.explanation.toLowerCase().includes('already optimized')) {
            vscode.window.showInformationMessage('OptiMind: Code is already optimal and highly readable!');
            return;
        }

        // Store last result for Apply command
        const entry: HistoryEntry = {
            timestamp:   new Date().toLocaleTimeString(),
            fileName:    editor.document.fileName.split(/[\\/]/).pop() ?? 'unknown',
            language:    lang,
            oldCode:     code,
            newCode:     result.optimized,
            improvement: result.improvement || result.explanation.slice(0, 40),
            range:       selection
        };
        this._lastOptimized = { entry, document: editor.document };
        this._history.add(entry);

        // update score with details
        const res = this._analyzer.calculateScore(result.optimized, lang);
        this._dashboard.setScore(res.score, res.details);

        // Project Inline Ghost Text (Copilot Style)
        await this._ghostText.setAndTrigger(editor.document, selection, result.optimized);

        vscode.window.showInformationMessage(
            `OptiMind ⚡ ${result.improvement || result.explanation}`,
            'Apply'
        ).then(action => { if (action === 'Apply') this._applyEntry(entry, editor); });
    }

    private async _cmdHealthCheck(): Promise<void> {
        const online = await AIClient.isOllamaOnline();
        this._dashboard.setEngineStatus(online);
        if (online) {
            vscode.window.showInformationMessage('OptiMind: 🟢 Ollama is online!');
        } else {
            vscode.window.showWarningMessage('OptiMind: 🔴 Ollama offline. Run `ollama serve` in a terminal.');
        }
    }

    private async _cmdGenerateTests(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) throw new Error('No active editor.');

        const code = editor.selection.isEmpty
            ? editor.document.getText()
            : editor.document.getText(editor.selection);
        const lang = editor.document.languageId;

        this._dashboard.setLoading(true);
        const tests = await this._analyzer.generateTests(code, lang);
        this._dashboard.setLoading(false);

        const doc = await vscode.workspace.openTextDocument({ language: lang, content: tests });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
    }

    private async _cmdSecurityAudit(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) throw new Error('No active editor.');

        const code = editor.selection.isEmpty
            ? editor.document.getText()
            : editor.document.getText(editor.selection);
        const lang = editor.document.languageId;

        this._dashboard.setLoading(true);
        const result = await this._analyzer.securityAudit(code, lang);
        this._dashboard.setLoading(false);

        // Show results in a webview panel
        const panel = vscode.window.createWebviewPanel(
            'optimind-security', '🔐 Security Audit', vscode.ViewColumn.Beside,
            { enableScripts: false }
        );
        panel.webview.html = this._buildSecurityReport(result);
    }

    private async _cmdWorkspaceScan(): Promise<void> {
        const files = await vscode.workspace.findFiles(
            '**/*.{ts,js,py,cpp,c,java}',
            '**/node_modules/**',
            100
        );
        if (!files.length) {
            vscode.window.showInformationMessage('OptiMind: No supported files found in workspace.');
            return;
        }

        vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'OptiMind: Scanning workspace...', cancellable: true },
            async (_progress, token) => {
                let scanned = 0;
                for (const file of files) {
                    if (token.isCancellationRequested) break;
                    const doc   = await vscode.workspace.openTextDocument(file);
                    const score = this._analyzer.calculateScore(doc.getText(), doc.languageId);
                    this._out.appendLine(`[Scan] ${file.fsPath.split(/[\\/]/).pop()} → score ${score}`);
                    scanned++;
                }
                vscode.window.showInformationMessage(`OptiMind: Scanned ${scanned} files. Check Output → OptiMind Pro.`);
            }
        );
    }

    private async _cmdSetApiKey(): Promise<void> {
        const provider = await vscode.window.showQuickPick(['openai', 'gemini'], {
            placeHolder: 'Choose provider to set key for'
        });
        if (!provider) return;

        const key = await vscode.window.showInputBox({
            prompt:     `Enter your ${provider === 'openai' ? 'OpenAI' : 'Google Gemini'} API key`,
            password:   true,
            ignoreFocusOut: true
        });
        if (!key) return;

        await AIClient.saveSecret(provider, key);
        await vscode.workspace.getConfiguration('optimind-pro')
            .update('provider', provider, vscode.ConfigurationTarget.Global);
        this._dashboard.updateProvider(provider);
        vscode.window.showInformationMessage(`OptiMind: 🔑 ${provider} key saved securely.`);
    }

    private async _cmdApplyLast(): Promise<void> {
        if (!this._lastOptimized) {
            vscode.window.showWarningMessage('OptiMind: No optimization to apply yet.');
            return;
        }
        const { entry, document } = this._lastOptimized;
        const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
        if (!editor) { vscode.window.showWarningMessage('OptiMind: Original file is no longer open.'); return; }
        await this._applyEntry(entry, editor);
    }

    // ── Provider/model change ─────────────────────────────────────────────────

    private async _onProviderChange(provider: string): Promise<void> {
        await vscode.workspace.getConfiguration('optimind-pro')
            .update('provider', provider, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`OptiMind: Provider → ${provider}`);
        if (provider === 'ollama') await this._refreshOllamaState();
    }

    private async _onModelChange(model: string): Promise<void> {
        await vscode.workspace.getConfiguration('optimind-pro')
            .update('defaultModel', model, vscode.ConfigurationTarget.Global);
    }

    private async _onPullModel(modelName: string): Promise<void> {
        try {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `OptiMind: Pulling "${modelName}"...`, cancellable: false },
                async (progress) => {
                    await AIClient.pullModel(modelName, (pct, status) => {
                        progress.report({ increment: pct, message: `${status} (${pct}%)` });
                    });
                }
            );
            await vscode.workspace.getConfiguration('optimind-pro')
                .update('defaultModel', modelName, vscode.ConfigurationTarget.Global);
            await this._refreshOllamaState();
            this._dashboard.notifyPullComplete();
            vscode.window.showInformationMessage(`OptiMind: ✅ "${modelName}" pulled & set as active.`);
        } catch (e: any) {
            this._dashboard.notifyPullError(e.message);
            throw e;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async _refreshOllamaState(): Promise<void> {
        const [online, models] = await Promise.all([
            AIClient.isOllamaOnline(),
            AIClient.getOllamaModels()
        ]);
        this._dashboard.setEngineStatus(online);
        const profile = SystemInfo.getProfile();
        const { safe } = SystemInfo.categorizePulledModels(models);

        // Convert exported MODEL_TIERS to a dictionary for the UI
        const allTiers: Record<string, {title: string, desc: string}> = {};
        for (const [m, t] of Object.entries(SystemInfo.getTiers())) {
            allTiers[m] = { title: t.title, desc: t.desc };
        }

        const activeModel = vscode.workspace.getConfiguration('optimind-pro').get<string>('defaultModel') || profile.recommendedModel;

        this._dashboard.updateModels(models, profile.recommendedModel, safe, allTiers, activeModel);
    }

    private async _showDiff(entry: HistoryEntry): Promise<void> {
        const oldUri = vscode.Uri.parse(`untitled:Original_${entry.fileName}`);
        const newUri = vscode.Uri.parse(`untitled:Optimized_${entry.fileName}`);

        const [oldDoc, newDoc] = await Promise.all([
            vscode.workspace.openTextDocument(oldUri.with({ scheme: 'untitled' })),
            vscode.workspace.openTextDocument(newUri.with({ scheme: 'untitled' }))
        ]);

        await vscode.window.showTextDocument(oldDoc, { preview: false, viewColumn: vscode.ViewColumn.One });
        const editOld = new vscode.WorkspaceEdit();
        editOld.insert(oldUri, new vscode.Position(0, 0), entry.oldCode);

        await vscode.window.showTextDocument(newDoc, { preview: false, viewColumn: vscode.ViewColumn.Two });
        const editNew = new vscode.WorkspaceEdit();
        editNew.insert(newUri, new vscode.Position(0, 0), entry.newCode);

        await Promise.all([
            vscode.workspace.applyEdit(editOld),
            vscode.workspace.applyEdit(editNew)
        ]);

        await vscode.commands.executeCommand('vscode.diff', oldUri, newUri,
            `OptiMind: ${entry.fileName} — ${entry.improvement}`);
    }

    private async _applyEntry(entry: HistoryEntry, editor: vscode.TextEditor): Promise<void> {
        let replaceRange: vscode.Range | undefined;
        const currentTextAtRange = Math.min(entry.range.end.line, editor.document.lineCount - 1) >= entry.range.start.line
                                   ? editor.document.getText(entry.range) : '';

        // 1. Precise match: Use saved range if the text hasn't been edited
        if (currentTextAtRange === entry.oldCode) {
            replaceRange = entry.range;
        } else {
            // 2. Fallback: Search the document if lines shifted
            const fullText = editor.document.getText();
            const idx      = fullText.indexOf(entry.oldCode);
            if (idx !== -1) {
                const start  = editor.document.positionAt(idx);
                const end    = editor.document.positionAt(idx + entry.oldCode.length);
                replaceRange = new vscode.Selection(start, end);
            }
        }

        if (!replaceRange) {
            vscode.window.showWarningMessage('OptiMind: Original code has been modified too heavily. Cannot safely auto-replace.');
            return;
        }

        await editor.edit(eb => eb.replace(replaceRange!, entry.newCode));
        vscode.window.showInformationMessage('OptiMind: ✅ Optimization applied!');
    }

    private _buildSecurityReport(result: import('../core/analyzer').SecurityAuditResult): string {
        const severityColor = (s: string) =>
            s === 'critical' ? '#f48771' : s === 'high' ? '#cca700' : s === 'medium' ? '#89d185' : '#999';

        const rows = result.findings.map(f => `
            <div style="border:1px solid #333; border-radius:6px; padding:10px; margin-bottom:10px;">
                <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
                    <span style="background:${severityColor(f.severity)}; color:#111; font-weight:700;
                          padding:2px 8px; border-radius:4px; font-size:11px; text-transform:uppercase;">
                        ${f.severity}
                    </span>
                    <strong>${f.category}</strong>
                    <span style="color:#666; font-size:11px; margin-left:auto;">Line ${f.line}</span>
                </div>
                <p style="margin-bottom:4px; font-size:12px;">${f.description}</p>
                <p style="font-size:11px; color:#89d185;">💡 Fix: ${f.fix}</p>
            </div>`).join('');

        return `<!DOCTYPE html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  body { font-family: -apple-system, 'Segoe UI', sans-serif; padding: 20px; color: #ccc; background: #1e1e1e; }
  h1 { font-size: 18px; margin-bottom: 6px; }
  .summary { color: #89d185; margin-bottom: 16px; font-size: 13px; }
  .empty { color: #666; font-style: italic; }
</style>
</head><body>
<h1>🔐 Security Audit Report</h1>
<div class="summary">${result.summary}</div>
${rows || '<div class="empty">No vulnerabilities detected. ✅</div>'}
</body></html>`;
    }
}
