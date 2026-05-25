import * as vscode from 'vscode';
import { ReviewsSidebarProvider } from './reviewsSidebarProvider';
import { searchExtensions } from './marketplaceApi';

export function activate(context: vscode.ExtensionContext) {
  const sidebarProvider = new ReviewsSidebarProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ReviewsSidebarProvider.viewId,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  async function loadReviewsForId(extensionId: string) {
    const dot = extensionId.indexOf('.');
    if (dot === -1) return;
    const publisher = extensionId.slice(0, dot);
    const name = extensionId.slice(dot + 1);
    try {
      const result = await searchExtensions(name, 1, 5);
      const matched = result.extensions.find(
        (e) =>
          e.publisherId.toLowerCase() === publisher.toLowerCase() &&
          e.extensionName.toLowerCase() === name.toLowerCase()
      );
      if (matched) await sidebarProvider.showExtension(matched);
    } catch { /* 静默失败 */ }
  }

  // 监听 Tab 激活：label 以 "Extension: " 开头即为扩展详情页
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(async (event) => {
      const active = [...event.opened, ...event.changed].find((t) => t.isActive);
      if (!active?.label.startsWith('Extension: ')) return;
      const autoLoad = vscode.workspace.getConfiguration('extensionReviews').get<boolean>('autoLoad', false);
      if (!autoLoad && !sidebarProvider.isVisible) return;
      const displayName = active.label.slice('Extension: '.length);
      await sidebarProvider.loadByDisplayName(displayName);
    })
  );

  // 右键菜单命令
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'extensionReviews.showForExtension',
      async (arg?: unknown) => {
        let extensionId: string | undefined;
        if (typeof arg === 'string') {
          extensionId = arg;
        } else if (arg && typeof arg === 'object') {
          const obj = arg as Record<string, unknown>;
          extensionId = (obj['id'] ?? obj['extensionId']) as string | undefined;
        }
        if (!extensionId) return;
        sidebarProvider.resetCurrentExt();
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: 'Loading reviews...' },
          () => loadReviewsForId(extensionId!)
        );
      }
    )
  );

  // if (context.extensionMode === vscode.ExtensionMode.Development) {
  //   // eslint-disable-next-line @typescript-eslint/no-require-imports
  //   const { runIntegrationTest } = require('./test/integration');
  //   (runIntegrationTest as (p: typeof sidebarProvider) => Promise<void>)(sidebarProvider)
  //     .catch(console.error);
  // }
}

export function deactivate() {}
