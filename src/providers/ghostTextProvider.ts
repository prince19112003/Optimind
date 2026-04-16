// ─────────────────────────────────────────────────────────────────────────────
// src/providers/ghostTextProvider.ts  –  Advanced Inline Suggestions (Copilot style)
// Projects optimized code directly into the editor as gray ghost text.
// ─────────────────────────────────────────────────────────────────────────────
import * as vscode from 'vscode';

export class GhostTextProvider implements vscode.InlineCompletionItemProvider {
    private _pendingGhostText?: {
        documentUri: string;
        range: vscode.Range;
        newText: string;
    };

    /**
     * Statically set the ghost text memory buffer and trigger VS Code to render it.
     */
    async setAndTrigger(document: vscode.TextDocument, range: vscode.Range, newText: string): Promise<void> {
        this._pendingGhostText = {
            documentUri: document.uri.toString(),
            range,
            newText
        };
        // Force VS Code to poll the InlineCompletionItemProvider
        await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        _position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null | undefined> {
        
        // If no pending ghost text, exit silently.
        if (!this._pendingGhostText) return null;

        // Ensure we are in the correct document
        if (document.uri.toString() !== this._pendingGhostText.documentUri) return null;

        // If the cursor is anywhere near the range we optimized, show the text.
        // We replace the original range with the new text.
        const item = new vscode.InlineCompletionItem(
            this._pendingGhostText.newText,
            this._pendingGhostText.range
        );

        // Clear the buffer so it doesn't linger permanently if they move away
        const oldPending = this._pendingGhostText;
        setTimeout(() => {
            if (this._pendingGhostText === oldPending) {
                this._pendingGhostText = undefined;
            }
        }, 30000); // Expires after 30s

        return [item];
    }
}
