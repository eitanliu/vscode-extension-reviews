import * as vscode from 'vscode';
import * as fs from 'fs';
import { ReviewsSidebarProvider } from '../src/reviewsSidebarProvider';

const RESULT_FILE = '/tmp/vscode-extension-open-debug.json';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function runExtensionOpenTest(_sidebarProvider: ReviewsSidebarProvider) {
  await wait(3000);
  const log: object[] = [];

  // 测试不同 URI 格式是否能打开扩展详情页
  const testCases = [
    { method: 'vscode.open extension:///id', uri: 'extension:///Continue.continue' },
    { method: 'vscode.open extension://id',  uri: 'extension://Continue.continue' },
    { method: 'vscode.open vscode:extension/id', uri: 'vscode:extension/Continue.continue' },
  ];

  for (const tc of testCases) {
    const before = vscode.window.tabGroups.all.flatMap(g => g.tabs).length;
    try {
      await vscode.commands.executeCommand('vscode.open',
        vscode.Uri.parse(tc.uri));
      await wait(2000);
    } catch (e) {
      log.push({ method: tc.method, error: String(e) });
      continue;
    }
    const after = vscode.window.tabGroups.all.flatMap(g => g.tabs);
    const newTabs = after.slice(before);
    log.push({
      method: tc.method,
      uri: tc.uri,
      newTabLabels: newTabs.map(t => t.label),
      activeTabLabel: vscode.window.tabGroups.activeTabGroup?.activeTab?.label,
    });
  }

  fs.writeFileSync(RESULT_FILE, JSON.stringify(log, null, 2));
}
