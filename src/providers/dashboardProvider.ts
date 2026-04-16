// ─────────────────────────────────────────────────────────────────────────────
// src/providers/dashboardProvider.ts  –  Minimalist Webview Dashboard
// KEY DESIGN DECISIONS:
//   1. style-src uses 'unsafe-inline' — required for element.style.X to work
//   2. NO external resources — everything is inline, no font-src needed
//   3. JS script is minimal — only updates the ring and handles postMessage
//   4. retainContextWhenHidden=true — panel stays loaded when switching tabs
// ─────────────────────────────────────────────────────────────────────────────
import * as vscode from 'vscode';

export type DashboardMessage =
    | { type: 'changeProvider'; provider: string }
    | { type: 'changeModel';    model: string }
    | { type: 'pullModel';      model: string }
    | { type: 'setApiKey' }
    | { type: 'analyzeNow' }
    | { type: 'scanWorkspace' }
    | { type: 'healthCheck' }
    | { type: 'refreshModels' }
    | { type: 'applyInline' };

export class DashboardProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'optimind-pro.dashboard';
    private _view?: vscode.WebviewView;

    // ── Callbacks wired by CommandManager ────────────────────────────────────
    public onMessage?:      (msg: DashboardMessage) => void;
    public onReady?:        () => void;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _ctx: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._buildHtml();

        // Forward all messages from webview to the extension backend
        webviewView.webview.onDidReceiveMessage((msg: DashboardMessage) => {
            this.onMessage?.(msg);
        });

        // Give the DOM ~300ms to fully parse before pushing initial state
        setTimeout(() => this.onReady?.(), 300);
    }

    // ── Public API (called by CommandManager) ─────────────────────────────────

    public setScore(score: number, details: string[] = []): void {
        this._post({ type: 'setScore', score, details });
    }

    public setEngineStatus(online: boolean): void {
        this._post({ type: 'engineStatus', online });
    }

    public setLoading(active: boolean): void {
        this._post({ type: 'setLoading', active });
    }

    public startStream(): void {
        this._post({ type: 'startStream' });
    }

    public streamToken(token: string): void {
        this._post({ type: 'streamToken', token });
    }

    public showError(msg: string): void {
        this._post({ type: 'showError', msg });
    }

    public updateModels(models: string[], recommended: string, safe: string[], allTiers: Record<string, {title: string, desc: string}>, activeModel: string): void {
        this._post({ type: 'updateModels', models, recommended, safe, allTiers, activeModel });
    }

    public updateProvider(provider: string): void {
        this._post({ type: 'updateProvider', provider });
    }

    public updateSystemInfo(info: string): void {
        this._post({ type: 'systemInfo', info });
    }

    public notifyPullComplete(): void {
        this._post({ type: 'pullComplete' });
    }

    public notifyPullError(msg: string): void {
        this._post({ type: 'pullError', msg });
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private _post(data: object): void {
        this._view?.webview.postMessage(data);
    }

    private _buildHtml(): string {
        // No nonce needed for inline styles since we use unsafe-inline.
        // Script still uses a nonce for extra security.
        const scriptNonce = Math.random().toString(36).substring(2) + Date.now().toString(36);

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}';">
<title>OptiMind Pro</title>
<style>
/* ── Reset ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: var(--vscode-font-family, -apple-system, 'Segoe UI', sans-serif);
    font-size: 12px;
    color: var(--vscode-foreground);
    background: transparent;
    padding: 8px 10px 20px;
    overflow-x: hidden;
}

/* ── Section title ── */
.section-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
    margin: 14px 0 7px;
    display: flex;
    align-items: center;
    gap: 5px;
}

