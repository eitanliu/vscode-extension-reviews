import * as vscode from 'vscode';
import { getExtensionReviews, getExtensionById, searchExtensions } from './marketplaceApi';
import { ExtensionInfo } from './types';


export class ReviewsSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'extensionReviews.sidebar';
  private _view?: vscode.WebviewView;
  private _currentExt?: ExtensionInfo;
  private _currentPage = 1;
  private _pendingExt?: ExtensionInfo;
  private _pendingExtensionId?: string; // 精确 extensionId，侧栏打开时加载
  private _displayNameResolver?: (displayName: string) => string | undefined;

  get isVisible() { return !!this._view?.visible; }
  get currentExtensionId() { return this._currentExt ? `${this._currentExt.publisherId}.${this._currentExt.extensionName}` : undefined; }
  resetCurrentExt() { this._currentExt = undefined; }

  setDisplayNameResolver(resolver: (displayName: string) => string | undefined) {
    this._displayNameResolver = resolver;
  }

  // 精确 extensionId 路径：
  // 1. Marketplace 有 → 完整 ExtensionInfo（包含评分）
  // 2. Marketplace 无但已安装 → 从 packageJSON 获取显示信息（保留名称/描述/版本）
  // 3. 都没有 → 最小 ExtensionInfo，仍可获取评论
  async loadByExtensionId(extensionId: string) {
    const dot = extensionId.indexOf('.');
    if (dot === -1) return;
    const publisherId = extensionId.slice(0, dot);
    const extensionName = extensionId.slice(dot + 1);
    try {
      const ext = await getExtensionById(extensionId);
      if (ext) {
        await this.showExtension(ext);
        return;
      }
      // Marketplace 找不到：查已安装插件 packageJSON 保留显示信息
      const installed = vscode.extensions.all.find(
        (e) => e.id.toLowerCase() === extensionId.toLowerCase()
      );
      const pkg = installed?.packageJSON as Record<string, unknown> | undefined;
      await this.showExtension({
        extensionId, extensionName,
        displayName: String(pkg?.['displayName'] ?? extensionName),
        shortDescription: String(pkg?.['description'] ?? ''),
        publisher: String(pkg?.['publisher'] ?? publisherId),
        publisherId,
        version: String(pkg?.['version'] ?? ''),
        installCount: 0, averageRating: 0, ratingCount: 0,
      });
    } catch { /* 静默失败 */ }
  }

  // 侧栏不可见时暂存 extensionId，打开时再加载
  setPendingExtensionId(extensionId: string) {
    this._pendingExtensionId = extensionId;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();

    // 每次侧边栏重新变为可见时，优先用精确 extensionId，否则检测当前 Tab
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        if (this._pendingExtensionId) {
          const id = this._pendingExtensionId;
          this._pendingExtensionId = undefined;
          this.loadByExtensionId(id);
        } else {
          this._detectCurrentTab();
        }
      }
    });

    webviewView.webview.onDidReceiveMessage(async (msg: {
      command: string;
      page?: number;
      query?: string;
      ext?: ExtensionInfo;
    }) => {
      switch (msg.command) {
        case 'ready':
          // WebView JS 已就绪，立即处理积压请求或检测当前 Tab，无需固定延迟
          if (this._pendingExtensionId) {
            const id = this._pendingExtensionId;
            this._pendingExtensionId = undefined;
            this.loadByExtensionId(id);
          } else if (this._pendingExt) {
            const ext = this._pendingExt;
            this._pendingExt = undefined;
            await this.showExtension(ext);
          } else {
            await this._detectCurrentTab();
          }
          break;
        case 'loadMore':
          if (this._currentExt) {
            this._currentPage++;
            await this._fetchAndPost(this._currentExt, this._currentPage, true);
          }
          break;
        case 'loadPage':
          if (this._currentExt && msg.page) {
            this._currentPage = msg.page;
            await this._fetchAndPost(this._currentExt, this._currentPage);
          }
          break;
        case 'search':
          if (msg.query) await this._handleSearch(msg.query);
          break;
        case 'selectExt':
          if (msg.ext) await this.showExtension(msg.ext);
          break;
      }
    });
  }

  // 检测当前活跃 Tab 是否为扩展详情页，若是则加载评论
  private async _detectCurrentTab() {
    const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    if (activeTab?.label.startsWith('Extension: ')) {
      const displayName = activeTab.label.slice('Extension: '.length);
      this._currentExt = undefined;
      await this.loadByDisplayName(displayName);
    }
  }

  // 按 displayName 加载评论（供搜索框选中结果使用）
  async loadByDisplayName(displayName: string) {
    // 1. resolver 精确查（已通过 extension.open 打开过的插件）
    const resolved = this._displayNameResolver?.(displayName);
    if (resolved) {
      await this.loadByExtensionId(resolved);
      return;
    }
    // 2. 已安装插件精确匹配 displayName（从 packageJSON 获取 extensionId）
    const dl = displayName.toLowerCase();
    const installed = vscode.extensions.all.find((e) => {
      const edl = ((e.packageJSON as { displayName?: string })?.displayName ?? '').toLowerCase();
      return edl === dl;
    });
    if (installed) {
      await this.loadByExtensionId(installed.id);
    }
    // 未安装且无映射：不加载（需先通过 extension.open 拦截获取 extensionId）
  }

  async showExtension(ext: ExtensionInfo) {
    // 相同插件不重复加载
    const newId = `${ext.publisherId}.${ext.extensionName}`;
    if (this._currentExt && `${this._currentExt.publisherId}.${this._currentExt.extensionName}` === newId) return;

    this._currentExt = ext;
    this._currentPage = 1;
    if (this._view) {
      this._view.show(true);
      this._view.webview.postMessage({ type: 'showReviews', ext });
      await this._fetchAndPost(ext, 1);
    } else {
      this._pendingExt = ext;
      await vscode.commands.executeCommand(`${ReviewsSidebarProvider.viewId}.focus`);
    }
  }

  postSearchResults(extensions: ExtensionInfo[], query: string) {
    this._view?.webview.postMessage({ type: 'searchResults', extensions, query });
  }

  postError(message: string) {
    this._view?.webview.postMessage({ type: 'error', message, target: 'search' });
  }

  private async _handleSearch(query: string) {
    if (!this._view) return;
    this._view.webview.postMessage({ type: 'searchLoading' });
    try {
      const result = await searchExtensions(query, 1, 10);
      this._view.webview.postMessage({ type: 'searchResults', extensions: result.extensions, query });
    } catch (err) {
      this._view.webview.postMessage({ type: 'error', message: String(err), target: 'search' });
    }
  }

  private async _fetchAndPost(ext: ExtensionInfo, page: number, append = false) {
    if (!this._view) return;
    this._view.webview.postMessage({ type: 'reviewsLoading', append });
    try {
      const result = await getExtensionReviews(ext.publisherId, ext.extensionName, page, 20);
      // 使用 API 返回的 hasMoreReviews，比条数判断更准确
      const hasMore = result.hasMoreReviews ?? (result.reviews.length >= 20);
      this._view.webview.postMessage({ type: 'reviews', ...result, page, append, hasMore });
    } catch (err) {
      this._view.webview.postMessage({ type: 'error', message: String(err), target: 'reviews' });
    }
  }

  private _getHtml(): string {
    return /* html */`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background);
      --fg: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground));
      --border: var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, #444));
      --secondary: var(--vscode-descriptionForeground);
      --hover: var(--vscode-list-hoverBackground);
      --active: var(--vscode-list-activeSelectionBackground);
      --active-fg: var(--vscode-list-activeSelectionForeground);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--fg); font-family: var(--vscode-font-family, sans-serif); font-size: 12px; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

    /* 搜索栏 */
    #search-bar { display: flex; gap: 5px; padding: 8px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
    #search-input { flex: 1; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); padding: 4px 7px; border-radius: 3px; outline: none; font-size: 12px; min-width: 0; }
    #search-input:focus { border-color: var(--vscode-focusBorder, #007acc); }
    #search-btn { background: var(--btn-bg); color: var(--btn-fg); border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; white-space: nowrap; }
    #search-btn:hover { background: var(--btn-hover); }

    /* 主内容区 */
    #content { flex: 1; overflow-y: auto; display: flex; flex-direction: column; min-height: 0; }

    /* 插件头部 */
    #ext-header { padding: 8px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; display: none; }
    #back-btn { background: none; border: none; color: var(--secondary); cursor: pointer; font-size: 11px; padding: 0 0 5px 0; display: flex; align-items: center; gap: 3px; }
    #back-btn:hover { color: var(--fg); }
    #ext-name { font-size: 13px; font-weight: 600; margin-bottom: 3px; }
    #ext-meta { display: flex; gap: 8px; align-items: center; color: var(--secondary); font-size: 11px; }
    .stars { color: #f0a500; }

    /* 搜索结果列表 */
    #search-results { display: none; flex-direction: column; }
    .ext-item { padding: 8px 10px; cursor: pointer; border-bottom: 1px solid var(--border); }
    .ext-item:hover { background: var(--hover); }
    .ext-item-name { font-weight: 600; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ext-item-pub { color: var(--secondary); font-size: 10px; }
    .ext-item-meta { display: flex; gap: 8px; margin-top: 2px; font-size: 10px; color: var(--secondary); }

    /* 评论列表 */
    #reviews-list { display: flex; flex-direction: column; }
    .review { padding: 8px 10px; border-bottom: 1px solid var(--border); }
    .review-top { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-bottom: 4px; }
    .review-author { font-weight: 600; font-size: 11px; }
    .review-date { color: var(--secondary); font-size: 10px; }
    .review-ver { color: var(--secondary); font-size: 10px; background: var(--hover); padding: 1px 4px; border-radius: 2px; }
    .review-text { line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .helpful { margin-top: 3px; color: var(--secondary); font-size: 10px; }

    /* 加载更多 */
    #load-more-wrap { display: none; padding: 8px 10px; border-top: 1px solid var(--border); text-align: center; flex-shrink: 0; }
    #load-more-btn { background: var(--btn-bg); color: var(--btn-fg); border: none; padding: 4px 16px; border-radius: 3px; cursor: pointer; font-size: 11px; width: 100%; }
    #load-more-btn:hover:not(:disabled) { background: var(--btn-hover); }
    #load-more-btn:disabled { opacity: 0.5; cursor: default; }
    #load-more-info { font-size: 10px; color: var(--secondary); margin-top: 4px; }

    .placeholder { padding: 20px 10px; text-align: center; color: var(--secondary); line-height: 1.7; font-size: 12px; }
    .loading { padding: 14px; text-align: center; color: var(--secondary); }
    .error { padding: 10px; color: #f44; font-size: 11px; }
  </style>
</head>
<body>
  <div id="search-bar">
    <input id="search-input" type="text" placeholder="搜索插件名称..." />
    <button id="search-btn">搜索</button>
  </div>

  <div id="content">
    <div id="ext-header">
      <button id="back-btn">← 返回搜索</button>
      <div id="ext-name"></div>
      <div id="ext-meta">
        <span class="stars" id="stars"></span>
        <span id="avg-rating"></span>
        <span id="rating-count"></span>
      </div>
    </div>

    <div id="search-results"></div>
    <div id="reviews-list">
      <div class="placeholder">打开任意插件详情页<br>评论将自动显示在此处<br><br>或使用上方搜索框<br>手动搜索插件</div>
    </div>
  </div>

  <div id="load-more-wrap">
    <button id="load-more-btn">Load more</button>
    <div id="load-more-info"></div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    // 通知扩展 WebView 已就绪，立即触发加载（无固定延迟）
    vscode.postMessage({ command: 'ready' });
    let page = 1, total = 0, pageSize = 20;

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const extHeader = document.getElementById('ext-header');
    const searchResults = document.getElementById('search-results');
    const reviewsList = document.getElementById('reviews-list');
    const loadMoreWrap = document.getElementById('load-more-wrap');
    const loadMoreBtn = document.getElementById('load-more-btn');
    const backBtn = document.getElementById('back-btn');

    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    backBtn.addEventListener('click', showSearchView);
    loadMoreBtn.addEventListener('click', () => {
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = 'Loading...';
      vscode.postMessage({ command: 'loadMore' });
    });

    function doSearch() {
      const q = searchInput.value.trim();
      if (!q) return;
      vscode.postMessage({ command: 'search', query: q });
    }

    function showSearchView() {
      extHeader.style.display = 'none';
      searchResults.style.display = 'flex';
      reviewsList.style.display = 'none';
      loadMoreWrap.style.display = 'none';
    }

    function showReviewsView() {
      extHeader.style.display = 'block';
      searchResults.style.display = 'none';
      reviewsList.style.display = 'flex';
    }

    function stars(n) { return '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n)); }
    function fmtDate(s) { return s ? new Date(s).toLocaleDateString('zh-CN') : ''; }
    function fmtNum(n) { return n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n); }
    function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    window.addEventListener('message', e => {
      const msg = e.data;
      switch (msg.type) {
        case 'showReviews':
          showReviewsView();
          document.getElementById('ext-name').textContent = msg.ext.displayName;
          document.getElementById('stars').textContent = stars(msg.ext.averageRating);
          document.getElementById('avg-rating').textContent = msg.ext.averageRating.toFixed(1);
          document.getElementById('rating-count').textContent = '(' + msg.ext.ratingCount + ')';
          reviewsList.innerHTML = '<div class="loading">加载评论中...</div>';
          loadMoreWrap.style.display = 'none';
          break;

        case 'reviewsLoading':
          if (!msg.append) reviewsList.innerHTML = '<div class="loading">加载评论中...</div>';
          break;

        case 'reviews':
          page = msg.page; total = msg.totalCount || 0;
          renderReviews(msg.reviews, msg.append, msg.hasMore);
          break;

        case 'searchLoading':
          searchResults.innerHTML = '<div class="loading">搜索中...</div>';
          searchResults.style.display = 'flex';
          reviewsList.style.display = 'none';
          extHeader.style.display = 'none';
          loadMoreWrap.style.display = 'none';
          break;

        case 'searchResults':
          renderSearchResults(msg.extensions);
          break;

        case 'error':
          if (msg.target === 'search') {
            searchResults.innerHTML = '<div class="error">搜索失败: ' + esc(msg.message) + '</div>';
          } else {
            reviewsList.innerHTML = '<div class="error">加载失败: ' + esc(msg.message) + '</div>';
          }
          break;
      }
    });

    function renderSearchResults(exts) {
      if (!exts || exts.length === 0) {
        searchResults.innerHTML = '<div class="placeholder">未找到相关插件</div>';
        return;
      }
      searchResults.innerHTML = exts.map(ext => \`
        <div class="ext-item" onclick='selectExt(\${JSON.stringify(JSON.stringify(ext))})'>
          <div class="ext-item-name">\${esc(ext.displayName)}</div>
          <div class="ext-item-pub">\${esc(ext.publisher)}</div>
          <div class="ext-item-meta">
            <span class="stars">\${stars(ext.averageRating)}</span>
            <span>\${fmtNum(ext.installCount)} 安装</span>
          </div>
        </div>
      \`).join('');
    }

    function selectExt(extJson) {
      const ext = JSON.parse(extJson);
      vscode.postMessage({ command: 'selectExt', ext });
    }

    function renderReviews(reviews, append, hasMore) {
      if (!reviews || reviews.length === 0) {
        if (!append) reviewsList.innerHTML = '<div class="placeholder">暂无评论</div>';
        loadMoreWrap.style.display = 'none';
        return;
      }
      const html = reviews.map(r => \`
        <div class="review">
          <div class="review-top">
            <span class="stars">\${stars(r.rating)}</span>
            <span class="review-author">\${esc(r.userDisplayName || 'Anonymous')}</span>
            \${r.productVersion ? \`<span class="review-ver">\${esc(r.productVersion)}</span>\` : ''}
            <span class="review-date">\${fmtDate(r.updatedDate || r.createdDate)}</span>
          </div>
          <div class="review-text">\${esc(r.text || '(无文字评论)')}</div>
          \${r.helpfulCount > 0 ? \`<div class="helpful">👍 \${r.helpfulCount}</div>\` : ''}
        </div>
      \`).join('');

      if (append) {
        reviewsList.insertAdjacentHTML('beforeend', html);
      } else {
        reviewsList.innerHTML = html;
      }

      const loaded = page * pageSize;
      loadMoreWrap.style.display = hasMore ? 'block' : 'none';
      if (hasMore) {
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = 'Load more';
        document.getElementById('load-more-info').textContent = loaded + ' loaded';
      }
    }
  </script>
</body>
</html>`;
  }
}
