/**
 * 测试未安装插件（Continue）的 displayName 匹配和评论获取
 * 验证：第一个词搜索策略能否正确找到 Continue.continue
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { ReviewsSidebarProvider } from '../src/reviewsSidebarProvider';

const RESULT_FILE = '/tmp/vscode-reviews-test-continue.json';
const SWITCH_CMD = 'workbench.extensions.action.focusExtensionsView';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function runContinueTest(sidebarProvider: ReviewsSidebarProvider) {
  await wait(5000);
  const results: { name: string; passed: boolean; detail: string }[] = [];
  const log = (name: string, passed: boolean, detail: string) => {
    results.push({ name, passed, detail });
    fs.writeFileSync(RESULT_FILE, JSON.stringify({ running: true, results }, null, 2));
  };

  // Continue 未安装时走搜索路径，displayName 是 "Continue - open-source AI code agent"
  const EXT_CONTINUE = 'Continue.continue';

  // 切到插件市场（关闭评论侧栏）
  await vscode.commands.executeCommand(SWITCH_CMD);
  await wait(1500);
  log('sidebar_hidden', !sidebarProvider.isVisible,
    `isVisible=${sidebarProvider.isVisible}`);

  // 打开 Continue 详情
  sidebarProvider.resetCurrentExt();
  await vscode.commands.executeCommand('extension.open', EXT_CONTINUE);
  await wait(2000);
  log('no_load_while_hidden', sidebarProvider.currentExtensionId === undefined,
    `currentExt=${sidebarProvider.currentExtensionId}`);

  // 打开评论侧栏 → 应通过第一个词搜索正确找到 Continue 并加载评论
  await vscode.commands.executeCommand(`${ReviewsSidebarProvider.viewId}.focus`);
  await wait(10000);
  log('loads_continue_reviews', sidebarProvider.currentExtensionId === EXT_CONTINUE,
    `expected=${EXT_CONTINUE} actual=${sidebarProvider.currentExtensionId}`);

  const passed = results.filter(r => r.passed).length;
  fs.writeFileSync(RESULT_FILE, JSON.stringify(
    { allPassed: passed === results.length, passed, total: results.length, results }, null, 2
  ));
}
