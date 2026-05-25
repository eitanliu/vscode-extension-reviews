import * as vscode from 'vscode';
import * as fs from 'fs';
import { ReviewsSidebarProvider } from '../src/reviewsSidebarProvider';

const RESULT_FILE = '/tmp/vscode-reviews-test.json';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const SWITCH_CMD = 'workbench.extensions.action.focusExtensionsView';

export async function runIntegrationTest(sidebarProvider: ReviewsSidebarProvider) {
  await wait(5000);
  const results: { name: string; passed: boolean; detail: string }[] = [];
  const log = (name: string, passed: boolean, detail: string) => {
    results.push({ name, passed, detail });
    fs.writeFileSync(RESULT_FILE, JSON.stringify({ running: true, results }, null, 2));
  };

  const EXT_A = 'esbenp.prettier-vscode';
  const EXT_B = 'dbaeumer.vscode-eslint';

  // ─── 场景1：切插件市场 → 打开插件详情 → 首次打开评论侧栏 ──────────────
  await vscode.commands.executeCommand(SWITCH_CMD);
  await wait(1500);
  log('s1_sidebar_hidden', !sidebarProvider.isVisible,
    `isVisible=${sidebarProvider.isVisible}`);

  sidebarProvider.resetCurrentExt();
  await vscode.commands.executeCommand('extension.open', EXT_A);
  await wait(2000);
  log('s1_no_load_while_hidden', sidebarProvider.currentExtensionId === undefined,
    `currentExt=${sidebarProvider.currentExtensionId}`);

  await vscode.commands.executeCommand(`${ReviewsSidebarProvider.viewId}.focus`);
  await wait(8000);
  log('s1_open_sidebar_loads_extA', sidebarProvider.currentExtensionId === EXT_A,
    `expected=${EXT_A} actual=${sidebarProvider.currentExtensionId}`);

  // ─── 场景2：切回插件市场 → 换插件 → 重新打开评论侧栏 ──────────────────
  await vscode.commands.executeCommand(SWITCH_CMD);
  await wait(1500);
  log('s2_sidebar_hidden', !sidebarProvider.isVisible,
    `isVisible=${sidebarProvider.isVisible}`);

  sidebarProvider.resetCurrentExt();
  await vscode.commands.executeCommand('extension.open', EXT_B);
  await wait(2000);
  log('s2_no_load_while_hidden', sidebarProvider.currentExtensionId === undefined,
    `currentExt=${sidebarProvider.currentExtensionId}`);

  await vscode.commands.executeCommand(`${ReviewsSidebarProvider.viewId}.focus`);
  await wait(8000);
  log('s2_reopen_loads_extB', sidebarProvider.currentExtensionId === EXT_B,
    `expected=${EXT_B} actual=${sidebarProvider.currentExtensionId}`);

  const passed = results.filter(r => r.passed).length;
  fs.writeFileSync(RESULT_FILE, JSON.stringify(
    { allPassed: passed === results.length, passed, total: results.length, results }, null, 2
  ));
}
