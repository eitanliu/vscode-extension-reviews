# extensionId 获取方案 —— 设计决策记录

## 背景

VS Code 插件 `extension-reviews` 需要在用户查看插件详情页时，自动加载该插件的 Marketplace 评论。核心难点：**对未安装的插件，如何拿到精确的 extensionId（`publisher.name`）**。

displayName（如 `"Cline"`）容易产生歧义（多个插件同名、模糊搜索匹配错位），必须有可靠的 extensionId 才能调用 Marketplace API。

## 探索的路径与失败原因（按时间顺序）

### 1. ❌ 覆盖 `extension.open` 命令

**思路**：右键菜单中的 "Copy Extension Id" 与 "Open" 都接收精确 extensionId 字符串，覆盖 `extension.open` 应该能拦截到 ID。

**实测失败**。日志验证 `extension.open invoked` 从未触发。

**源码证明**（`vs/workbench/contrib/extensions/browser/extensionsViewer.ts`）：
```typescript
class OpenExtensionAction extends Action {
  override run(sideByside: boolean): Promise<any> {
    return this.extensionsWorkdbenchService.open(this._extension, { sideByside });
    //          ↑ 直接调用 service，绕过 commandService.executeCommand
  }
}

// 列表点击监听
this.list.onDidOpen → this.openExtension(...) →
  this.extensionsWorkbenchService.open(extension, ...)
```

**结论**：VS Code 内部所有"打开扩展详情页"路径（列表点击、双击、URL handler）都直接调用 `IExtensionsWorkbenchService.open()`，**完全不经过命令系统**。`vscode.commands.registerCommand('extension.open', ...)` 只在以下场景生效：命令面板手动输入、其他扩展显式调用、右键菜单 → "Open"。这些场景都不是"插件市场点击"。

### 2. ❌ 从 `Tab.input` 提取 URI

**思路**：`ExtensionsInput.resource` 在 VS Code 内部是 `extension:publisher.name/extension`（来自 `vs/workbench/contrib/extensions/common/extensionsInput.ts`），通过 Tab API 应该能拿到。

**实测失败**。日志显示扩展详情页 Tab 的 `input` 始终是 `undefined`。

完整 Tab 属性探测（含 prototype chain）：
```
allPropKeys: ["isActive", "label", "input", "isDirty", "isPinned", "isPreview", "group"]
input: undefined  // ← 序列化时被省略
```

**结论**：VS Code Tab API 类型签名为 `TabInputText | TabInputCustom | ... | unknown`，VS Code 在 ExtHost 序列化层不向外部扩展映射 `ExtensionsInput`，所以扩展端永远拿到 `undefined`。无任何字段可反推 extensionId。

### 3. ❌ Marketplace 搜索按 InstallCount 排序

**思路**：用 displayName 调 `searchExtensions`，按热度排序取首条。

**实测失败案例**：
- `searchExtensions("Continue", sortBy: 4)` → 返回 Pylance（按热度第一）
- `searchExtensions("Cline Pro - CodeAI", sortBy: 4, pageSize: 50)` → 全是 Jupyter/GitHub Copilot 等热门插件，目标小众插件不在前 50 位

**结论**：`filterType: 10` 是全文模糊匹配，按 InstallCount 排序会让小众插件被埋没。

## 最终方案：4 层精确匹配

```
Tab 切换到 "Extension: <displayName>"
        ↓
1. resolver 映射表（用户右键过的插件已缓存）
        ↓ (未命中)
2. 已安装插件 packageJSON.displayName 精确匹配
        ↓ (未命中)
3. Marketplace 相关性搜索 + displayName 完全相等过滤
   - 默认相关性排序（不指定 sortBy）
   - pageSize: 50
   - 过滤 result.extensions.filter(e => e.displayName === query)
   - 仅在 exact.length === 1 时加载（避免歧义）
        ↓ (多匹配/零匹配)
4. 不加载（用户需右键 → "View Extension Reviews"）
```

### 关键技术点

**为什么相关性排序能命中？** Marketplace 默认排序（不传 `sortBy`）按搜索文本与 displayName/description 的匹配度排序。实测：
```
搜索 "Cline Pro - CodeAI"（相关性排序）：
  1. Cline                       ← 包含 "Cline"
  2. Cline Pro - CodeAI          ← 完全匹配 ✓
  3. Cline Chinese
  ...
```

**为什么过滤 `displayName === query` 而不取首条？** 避免之前 `"Continue"` 误匹配 `"Continue - open-source AI code agent"` 等部分匹配的问题。`exact.length === 1` 是绝对精确等值。

**为什么 `exact.length > 1` 时不加载？** 极少数情况下不同 publisher 可能用相同 displayName，无法仅凭 displayName 区分。此时静默不加载，引导用户走右键菜单（精确路径）。

## 右键菜单：未安装插件最可靠的入口

```typescript
// extension/context 菜单触发时，VS Code 把 IExtension 对象作为参数传入
vscode.commands.registerCommand('extensionReviews.showForExtension', async (arg) => {
  const obj = arg as Record<string, unknown>;
  const identifier = obj['identifier'] as { id: string } | undefined;
  const extensionId = identifier?.id ?? obj['id'] ?? obj['extensionId'];
  const displayName = obj['displayName'];

  // 缓存 displayName → extensionId 映射，下次切 Tab 直接命中
  if (displayName && extensionId) {
    displayNameToId.set(displayName.toLowerCase(), extensionId);
  }
  ...
});
```

`extension/context` 菜单触发命令时，VS Code 把 `IExtension` 对象作为参数传给外部扩展命令——这是**唯一**能从 VS Code 拿到精确 extensionId 的稳定入口。命令名注册在 `package.json` 的 `menus.extension/context` 下。

## 已废弃的字段/逻辑

清理掉的无效代码：
- `extension.open` 命令覆盖：源码证明永远不会被插件市场点击触发
- `_extensionIdFromTab` 方法：Tab.input 永远是 undefined
- `lastOpenedExtensionId` 竞态变量：依赖 `extension.open` 拦截，已无意义
- 调试日志框架：定位完成后移除

## 局限与可能的未来改进

**当前局限**：
- displayName 完全相同的多个插件无法自动区分，需用户右键
- 依赖 Marketplace API 网络请求，离线场景无法 fallback

**可能的未来路径**：
- 如果 VS Code 未来在 Tab API 中暴露 `TabInputExtension` 类型（包含 extensionId），可以彻底替换 Marketplace 搜索 fallback
- 监听 `vscode.workspace.fs` 或类似事件捕获扩展安装/打开行为（目前 API 不支持）
