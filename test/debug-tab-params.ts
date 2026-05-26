import * as vscode from 'vscode';
import * as fs from 'fs';
import { ReviewsSidebarProvider } from '../src/reviewsSidebarProvider';

const RESULT_FILE = '/tmp/vscode-tab-params.json';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function captureTab(tab: vscode.Tab) {
  const input = tab.input as Record<string, unknown> | undefined;
  const uri = (input as { uri?: vscode.Uri })?.uri;

  // 收集 input 的所有属性（包括原型链上的）
  const inputAllProps: Record<string, unknown> = {};
  if (input) {
    const keys = new Set([
      ...Object.keys(input),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(input) ?? {}),
    ]);
    for (const k of keys) {
      try {
        const v = (input as Record<string, unknown>)[k];
        inputAllProps[k] = typeof v === 'object' && v !== null ? String(v) : v;
      } catch { /* skip */ }
    }
  }

  return {
    // Tab 自身的所有属性
    label: tab.label,
    isActive: tab.isActive,
    isDirty: tab.isDirty,
    isPinned: tab.isPinned,
    isPreview: tab.isPreview,
    // input 对象
    inputType: input?.constructor?.name,
    inputOwnKeys: input ? Object.keys(input) : [],
    inputProtoKeys: input ? Object.getOwnPropertyNames(Object.getPrototypeOf(input) ?? {}) : [],
    inputAllProps,
    uri: uri ? {
      scheme: uri.scheme,
      authority: uri.authority,
      path: uri.path,
      query: uri.query,
      fragment: uri.fragment,
      full: uri.toString(),
    } : null,
  };
}

export async function runTabParamsTest(_sidebarProvider: ReviewsSidebarProvider) {
  await wait(4000);
  const snapshots: object[] = [];

  for (const extId of ['esbenp.prettier-vscode', 'Continue.continue', 'dbaeumer.vscode-eslint']) {
    await vscode.commands.executeCommand('extension.open', extId);
    await wait(1500);

    const allTabs = vscode.window.tabGroups.all.flatMap(g => g.tabs).map(captureTab);
    const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    snapshots.push({
      openedFor: extId,
      activeTab: activeTab ? captureTab(activeTab) : null,
      allExtensionTabs: allTabs.filter(t => t.label.startsWith('Extension:')),
    });
  }

  fs.writeFileSync(RESULT_FILE, JSON.stringify(snapshots, null, 2));
}
