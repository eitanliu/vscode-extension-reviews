import * as vscode from 'vscode';
import * as fs from 'fs';
import { ReviewsSidebarProvider } from '../src/reviewsSidebarProvider';

const RESULT_FILE = '/tmp/vscode-open-params.json';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function runOpenParamsTest(_sidebarProvider: ReviewsSidebarProvider) {
  await wait(3000);
  const log: object[] = [];

  for (const id of ['Continue.continue', 'liuguibin.deepseek-cline-admin-extension']) {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(`vscode:extension/${id}`));
    await wait(2000);
    const active = vscode.window.tabGroups.activeTabGroup?.activeTab;
    log.push({
      id,
      uri: `vscode:extension/${id}`,
      activeLabel: active?.label,
      isExtensionTab: active?.label?.startsWith('Extension:') ?? false,
    });
    fs.writeFileSync(RESULT_FILE, JSON.stringify(log, null, 2));
  }
}
