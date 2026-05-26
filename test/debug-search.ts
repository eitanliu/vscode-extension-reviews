/**
 * 调试文件：验证 displayName 搜索策略修复
 * 运行：npx ts-node test/debug-search.ts（或在集成测试里引用）
 */
import * as https from 'https';

function httpsPost(path: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'marketplace.visualstudio.com', path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json;api-version=7.1-preview.1' },
    }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function searchByFirstWord(displayName: string) {
  const dl = displayName.toLowerCase();
  // 策略：用第一个词搜索，再精确或前缀匹配完整 displayName
  const firstWord = displayName.split(/[\s\-]/)[0];
  const body = JSON.stringify({
    filters: [{ criteria: [
      { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
      { filterType: 10, value: firstWord },
    ], pageNumber: 1, pageSize: 20, sortBy: 4, sortOrder: 0 }],
    flags: 513,
  });
  const raw = await httpsPost('/_apis/public/gallery/extensionquery?api-version=7.1-preview.1', body);
  const exts = JSON.parse(raw)?.results?.[0]?.extensions ?? [];
  const matched = exts.find((e: { displayName: string }) => {
    const edl = e.displayName.toLowerCase();
    return edl === dl || edl.startsWith(dl + ' ') || edl.startsWith(dl + '-') || dl.startsWith(edl);
  });
  return { firstWord, total: exts.length, matched: matched ? `${matched.publisher?.publisherName}.${matched.extensionName} | ${matched.displayName}` : null };
}

// 测试 Continue 和其他几个插件
const testCases = [
  'Continue - open-source AI code agent',
  'Pylance',
  'GitHub Copilot Chat',
  'Prettier - Code formatter',
];

Promise.all(testCases.map(async dn => {
  const r = await searchByFirstWord(dn);
  console.log(`\n[${dn}]`);
  console.log(`  firstWord=${r.firstWord} total=${r.total} matched=${r.matched}`);
})).catch(console.error);
