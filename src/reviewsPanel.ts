import * as vscode from 'vscode';
import { searchExtensions, getExtensionReviews } from './marketplaceApi';
import { ExtensionInfo } from './types';

export class ReviewsPanel {
  static currentPanel: ReviewsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  static createOrShow(extensionUri: vscode.Uri, initialExtension?: ExtensionInfo) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ReviewsPanel.currentPanel) {
      ReviewsPanel.currentPanel._panel.reveal(column);
      if (initialExtension) {
        ReviewsPanel.currentPanel._loadExtensionReviews(initialExtension, 1);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'extensionReviews',
      'Extension Reviews',
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    ReviewsPanel.currentPanel = new ReviewsPanel(panel, extensionUri, initialExtension);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    _extensionUri: vscode.Uri,
    initialExtension?: ExtensionInfo
  ) {
    this._panel = panel;
    this._panel.webview.html = this._getHtmlContent();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message: { command: string; query?: string; publisher?: string; name?: string; page?: number }) => {
        switch (message.command) {
          case 'search':
            if (message.query) {
              await this._handleSearch(message.query, message.page ?? 1);
            }
            break;
          case 'loadReviews':
            if (message.publisher && message.name) {
              await this._handleLoadReviews(message.publisher, message.name, message.page ?? 1);
            }
            break;
        }
      },
      null,
      this._disposables
    );

    if (initialExtension) {
      // 延迟加载，等 webview 初始化完成
      setTimeout(() => this._loadExtensionReviews(initialExtension, 1), 300);
    }
  }

  private async _handleSearch(query: string, page: number) {
    this._panel.webview.postMessage({ type: 'loading', target: 'search' });
    try {
      const result = await searchExtensions(query, page, 10);
      this._panel.webview.postMessage({ type: 'searchResult', ...result, query, page });
    } catch (err) {
      this._panel.webview.postMessage({ type: 'error', message: String(err), target: 'search' });
    }
  }

  private async _handleLoadReviews(publisher: string, name: string, page: number) {
    this._panel.webview.postMessage({ type: 'loading', target: 'reviews' });
    try {
      const result = await getExtensionReviews(publisher, name, page, 20);
      this._panel.webview.postMessage({ type: 'reviewsResult', ...result, publisher, name, page });
    } catch (err) {
      this._panel.webview.postMessage({ type: 'error', message: String(err), target: 'reviews' });
    }
  }

  private _loadExtensionReviews(ext: ExtensionInfo, page: number) {
    this._panel.webview.postMessage({
      type: 'selectExtension',
      extension: ext,
    });
    this._handleLoadReviews(ext.publisherId, ext.extensionName, page);
  }

  private _getHtmlContent(): string {
    return /* html */`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Extension Reviews</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-widget-border, #444);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --list-hover: var(--vscode-list-hoverBackground);
      --list-active: var(--vscode-list-activeSelectionBackground);
      --secondary: var(--vscode-descriptionForeground);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--fg); font-family: var(--vscode-font-family, sans-serif); font-size: 13px; display: flex; height: 100vh; overflow: hidden; }

    /* 左侧搜索面板 */
    #search-panel { width: 300px; min-width: 220px; display: flex; flex-direction: column; border-right: 1px solid var(--border); }
    #search-bar { padding: 10px; display: flex; gap: 6px; border-bottom: 1px solid var(--border); }
    #search-input { flex: 1; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--border); padding: 5px 8px; border-radius: 3px; outline: none; font-size: 12px; }
    #search-input:focus { border-color: var(--vscode-focusBorder, #007acc); }
    #search-btn { background: var(--btn-bg); color: var(--btn-fg); border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; white-space: nowrap; }
    #search-btn:hover { background: var(--btn-hover); }
    #search-results { flex: 1; overflow-y: auto; }
    .ext-item { padding: 10px 12px; cursor: pointer; border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: flex-start; }
    .ext-item:hover { background: var(--list-hover); }
    .ext-item.selected { background: var(--list-active); }
    .ext-icon { width: 32px; height: 32px; border-radius: 4px; object-fit: contain; flex-shrink: 0; background: #333; }
    .ext-icon-placeholder { width: 32px; height: 32px; border-radius: 4px; background: var(--btn-bg); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
    .ext-info { flex: 1; min-width: 0; }
    .ext-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ext-publisher { color: var(--secondary); font-size: 11px; margin-top: 2px; }
    .ext-meta { display: flex; gap: 8px; margin-top: 3px; color: var(--secondary); font-size: 11px; }
    .stars { color: #f0a500; }
    #search-pagination { padding: 8px; display: flex; justify-content: center; gap: 8px; border-top: 1px solid var(--border); }

    /* 右侧评论面板 */
    #reviews-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    #reviews-header { padding: 12px 16px; border-bottom: 1px solid var(--border); }
    #reviews-header h2 { font-size: 15px; font-weight: 600; }
    #reviews-header .header-meta { display: flex; gap: 16px; margin-top: 6px; color: var(--secondary); font-size: 12px; align-items: center; }
    .rating-big { font-size: 28px; font-weight: 700; color: var(--fg); }
    .rating-stars { font-size: 18px; color: #f0a500; margin-left: 4px; }
    #reviews-list { flex: 1; overflow-y: auto; padding: 0 16px; }
    .review-item { padding: 14px 0; border-bottom: 1px solid var(--border); }
    .review-top { display: flex; align-items: center; gap: 10px; }
    .review-author { font-weight: 600; }
    .review-date { color: var(--secondary); font-size: 11px; }
    .review-version { color: var(--secondary); font-size: 11px; background: var(--list-hover); padding: 1px 5px; border-radius: 3px; }
    .review-text { margin-top: 8px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .review-helpful { margin-top: 6px; color: var(--secondary); font-size: 11px; }
    #reviews-pagination { padding: 10px 16px; display: flex; justify-content: center; gap: 8px; border-top: 1px solid var(--border); align-items: center; }
    #reviews-total { color: var(--secondary); font-size: 12px; }

    /* 通用 */
    .placeholder { padding: 32px 16px; text-align: center; color: var(--secondary); }
    .loading { padding: 20px; text-align: center; color: var(--secondary); }
    .error-msg { padding: 16px; color: #f44; }
    .page-btn { background: var(--input-bg); color: var(--fg); border: 1px solid var(--border); padding: 3px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; }
    .page-btn:hover:not(:disabled) { background: var(--list-hover); }
    .page-btn:disabled { opacity: 0.4; cursor: default; }
    .page-info { font-size: 12px; color: var(--secondary); }
  </style>
</head>
<body>
  <div id="search-panel">
    <div id="search-bar">
      <input id="search-input" type="text" placeholder="搜索插件名称..." />
      <button id="search-btn">搜索</button>
    </div>
    <div id="search-results">
      <div class="placeholder">输入关键词搜索 VS Code 插件</div>
    </div>
    <div id="search-pagination" style="display:none">
      <button class="page-btn" id="search-prev">上一页</button>
      <span class="page-info" id="search-page-info"></span>
      <button class="page-btn" id="search-next">下一页</button>
    </div>
  </div>

  <div id="reviews-panel">
    <div id="reviews-header">
      <h2 id="reviews-title">选择插件查看评论</h2>
      <div class="header-meta" id="reviews-meta" style="display:none">
        <span><span class="rating-big" id="reviews-avg-rating">-</span><span class="rating-stars" id="reviews-avg-stars"></span></span>
        <span id="reviews-count-label"></span>
        <span id="reviews-total"></span>
      </div>
    </div>
    <div id="reviews-list">
      <div class="placeholder">从左侧选择插件，即可查看 Marketplace 评论</div>
    </div>
    <div id="reviews-pagination" style="display:none">
      <button class="page-btn" id="reviews-prev">上一页</button>
      <span class="page-info" id="reviews-page-info"></span>
      <button class="page-btn" id="reviews-next">下一页</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    let searchState = { query: '', page: 1, total: 0, pageSize: 10 };
    let reviewsState = { publisher: '', name: '', page: 1, total: 0, pageSize: 20 };
    let selectedExtension = null;

    // 搜索事件
    document.getElementById('search-btn').addEventListener('click', doSearch);
    document.getElementById('search-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') doSearch();
    });

    document.getElementById('search-prev').addEventListener('click', () => {
      if (searchState.page > 1) { searchState.page--; doSearch(false); }
    });
    document.getElementById('search-next').addEventListener('click', () => {
      const totalPages = Math.ceil(searchState.total / searchState.pageSize);
      if (searchState.page < totalPages) { searchState.page++; doSearch(false); }
    });

    document.getElementById('reviews-prev').addEventListener('click', () => {
      if (reviewsState.page > 1) { reviewsState.page--; loadReviews(); }
    });
    document.getElementById('reviews-next').addEventListener('click', () => {
      const totalPages = Math.ceil(reviewsState.total / reviewsState.pageSize);
      if (reviewsState.page < totalPages) { reviewsState.page++; loadReviews(); }
    });

    function doSearch(resetPage = true) {
      const q = document.getElementById('search-input').value.trim();
      if (!q) return;
      if (resetPage) searchState.page = 1;
      searchState.query = q;
      vscode.postMessage({ command: 'search', query: q, page: searchState.page });
    }

    function loadReviews() {
      vscode.postMessage({ command: 'loadReviews', publisher: reviewsState.publisher, name: reviewsState.name, page: reviewsState.page });
    }

    function renderStars(rating) {
      return '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));
    }

    function formatDate(dateStr) {
      if (!dateStr) return '';
      return new Date(dateStr).toLocaleDateString('zh-CN');
    }

    function formatNumber(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    }

    // 接收后端消息
    window.addEventListener('message', event => {
      const msg = event.data;
      switch (msg.type) {
        case 'loading':
          if (msg.target === 'search') {
            document.getElementById('search-results').innerHTML = '<div class="loading">搜索中...</div>';
          } else {
            document.getElementById('reviews-list').innerHTML = '<div class="loading">加载评论中...</div>';
          }
          break;

        case 'searchResult':
          searchState = { query: msg.query, page: msg.page, total: msg.total, pageSize: 10 };
          renderSearchResults(msg.extensions);
          updateSearchPagination();
          break;

        case 'selectExtension':
          selectedExtension = msg.extension;
          renderSelectedExtension(msg.extension);
          reviewsState = { publisher: msg.extension.publisherId, name: msg.extension.extensionName, page: 1, total: 0, pageSize: 20 };
          break;

        case 'reviewsResult':
          reviewsState = { publisher: msg.publisher, name: msg.name, page: msg.page, total: msg.totalCount, pageSize: 20 };
          renderReviews(msg.reviews, msg.totalCount);
          updateReviewsPagination();
          break;

        case 'error':
          if (msg.target === 'search') {
            document.getElementById('search-results').innerHTML = '<div class="error-msg">搜索失败: ' + escapeHtml(msg.message) + '</div>';
          } else {
            document.getElementById('reviews-list').innerHTML = '<div class="error-msg">加载评论失败: ' + escapeHtml(msg.message) + '</div>';
          }
          break;
      }
    });

    function escapeHtml(str) {
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function renderSearchResults(extensions) {
      if (!extensions || extensions.length === 0) {
        document.getElementById('search-results').innerHTML = '<div class="placeholder">未找到相关插件</div>';
        return;
      }
      const html = extensions.map(ext => \`
        <div class="ext-item" data-id="\${escapeHtml(ext.extensionId)}" onclick="selectExtension(\${escapeHtml(JSON.stringify(JSON.stringify(ext)))})">
          \${ext.iconUrl
            ? \`<img class="ext-icon" src="\${escapeHtml(ext.iconUrl)}" onerror="this.style.display='none'" />\`
            : \`<div class="ext-icon-placeholder">📦</div>\`
          }
          <div class="ext-info">
            <div class="ext-name" title="\${escapeHtml(ext.displayName)}">\${escapeHtml(ext.displayName)}</div>
            <div class="ext-publisher">\${escapeHtml(ext.publisher)}</div>
            <div class="ext-meta">
              <span class="stars">\${renderStars(ext.averageRating)}</span>
              <span>\${formatNumber(ext.installCount)} 安装</span>
            </div>
          </div>
        </div>
      \`).join('');
      document.getElementById('search-results').innerHTML = html;
    }

    function selectExtension(extJson) {
      const ext = JSON.parse(extJson);
      // 高亮选中项
      document.querySelectorAll('.ext-item').forEach(el => el.classList.remove('selected'));
      const el = document.querySelector(\`.ext-item[data-id="\${ext.extensionId}"]\`);
      if (el) el.classList.add('selected');

      selectedExtension = ext;
      renderSelectedExtension(ext);
      reviewsState = { publisher: ext.publisherId, name: ext.extensionName, page: 1, total: 0, pageSize: 20 };
      vscode.postMessage({ command: 'loadReviews', publisher: ext.publisherId, name: ext.extensionName, page: 1 });
    }

    function renderSelectedExtension(ext) {
      document.getElementById('reviews-title').textContent = ext.displayName;
      document.getElementById('reviews-avg-rating').textContent = ext.averageRating.toFixed(1);
      document.getElementById('reviews-avg-stars').textContent = ' ' + renderStars(ext.averageRating);
      document.getElementById('reviews-count-label').textContent = ext.ratingCount + ' 条评分';
      document.getElementById('reviews-meta').style.display = 'flex';
    }

    function renderReviews(reviews, total) {
      document.getElementById('reviews-total').textContent = '共 ' + total + ' 条评论';
      if (!reviews || reviews.length === 0) {
        document.getElementById('reviews-list').innerHTML = '<div class="placeholder">暂无评论</div>';
        document.getElementById('reviews-pagination').style.display = 'none';
        return;
      }
      const html = reviews.map(r => \`
        <div class="review-item">
          <div class="review-top">
            <span class="stars">\${renderStars(r.rating)}</span>
            <span class="review-author">\${escapeHtml(r.userDisplayName || 'Anonymous')}</span>
            <span class="review-version">\${escapeHtml(r.productVersion || '')}</span>
            <span class="review-date">\${formatDate(r.updatedDate || r.createdDate)}</span>
          </div>
          <div class="review-text">\${escapeHtml(r.text || '(无文字评论)')}</div>
          \${(r.helpfulCount > 0 || r.unhelpfulCount > 0) ? \`<div class="review-helpful">👍 \${r.helpfulCount}  👎 \${r.unhelpfulCount}</div>\` : ''}
        </div>
      \`).join('');
      document.getElementById('reviews-list').innerHTML = html;
    }

    function updateSearchPagination() {
      const total = searchState.total;
      const pageSize = searchState.pageSize;
      const page = searchState.page;
      const totalPages = Math.ceil(total / pageSize);
      const pag = document.getElementById('search-pagination');
      if (total === 0) { pag.style.display = 'none'; return; }
      pag.style.display = 'flex';
      document.getElementById('search-page-info').textContent = \`\${page} / \${totalPages}\`;
      document.getElementById('search-prev').disabled = page <= 1;
      document.getElementById('search-next').disabled = page >= totalPages;
    }

    function updateReviewsPagination() {
      const total = reviewsState.total;
      const pageSize = reviewsState.pageSize;
      const page = reviewsState.page;
      const totalPages = Math.ceil(total / pageSize);
      const pag = document.getElementById('reviews-pagination');
      if (total === 0) { pag.style.display = 'none'; return; }
      pag.style.display = 'flex';
      document.getElementById('reviews-page-info').textContent = \`\${page} / \${totalPages}\`;
      document.getElementById('reviews-prev').disabled = page <= 1;
      document.getElementById('reviews-next').disabled = page >= totalPages;
    }
  </script>
</body>
</html>`;
  }

  dispose() {
    ReviewsPanel.currentPanel = undefined;
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }
}
