// ─────────────────────────────────────────────────────────────────────────────
// src/providers/historyProvider.ts  –  Native Tree View for Optimization History
// This uses VS Code's built-in TreeView API — GUARANTEED to render, no JS/CSP issues.
// ─────────────────────────────────────────────────────────────────────────────
import * as vscode from 'vscode';

export interface HistoryEntry {
    timestamp:   string;
    fileName:    string;
    language:    string;
    oldCode:     string;
    newCode:     string;
    improvement: string;
    range:       vscode.Range; // Store absolute coordinates to fix indexOf whitespace bugs
}

export class HistoryItem extends vscode.TreeItem {
    constructor(
        public readonly entry: HistoryEntry,
        public readonly index: number
    ) {
        super(entry.fileName, vscode.TreeItemCollapsibleState.None);
        this.description  = entry.improvement || entry.timestamp;
        this.tooltip      = `Optimized at ${entry.timestamp}\nImprovement: ${entry.improvement}`;
        this.iconPath     = new vscode.ThemeIcon('history');
        this.contextValue = 'historyItem';
        this.command      = {
            command:   'optimind-pro.showDiff',
            title:     'View Diff',
            arguments: [entry]
        };
    }
}

export class HistoryProvider implements vscode.TreeDataProvider<HistoryItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _history: HistoryEntry[] = [];

    getTreeItem(element: HistoryItem): vscode.TreeItem { return element; }

    getChildren(): HistoryItem[] {
        if (this._history.length === 0) {
            // Return a placeholder node when empty
            const empty = new vscode.TreeItem('No optimizations yet.');
            empty.iconPath  = new vscode.ThemeIcon('info');
            empty.tooltip   = 'Select code and run ⚡ Analyze & Optimize.';
            // Cast is safe — we just need it shown
            return [empty as unknown as HistoryItem];
        }
        return [...this._history]
            .reverse()
            .map((e, i) => new HistoryItem(e, i));
    }

    add(entry: HistoryEntry): void {
        this._history.push(entry);
        if (this._history.length > 50) { this._history.shift(); } // cap at 50
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this._history = [];
        this._onDidChangeTreeData.fire();
    }

    getAll(): HistoryEntry[] { return this._history; }
}
