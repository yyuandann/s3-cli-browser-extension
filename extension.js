// ... your existing imports
const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

function execAws(args, cwd) {
    return new Promise((resolve, reject) => {
        cp.exec(`aws ${args}`, { maxBuffer: 1024 * 1024 * 20, cwd }, (err, stdout, stderr) => {
            if (err) {
                return reject(new Error(stderr || err.message));
            }
            resolve(stdout);
        });
    });
}

class S3Item extends vscode.TreeItem {
    constructor(label, collapsibleState, bucket, prefix, isFolder, size, key) {
        super(label, collapsibleState);
        this.bucket = bucket;
        this.prefix = prefix;
        this.isFolder = isFolder;
        this.key = key;
        this.description = isFolder ? '' : (size ? `${size} bytes` : '');
        this.contextValue = 's3Item'; // Ensure contextValue for menu filtering
        if (!isFolder) {
            this.command = {
                command: 's3CliBrowser.openFile',
                title: 'Open S3 File',
                arguments: [this]
            };
        }
    }
}

class S3Provider {
    constructor(context) {
        this.context = context;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    async getChildren(element) {
        const config = vscode.workspace.getConfiguration();
        const bucket = config.get('s3CliBrowser.bucket');
        let basePrefix = config.get('s3CliBrowser.prefix') || '';
        console.log('getChildren called:', { bucket, basePrefix, element });
        if (!bucket) {
            vscode.window.showInformationMessage('Set s3CliBrowser.bucket in settings to use S3 CLI Browser.');
            return [];
        }

        if (!element) {
            return this.listPrefix(bucket, basePrefix);
        } else {
            return this.listPrefix(element.bucket, element.prefix);
        }
    }

    async listPrefix(bucket, prefix) {
        if (prefix && !prefix.endsWith('/')) prefix = prefix + '/';
        const delimiter = '/';
        const args = `s3api list-objects-v2 --bucket "${bucket}" --prefix "${prefix}" --delimiter "${delimiter}" --output json`;
        console.log('Executing AWS CLI:', args);
        let out;
        try {
            out = await execAws(args);
            console.log('AWS CLI output:', out);
        } catch (e) {
            console.error('AWS CLI error:', e.message);
            vscode.window.showErrorMessage(`aws CLI error: ${e.message}`);
            return [];
        }

        let json;
        try {
            json = JSON.parse(out || '{}');
        } catch (e) {
            vscode.window.showErrorMessage('Failed to parse aws output.');
            return [];
        }

        const items = [];
        const prefixes = json.CommonPrefixes || [];
        for (const p of prefixes) {
            const full = p.Prefix;
            const label = full.replace(prefix, '').replace(/\/$/, '');
            items.push(new S3Item(label, vscode.TreeItemCollapsibleState.Collapsed, bucket, full, true, null, full));
        }

        const contents = json.Contents || [];
        for (const c of contents) {
            if (c.Key === prefix) continue;
            const label = c.Key.replace(prefix, '');
            if (label.includes('/')) continue;
            items.push(new S3Item(label, vscode.TreeItemCollapsibleState.None, bucket, c.Key, false, c.Size, c.Key));
        }

        items.sort((a, b) => {
            if (a.isFolder && !b.isFolder) return -1;
            if (!a.isFolder && b.isFolder) return 1;
            return a.label.localeCompare(b.label);
        });

        return items;
    }

    getTreeItem(element) {
        return element; // Ensure the full S3Item is returned
    }
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function activate(context) {
    const provider = new S3Provider(context);
    vscode.window.registerTreeDataProvider('s3CliBrowser', provider);

    context.subscriptions.push(vscode.commands.registerCommand('s3CliBrowser.refresh', () => provider.refresh()));

    context.subscriptions.push(vscode.commands.registerCommand('s3CliBrowser.openFile', async (node) => {
        try {
            const tmpBase = path.join('/tmp', 's3_browser');
            ensureDir(tmpBase);
            const relPath = node.key;
            const targetPath = path.join(tmpBase, relPath);
            ensureDir(path.dirname(targetPath));
            const s3uri = `s3://${node.bucket}/${node.key}`;
            const args = `s3 cp "${s3uri}" "${targetPath}"`;
            const out = await execAws(args);
            const doc = await vscode.workspace.openTextDocument(targetPath).catch(async () => {
                const uri = vscode.Uri.file(targetPath);
                await vscode.commands.executeCommand('vscode.open', uri);
                return null;
            });
            if (doc) {
                await vscode.window.showTextDocument(doc, { preview: true });
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to open S3 file: ${e.message}`);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('s3CliBrowser.openInExplorer', async (node) => {
        if (!node || !node.key) return;
        const tmpBase = path.join('/tmp', 's3_browser');
        const targetPath = path.join(tmpBase, node.key);
        if (fs.existsSync(targetPath)) {
            const uri = vscode.Uri.file(path.dirname(targetPath));
            await vscode.commands.executeCommand('revealFileInOS', uri);
        } else {
            vscode.window.showInformationMessage('File not yet downloaded. Click to open first.');
        }
    }));

    // Updated showPath command with debugging
    context.subscriptions.push(vscode.commands.registerCommand('s3CliBrowser.showPath', async (node) => {
        console.log('showPath called with node:', JSON.stringify(node, null, 2));
        if (!node || !node.bucket || !node.key) {
            console.log('Invalid node, cannot show path. Node:', node);
            vscode.window.showErrorMessage('No S3 item selected.');
            return;
        }
        const filePath = `s3://${node.bucket}/${node.key}`;
        await vscode.env.clipboard.writeText(filePath);
        vscode.window.showInformationMessage(`S3 Path copied: ${filePath}`);
        const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        statusBar.text = `$(file-code) ${path.basename(node.key)}`;
        statusBar.tooltip = filePath;
        statusBar.show();
        setTimeout(() => statusBar.dispose(), 3000);
    }));

    // Auto-refresh on settings change
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('s3CliBrowser')) {
            console.log('S3CliBrowser settings changed, refreshing view');
            provider.refresh();
        }
    }));
}

exports.activate = activate;

function deactivate() {}
module.exports = { activate, deactivate };