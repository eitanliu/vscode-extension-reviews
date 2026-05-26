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

  // displayName（小写）→ extensionId 映射表，右键菜单触发时建立
  // 用户右键过的插件下次切换 Tab 时可精确加载
  const displayNameToId = new Map<string, string>();
  sidebarProvider.setDisplayNameResolver(
    (displayName: string) => displayNameToId.get(displayName.toLowerCase())
  );

  // Tab 切换时自动加载评论（label 以 "Extension: " 开头判定为扩展详情页）
  // VS Code 不向外部扩展暴露 ExtensionsInput，Tab.input 始终 undefined，
  // 只能从 label 拿 displayName，再查映射表 / 已安装 / Marketplace 精确匹配
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

  // 右键菜单命令（与 Copy Extension Id 同源，接收精确 extensionId）
  // 这是未安装插件最可靠的入口：从 IExtension 对象的 identifier.id 直接拿
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'extensionReviews.showForExtension',
      async (arg?: unknown) => {
        let extensionId: string | undefined;
        let displayName: string | undefined;
        if (typeof arg === 'string') {
          extensionId = arg;
        } else if (arg && typeof arg === 'object') {
          const obj = arg as Record<string, unknown>;
          // extension/context 菜单传入的是 IExtension 对象：
          //   { identifier: { id: string }, displayName: string, ... }
          const identifier = obj['identifier'] as Record<string, unknown> | undefined;
          extensionId = (identifier?.['id'] as string | undefined)
            ?? (obj['id'] as string | undefined)
            ?? (obj['extensionId'] as string | undefined);
          displayName = obj['displayName'] as string | undefined;
        }
        if (!extensionId) return;
        // 缓存 displayName → extensionId 映射（未安装插件后续切 Tab 时可精确加载）
        if (displayName) displayNameToId.set(displayName.toLowerCase(), extensionId);
        sidebarProvider.resetCurrentExt();
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: 'Loading reviews...' },
          () => sidebarProvider.loadByExtensionId(extensionId!)
        );
      }
    )
  );
}

export function deactivate() {}
