import * as vscode from 'vscode';
import { getExtensionReviews, searchExtensions } from './marketplaceApi';
import { ExtensionInfo } from './types';

export class ReviewsSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'extensionReviews.sidebar';
  private _view?: vscode.WebviewView;
  private _currentExt?: ExtensionInfo;
  private _currentPage = 1;
  private _pendingExt?: ExtensionInfo;

  get isVisible() { return !!this._view?.visible; }
  get currentExtensionId() { return this._currentExt ? `${this._currentExt.publisherId}.${this._currentExt.extensionName}` : undefined; }
  resetCurrentExt() { this._currentExt = undefined; }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();

    // 每次侧边栏重新变为可见时，检测当前 Tab（retainContextWhenHidden 下无需延迟）
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._detectCurrentTab();
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
          if (this._pendingExt) {
            const ext = this._pendingExt;
            this._pendingExt = undefined;
            await this.showExtension(ext);
          } else {
            await this._detectCurrentTab();
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
      // 重置当前扩展，确保重新打开侧边栏时同一插件也能刷新
      this._currentExt = undefined;
      await this._loadByDisplayName(displayName);
    }
  }

  // 按 displayName 搜索并加载评论
  async loadByDisplayName(displayName: string) {
    await this._loadByDisplayName(displayName);
  }

  private async _loadByDisplayName(displayName: string) {
    try {
      const installed = vscode.extensions.all.find(
        (e) => (e.packageJSON as { displayName?: string })?.displayName === displayName
      );
      if (installed) {
        const [publisher, ...rest] = installed.id.split('.');
        const name = rest.join('.');
        const result = await searchExtensions(name, 1, 5);
        const matched = result.extensions.find(
          (e) => e.publisherId.toLowerCase() === publisher.toLowerCase() &&
                 e.extensionName.toLowerCase() === name.toLowerCase()
        );
        if (matched) { await this.showExtension(matched); return; }
      }
      const result = await searchExtensions(displayName, 1, 5);
      const matched = result.extensions.find(
        (e) => e.displayName.toLowerCase() === displayName.toLowerCase()
      ) ?? result.extensions[0];
      if (matched) await this.showExtension(matched);
    } catch { /* 静默失败 */ }
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

  private async _fetchAndPost(ext: ExtensionInfo, page: number) {
    if (!this._view) return;
    this._view.webview.postMessage({ type: 'reviewsLoading' });
    try {
      const result = await getExtensionReviews(ext.publisherId, ext.extensionName, page, 20);
      this._view.webview.postMessage({ type: 'reviews', ...result, page });
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

    /* 分页 */
    #pagination { display: none; padding: 7px 10px; border-top: 1px solid var(--border); justify-content: space-between; align-items: center; flex-shrink: 0; }
    .pg-btn { background: var(--btn-bg); color: var(--btn-fg); border: none; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; }
    .pg-btn:hover:not(:disabled) { background: var(--btn-hover); }
    .pg-btn:disabled { opacity: 0.4; cursor: default; }
    .pg-info { font-size: 11px; color: var(--secondary); }

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

  <div id="pagination">
    <button class="pg-btn" id="btn-prev">上一页</button>
    <span class="pg-info" id="pg-info"></span>
    <button class="pg-btn" id="btn-next">下一页</button>
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
    const pagination = document.getElementById('pagination');
    const backBtn = document.getElementById('back-btn');

    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    backBtn.addEventListener('click', showSearchView);
    document.getElementById('btn-prev').addEventListener('click', () => {
      if (page > 1) { page--; vscode.postMessage({ command: 'loadPage', page }); }
    });
    document.getElementById('btn-next').addEventListener('click', () => {
      if (page < Math.ceil(total / pageSize)) { page++; vscode.postMessage({ command: 'loadPage', page }); }
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
      pagination.style.display = 'none';
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
          pagination.style.display = 'none';
          break;

        case 'reviewsLoading':
          reviewsList.innerHTML = '<div class="loading">加载评论中...</div>';
          break;

        case 'reviews':
          page = msg.page; total = msg.totalCount || 0;
          renderReviews(msg.reviews);
          break;

        case 'searchLoading':
          searchResults.innerHTML = '<div class="loading">搜索中...</div>';
          searchResults.style.display = 'flex';
          reviewsList.style.display = 'none';
          extHeader.style.display = 'none';
          pagination.style.display = 'none';
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

    function renderReviews(reviews) {
      if (!reviews || reviews.length === 0) {
        reviewsList.innerHTML = '<div class="placeholder">暂无评论</div>';
        pagination.style.display = 'none';
        return;
      }
      reviewsList.innerHTML = reviews.map(r => \`
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

      const totalPages = Math.ceil(total / pageSize);
      if (totalPages > 1) {
        pagination.style.display = 'flex';
        document.getElementById('pg-info').textContent = page + ' / ' + totalPages;
        document.getElementById('btn-prev').disabled = page <= 1;
        document.getElementById('btn-next').disabled = page >= totalPages;
      } else {
        pagination.style.display = 'none';
      }
    }
  </script>
</body>
</html>`;
  }
}
