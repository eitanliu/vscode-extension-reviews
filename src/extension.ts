import * as vscode from 'vscode';
import { ReviewsSidebarProvider } from './reviewsSidebarProvider';

export function activate(context: vscode.ExtensionContext) {
  const sidebarProvider = new ReviewsSidebarProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ReviewsSidebarProvider.viewId,
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // displayName（小写）→ extensionId 映射表，extension.open 拦截时建立
  const displayNameToId = new Map<string, string>();
  // 正在打开的 extensionId，供 vscode.open 期间 onDidChangeTabs 使用
  let lastOpenedExtensionId: string | undefined;

  // 将映射表 resolver 注入侧边栏，供侧边栏打开时精确查 extensionId
  sidebarProvider.setDisplayNameResolver(
    (displayName: string) => displayNameToId.get(displayName.toLowerCase())
  );

  async function loadById(extensionId: string) {
    const autoLoad = vscode.workspace.getConfiguration('extensionReviews').get<boolean>('autoLoad', false);
    if (autoLoad || sidebarProvider.isVisible) {
      await sidebarProvider.loadByExtensionId(extensionId);
    } else {
      sidebarProvider.setPendingExtensionId(extensionId);
    }
  }

  // 覆盖 extension.open：与 "Copy Extension Id" 同源，直接获取精确 extensionId
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.open', async (extensionId: string) => {
      lastOpenedExtensionId = extensionId; // 立即记录，供 onDidChangeTabs 竞态期间使用
      await loadById(extensionId);
      await vscode.commands.executeCommand(
        'vscode.open',
        vscode.Uri.parse(`vscode:extension/${extensionId}`)
      );
      // Tab 已打开，读取 label 建立持久映射（供后续 Tab 切换使用）
      const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
      if (activeTab?.label.startsWith('Extension: ')) {
        const displayName = activeTab.label.slice('Extension: '.length);
        displayNameToId.set(displayName.toLowerCase(), extensionId);
        sidebarProvider.setDisplayNameResolver(
          (dn: string) => displayNameToId.get(dn.toLowerCase())
        );
      }
      lastOpenedExtensionId = undefined;
    })
  );

  // 已有 Tab 切换时，extension.open 不触发，从映射表或 lastOpenedExtensionId 精确查
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(async (event) => {
      const active = [...event.opened, ...event.changed].find((t) => t.isActive);
      if (!active?.label.startsWith('Extension: ')) return;
      const autoLoad = vscode.workspace.getConfiguration('extensionReviews').get<boolean>('autoLoad', false);
      if (!autoLoad && !sidebarProvider.isVisible) return;

      const displayName = active.label.slice('Extension: '.length);
      // 优先映射表（精确），其次 lastOpenedExtensionId（竞态期间）
      const mapped = displayNameToId.get(displayName.toLowerCase()) ?? lastOpenedExtensionId;
      if (mapped) {
        await sidebarProvider.loadByExtensionId(mapped);
      } else {
        // fallback：_detectCurrentTab 会查已安装插件精确匹配
        await sidebarProvider.loadByDisplayName(displayName);
      }
    })
  );

  // 右键菜单命令（与 Copy Extension Id 同机制，接收精确 extensionId）
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
          () => sidebarProvider.loadByExtensionId(extensionId!)
        );
      }
    )
  );

  // if (context.extensionMode === vscode.ExtensionMode.Development) {
  //   // 切换测试：integration（主流程）或 integration-continue（Continue 解析）
  //   // eslint-disable-next-line @typescript-eslint/no-require-imports
  //   const { runContinueTest } = require('./test/integration-continue');
  //   (runContinueTest as (p: typeof sidebarProvider) => Promise<void>)(sidebarProvider)
  //     .catch(console.error);
  // }

  // if (context.extensionMode === vscode.ExtensionMode.Development) {
  //   // eslint-disable-next-line @typescript-eslint/no-require-imports
  //   const { runOpenParamsTest } = require('./test/debug-open-params');
  //   (runOpenParamsTest as (p: typeof sidebarProvider) => Promise<void>)(sidebarProvider)
  //     .catch(console.error);
  // }
}

export function deactivate() {}