/* ── Engine dot ── */
.dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: #89d185;
    box-shadow: 0 0 5px #89d185;
    flex-shrink: 0;
    transition: background 0.4s, box-shadow 0.4s;
}
.dot.offline { background: #f48771; box-shadow: 0 0 5px #f48771; }

/* ── Health card ── */
.health-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 12px;
    background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.04));
    border: 1px solid var(--vscode-widget-border, #333);
    border-radius: 7px;
}
.ring-svg { flex-shrink: 0; }
.ring-bg { fill: none; stroke: var(--vscode-widget-border, #333); stroke-width: 5; }
.ring-fg {
    fill: none;
    stroke: #89d185;
    stroke-width: 5;
    stroke-linecap: round;
    transform-origin: center;
    transform: rotate(-90deg);
    transition: stroke-dashoffset 0.6s cubic-bezier(.4,0,.2,1), stroke 0.4s;
}
.score-value {
    font-size: 24px;
    font-weight: 800;
    color: #89d185;
    line-height: 1;
    transition: color 0.4s;
}
.score-label { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 3px; }

/* ── System info ── */
.sysinfo {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    margin-top: 4px;
    font-style: italic;
}

/* ── Divider ── */
hr { border: none; border-top: 1px solid var(--vscode-widget-border, #333); margin: 10px 0; }

/* ── Buttons ── */
.btn {
    display: block;
    width: 100%;
    padding: 8px 12px;
    margin-bottom: 8px;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
    text-align: left;
    transition: opacity 0.15s;
}
.btn:hover { opacity: 0.82; }
.btn-primary {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    font-weight: 700;
}
.btn-secondary {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #ccc);
}

/* ── Provider row ── */
.row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 5px;
}
.row-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    min-width: 46px;
    flex-shrink: 0;
}
select, input[type="text"] {
    flex: 1;
    background: var(--vscode-input-background, #3c3c3c);
    color: var(--vscode-input-foreground, #ccc);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 11px;
    font-family: inherit;
    min-width: 0;
}
select:focus, input[type="text"]:focus {
    outline: 1px solid var(--vscode-focusBorder, #007acc);
}
.btn-pull {
    padding: 4px 8px;
    border-radius: 4px;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    border: none;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
}
.btn-pull:hover { opacity: 0.82; }
.btn-pull:disabled { opacity: 0.4; cursor: not-allowed; }

.model-hint { font-size: 10px; color: var(--vscode-descriptionForeground); font-style: italic; margin-top: 2px; }

/* ── Model Cards ── */
.model-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 6px;
    margin-bottom: 12px;
}
.m-card {
    border: 1px solid var(--vscode-widget-border, #333);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.04));
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    flex-direction: column;
    gap: 3px;
    position: relative;
    overflow: hidden;
}
.m-card:hover { border-color: var(--vscode-focusBorder, #007acc); }
.m-card.active { border-color: #89d185; background: rgba(137, 209, 133, 0.08); }
.m-card.pulling { opacity: 0.6; pointer-events: none; }
.m-card.pulling::after {
    content: ""; position: absolute; bottom: 0; left: 0; height: 2px;
    background: var(--vscode-focusBorder, #007acc);
    animation: progress 1.5s infinite linear;
}
@keyframes progress { 0% { width: 0%; } 100% { width: 100%; } }
.m-head { display: flex; justify-content: space-between; align-items: center; }
.m-title { font-weight: 700; font-size: 11px; color: var(--vscode-foreground); }
.m-tag { font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px; }
.tag-inst { background: rgba(137,209,133,0.15); color: #89d185; }
.tag-pull { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); }
.m-desc { font-size: 10px; color: var(--vscode-descriptionForeground); font-style: italic; }

/* ── Key button ── */
.btn-key {
    width: 100%;
    padding: 5px 8px;
    border: 1px dashed var(--vscode-focusBorder, #007acc);
    border-radius: 5px;
    background: transparent;
    color: var(--vscode-foreground);
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s;
}
.btn-key:hover { background: var(--vscode-button-secondaryBackground, #3a3d41); }

/* ── Loading overlay ── */
#loading-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: var(--vscode-editor-background, #1e1e1e);
    opacity: 0.85;
    z-index: 99;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
}
#loading-overlay.active { display: flex; }
.spinner {
    width: 22px; height: 22px;
    border: 3px solid transparent;
    border-top-color: var(--vscode-button-background, #0e639c);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Error banner ── */
#err {
    display: none;
    background: rgba(200,55,55,.12);
    border: 1px solid rgba(200,55,55,.4);
    border-radius: 5px;
    padding: 6px 9px;
    font-size: 11px;
    color: #f48771;
    margin-bottom: 8px;
    gap: 6px;
    align-items: flex-start;
}
#err.active { display: flex; }
#err-close { cursor: pointer; margin-left: auto; }
</style>
</head>
<body>

<!-- ── Loading Overlay ─────────────────────────────────────────────────── -->
<div id="loading-overlay">
    <div class="spinner"></div>
    <span style="font-size:11px; color:var(--vscode-descriptionForeground);">Parsing context...</span>
</div>

<!-- ── Streaming Output ────────────────────────────────────────────────── -->
<div id="stream-container" style="display:none; margin-bottom: 15px;">
    <div style="font-size:11px; font-weight:700; margin-bottom: 6px; color:var(--vscode-descriptionForeground);">Live Optimization Stream</div>
    
    <div style="background: var(--vscode-editor-inactiveSelectionBackground); border: 1px solid var(--vscode-widget-border); border-radius: 6px; overflow: hidden; margin-bottom: 8px;">
        <div id="stream-desc" style="padding: 10px; font-size: 11px; color: var(--vscode-foreground); border-bottom: 1px solid var(--vscode-widget-border); line-height: 1.4;">
            <!-- Descriptions land here -->
        </div>
        <pre id="stream-code" style="padding: 10px; font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; color: #9cdcfe; margin:0; white-space: pre-wrap; word-wrap: break-word; overflow-y: auto; max-height: 250px; line-height: 1.4; background: rgba(0,0,0,0.2);">
        </pre>
    </div>
    
    <button class="btn btn-primary" id="btn-apply-inline" style="margin-top: 8px; font-weight: bold; text-align: center;">✅ Apply Code to Editor</button>
</div>

<!-- ── Error Banner ────────────────────────────────────────────────────── -->
<div id="err">
    <span id="err-text">Error occurred.</span>
    <span id="err-close" title="Dismiss">✕</span>
</div>

<!-- ── Code Health ─────────────────────────────────────────────────────── -->
<div class="section-title">
    Code Health
    <span class="dot" id="dot" title="Engine status"></span>
</div>

<div class="health-card">
    <svg class="ring-svg" width="52" height="52" viewBox="0 0 52 52">
        <circle class="ring-bg" cx="26" cy="26" r="21"/>
        <circle class="ring-fg" id="ring-fg" cx="26" cy="26" r="21"/>
    </svg>
    <div style="flex:1;">
        <div class="score-value" id="score-val">100%</div>
        <div class="score-label">Active file quality</div>
        <div class="sysinfo" id="sysinfo"></div>
    </div>
</div>
<div id="health-details" style="margin-top:8px; display:flex; flex-direction:column; gap:4px;">
    <!-- Populated by JS -->
</div>

<hr>

<!-- ── Actions ─────────────────────────────────────────────────────────── -->
<div class="section-title">Actions</div>
<button class="btn btn-primary"   id="btn-analyze">⚡ Optimize Selected Code</button>
<button class="btn btn-secondary" id="btn-scan">🔍 Scan Workspace for Debt</button>
<button class="btn btn-secondary" id="btn-health">🩺 Check Engine Status</button>

<hr>

<!-- ── AI Provider ──────────────────────────────────────────────────────── -->
<div class="section-title">AI Provider</div>

<div class="row">
    <span class="row-label">Provider</span>
    <select id="sel-provider">
        <option value="ollama">🖥️ Ollama (Local)</option>
        <option value="openai">🌐 OpenAI</option>
        <option value="gemini">✨ Gemini</option>
    </select>
</div>

<!-- Ollama model section (shown only for Ollama) -->
<details id="ollama-section" style="background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.02)); border: 1px solid var(--vscode-widget-border, #333); border-radius: 6px; padding: 6px 10px; margin-top: 5px; margin-bottom: 15px;">
    <summary style="cursor: pointer; font-size: 11px; font-weight: 700; padding: 4px 0; outline: none; list-style: none; display: flex; align-items: center; justify-content: space-between;">
        <span>🤖 Local Model Configuration</span>
        <span style="font-size: 10px; opacity: 0.5;">Click to toggle</span>
    </summary>
    <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--vscode-widget-border, #333);">
        <div class="row" style="justify-content: space-between; margin-bottom: 2px;">
            <span class="row-label">Highly Accurate Models</span>
            <span id="btn-refresh-models" title="Refresh install status" style="cursor:pointer; font-size:10px;">🔄 Sync</span>
        </div>
        
        <div id="model-grid" class="model-grid">
            <!-- Populated by JS -->
        </div>

        <div class="row" style="margin-top: 10px;">
            <input type="text" id="inp-custom" placeholder="Custom model e.g. codellama:7b" />
            <button class="btn-pull" id="btn-pull">⬇️ Pull</button>
        </div>
    </div>
</details>

<!-- Cloud API key section (shown only for cloud providers) -->
<div id="cloud-section" style="display:none;">
    <button class="btn-key" id="btn-apikey">🔑 Set API Key (Secure Vault)</button>
</div>

<script nonce="${scriptNonce}">
(function () {
    'use strict';

    // ── VS Code API (must be called exactly once) ──────────────────────────
    const vscode = acquireVsCodeApi();

    // ── Ring constants ─────────────────────────────────────────────────────
    const RADIUS = 21;
    const CIRC = 2 * Math.PI * RADIUS;
    const ringFg = document.getElementById('ring-fg');
    ringFg.style.strokeDasharray  = CIRC + ' ' + CIRC;
    ringFg.style.strokeDashoffset = '0';

    // ── Helper functions ───────────────────────────────────────────────────
    function setScore(pct) {
        const offset = CIRC - (pct / 100) * CIRC;
        ringFg.style.strokeDashoffset = String(offset);
        const el = document.getElementById('score-val');
        if (el) el.textContent = pct + '%';
        const c = pct > 75 ? '#89d185' : pct > 45 ? '#cca700' : '#f48771';
        ringFg.style.stroke = c;
        if (el) el.style.color = c;
    }

    function setEngineStatus(online) {
        const dot = document.getElementById('dot');
        if (!dot) return;
        if (online) {
            dot.className = 'dot';
            dot.title = 'Engine online';
        } else {
            dot.className = 'dot offline';
            dot.title = 'Engine offline — start Ollama';
        }
    }

    function showError(msg) {
        const el = document.getElementById('err');
        const tx = document.getElementById('err-text');
        if (el && tx) { tx.textContent = msg; el.classList.add('active'); }
    }

    function hideError() {
        const el = document.getElementById('err');
        if (el) el.classList.remove('active');
    }

    function setLoading(active) {
        const el = document.getElementById('loading-overlay');
        if (el) {
            if (active) el.classList.add('active');
            else        el.classList.remove('active');
        }
    }

    function setProvider(p) {
        document.getElementById('sel-provider').value = p;
        const ol = document.getElementById('ollama-section');
        const cl = document.getElementById('cloud-section');
        if (p === 'ollama') {
            ol.style.display = 'block';
            cl.style.display = 'none';
        } else {
            ol.style.display = 'none';
            cl.style.display = 'block';
        }
    }

    // ── Button listeners ───────────────────────────────────────────────────
    function post(type, extra) {
        hideError();
        vscode.postMessage(Object.assign({ type: type }, extra || {}));
    }

    function bindClick(id, fn) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    }

    bindClick('btn-analyze', function () { post('analyzeNow'); });
    bindClick('btn-scan',    function () { post('scanWorkspace'); });
    bindClick('btn-health',  function () { post('healthCheck'); });
    bindClick('btn-apikey',  function () { post('setApiKey'); });

    // New Apply Button
    const applyBtn = document.getElementById('btn-apply-inline');
    if (applyBtn) {
        applyBtn.addEventListener('click', function () {
            post('applyInline');
            this.textContent = '✅ Applied!';
            setTimeout(() => { this.textContent = '✅ Apply Code to Editor'; }, 2000);
        });
    }

    bindClick('err-close', hideError);

    const selProv = document.getElementById('sel-provider');
    if (selProv) {
        selProv.addEventListener('change', function () {
            const p = this.value;
            setProvider(p);
            post('changeProvider', { provider: p });
        });
    }

    const btnRef = document.getElementById('btn-refresh-models');
    if (btnRef) {
        btnRef.addEventListener('click', function () {
            this.style.opacity = '0.5';
            setTimeout(() => this.style.opacity = '1', 500);
            post('refreshModels');
        });
    }

    // Pull button
    var pullBtn = document.getElementById('btn-pull');
    if (pullBtn) {
        pullBtn.addEventListener('click', function () {
            var name = document.getElementById('inp-custom').value.trim();
            if (!name) return;
            pullBtn.disabled = true;
            pullBtn.textContent = '⏳';
            hideError();
            post('pullModel', { model: name });
        });
        
        const inpCustom = document.getElementById('inp-custom');
        if (inpCustom) {
            inpCustom.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') pullBtn.click();
            });
        }
    }

    // ── Message listener (from extension backend) ──────────────────────────
    window.addEventListener('message', function (e) {
        var msg = e.data;
        if (!msg || !msg.type) return;

        switch (msg.type) {
            case 'setScore': {
                setScore(msg.score);
                var hd = document.getElementById('health-details');
                if (hd && msg.details) {
                    hd.innerHTML = '';
                    msg.details.forEach(function(d) {
                        var div = document.createElement('div');
                        div.style.fontSize = '9px';
                        div.style.color = 'var(--vscode-descriptionForeground)';
                        div.style.display = 'flex';
                        div.style.alignItems = 'center';
                        div.style.gap = '5px';
                        div.innerHTML = '<span style="opacity:0.5;">•</span> ' + d;
                        hd.appendChild(div);
                    });
                }
                break;
            }
            case 'engineStatus': setEngineStatus(msg.online); break;
            case 'setLoading':  {
                setLoading(msg.active);
                // Do NOT hide the stream-container on complete, leave it so user can click Apply!
                break;
            }
            case 'startStream': {
                var container = document.getElementById('stream-container');
                if (container) container.style.display = 'block';
                var sd = document.getElementById('stream-desc');
                var sc = document.getElementById('stream-code');
                if (sd) sd.innerHTML = '';
                if (sc) sc.textContent = '';
                window._streamBuf = '';
                window._streamState = 'desc'; // 'desc' | 'code' | 'none'
                
                // Hide spinner while streaming
                var lo = document.getElementById('loading-overlay');
                if (lo) lo.classList.remove('active');
                break;
            }
            case 'streamToken': {
                window._streamBuf = (window._streamBuf || '') + msg.token;
                
                // Extract desc and code actively
                var buf = window._streamBuf;
                var sd = document.getElementById('stream-desc');
                var sc = document.getElementById('stream-code');
                
                // Super basic regex to extract tags live
                var descMatch = buf.match(/<desc>([\s\S]*?)(?:<\/desc>|$)/);
                var codeMatch = buf.match(/<code>([\s\S]*?)(?:<\/code>|$)/);
                
                if (sd && descMatch) {
                    var html = descMatch[1].replace(/\n/g, '<br/>');
                    // simple bolding
                    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                    sd.innerHTML = html;
                }
                if (sc && codeMatch) {
                    var tick3 = String.fromCharCode(96, 96, 96);
                    var cleanCode = codeMatch[1].replace(new RegExp('^' + tick3 + '[\\\\w]*\\\\n'), '').replace(new RegExp(tick3 + '$'), '').trim();
                    sc.textContent = cleanCode;
                    sc.scrollTop = sc.scrollHeight;
                }
                break;
            }
            case 'showError':   setLoading(false); showError(msg.msg); break;
            case 'systemInfo':
                var si = document.getElementById('sysinfo');
                if (si) si.textContent = msg.info;
                break;
            case 'updateProvider': setProvider(msg.provider); break;
            case 'updateModels': {
                var grid = document.getElementById('model-grid');
                if (!grid) break;
                grid.innerHTML = '';
                var list = msg.models || [];
                var allTiers = msg.allTiers || {};
                var activeModel = msg.activeModel || msg.recommended;

                Object.keys(allTiers).forEach(function(mId) {
                    var isInstalled = list.includes(mId);
                    var t = allTiers[mId] || { title: mId, desc: '' };
                    var isActive = (mId === activeModel) && isInstalled; 
                    
                    var card = document.createElement('div');
                    card.className = 'm-card';
                    card.setAttribute('data-id', mId);
                    if (isActive) card.classList.add('active');
                    
                    var head = document.createElement('header');
                    head.className = 'm-head';
                    
                    var titleInfo = document.createElement('span');
                    titleInfo.className = 'm-title';
                    titleInfo.innerHTML = t.title + ' <span style="font-size:9px; opacity:0.6; font-weight:normal; margin-left:4px;">[' + mId + ']</span>';
                    
                    var tag = document.createElement('span');
                    tag.className = 'm-tag';
                    if (isInstalled) {
                        tag.classList.add('tag-inst');
                        tag.textContent = '✓ Ready';
                    } else {
                        tag.classList.add('tag-pull');
                        tag.textContent = '⬇️ Pull';
                        card.title = 'Click to auto-install this model';
                    }
                    
                    head.appendChild(titleInfo);
                    head.appendChild(tag);
                    
                    var descInfo = document.createElement('div');
                    descInfo.className = 'm-desc';
                    descInfo.textContent = t.desc;
                    
                    card.appendChild(head);
                    card.appendChild(descInfo);
                    
                    card.addEventListener('click', function() {
                        if (card.classList.contains('pulling')) return;
                        
                        if (!isInstalled) {
                            // 1-Click Pull!
                            card.classList.add('pulling');
                            var pullBtn = document.getElementById('btn-pull');
                            document.getElementById('inp-custom').value = mId;
                            if (pullBtn) pullBtn.click();
                        } else {
                            // Select Model!
                            post('changeModel', { model: mId });
                            Array.from(grid.children).forEach(function(c) {
                                c.classList.remove('active');
                            });
                            card.classList.add('active');
                        }
                    });
                    
                    grid.appendChild(card);
                });
                break;
            }
            case 'pullComplete':
                pullBtn.disabled = false;
                pullBtn.textContent = '⬇️ Pull';
                document.getElementById('inp-custom').value = '';
                break;
            case 'pullError':
                pullBtn.disabled = false;
                pullBtn.textContent = '⬇️ Pull';
                showError('Pull failed: ' + (msg.msg || 'unknown error'));
                break;
        }
    });

    // Initial state — tell backend we are ready
    vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
    }
}
