import * as vscode from 'vscode';
import * as fs from 'fs';
import { ReviewsSidebarProvider } from '../src/reviewsSidebarProvider';

// 验证 Extension Editor Tab 的 input 类型和 URI 结构
// 以及 extensionReviews.showForExtension 接收的参数格式

const RESULT_FILE = '/tmp/vscode-tab-input.json';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function runTabInputTest(_provider: ReviewsSidebarProvider) {
  await wait(3000);
  const log: Record<string, unknown>[] = [];

  // 1. 打开一个扩展详情页，检查 Tab.input 结构
  const testIds = ['Continue.continue', 'ms-python.python'];
  for (const id of testIds) {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(`vscode:extension/${id}`));
    await wait(2000);

    const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    const input = activeTab?.input;
    const inputType = input?.constructor?.name ?? typeof input;
    let inputDetails: Record<string, unknown> = {};

    if (input) {
      const inp = input as Record<string, unknown>;
      inputDetails = {
        type: inputType,
        uri: (inp['uri'] as vscode.Uri)?.toString?.() ?? inp['uri'],
        scheme: (inp['uri'] as vscode.Uri)?.scheme ?? '',
        authority: (inp['uri'] as vscode.Uri)?.authority ?? '',
        path: (inp['uri'] as vscode.Uri)?.path ?? '',
        viewType: inp['viewType'] ?? '',
      };
    }

    log.push({
      openedId: id,
      tabLabel: activeTab?.label,
      input: inputDetails,
    });
    fs.writeFileSync(RESULT_FILE, JSON.stringify(log, null, 2));
  }
}
