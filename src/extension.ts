// ─────────────────────────────────────────────────────────────────────────────
// src/extension.ts  –  Extension Entry Point
// ─────────────────────────────────────────────────────────────────────────────
import * as vscode from 'vscode';
import { DashboardProvider }  from './providers/dashboardProvider';
import { HistoryProvider }    from './providers/historyProvider';
import { GhostTextProvider }  from './providers/ghostTextProvider';
import { CommandManager }     from './utils/commandManager';

export function activate(context: vscode.ExtensionContext) {
    const out = vscode.window.createOutputChannel('OptiMind Pro');
    out.appendLine('[OptiMind Pro] Activated ✅');

    // 1. Native History Tree View (rock-solid, never blank)
    const historyProvider = new HistoryProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('optimind-pro.history', historyProvider)
    );

    // 2. Minimalist Dashboard Webview (just Health Ring + Provider selector)
    const dashboardProvider = new DashboardProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'optimind-pro.dashboard',
            dashboardProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // 3. Inline Ghost Text engine
    const ghostTextProvider = new GhostTextProvider();
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            [{ pattern: '**' }],
            ghostTextProvider
        )
    );

    // 4. Wire all commands
    const cmdManager = new CommandManager(context, dashboardProvider, historyProvider, ghostTextProvider, out);
    cmdManager.register();

    out.appendLine('[OptiMind Pro] All providers registered.');
}

export function deactivate() {}
