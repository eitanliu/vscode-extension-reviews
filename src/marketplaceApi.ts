import * as https from 'https';
import { ExtensionInfo, Review, ReviewsResult, SearchResult } from './types';

const MARKETPLACE_API = 'marketplace.visualstudio.com';

function httpsPost(path: string, body: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: MARKETPLACE_API,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(path: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: MARKETPLACE_API,
      path,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function searchExtensions(
  query: string,
  pageNumber: number = 1,
  pageSize: number = 10
): Promise<SearchResult> {
  const body = JSON.stringify({
    filters: [
      {
        criteria: [
          { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
          { filterType: 10, value: query },
        ],
        pageNumber,
        pageSize,
        sortBy: 4, // InstallCount
        sortOrder: 0,
      },
    ],
    flags: 0x200 | 0x1, // IncludeStatistics | IncludeVersions
  });

  const raw = await httpsPost(
    '/_apis/public/gallery/extensionquery?api-version=7.1-preview.1',
    body,
    { Accept: 'application/json;api-version=7.1-preview.1' }
  );

  const json = JSON.parse(raw);
  const results = json?.results?.[0];
  const rawExtensions: unknown[] = results?.extensions ?? [];
  const total: number = results?.resultMetadata?.[0]?.metadataItems?.[0]?.count ?? 0;

  const extensions: ExtensionInfo[] = rawExtensions.map((ext: unknown) => {
    const e = ext as Record<string, unknown>;
    const publisher = e.publisher as Record<string, unknown>;
    const stats: Record<string, number> = {};
    ((e.statistics as unknown[]) ?? []).forEach((s: unknown) => {
      const stat = s as Record<string, unknown>;
      stats[stat.statisticName as string] = stat.value as number;
    });
    const versions = (e.versions as unknown[]) ?? [];
    const latestVersion = versions[0] as Record<string, unknown> | undefined;
    const iconFile = ((latestVersion?.files as unknown[]) ?? []).find((f: unknown) => {
      const file = f as Record<string, unknown>;
      return file.assetType === 'Microsoft.VisualStudio.Services.Icons.Default';
    }) as Record<string, unknown> | undefined;

    return {
      extensionId: e.extensionId as string,
      extensionName: e.extensionName as string,
      displayName: e.displayName as string,
      shortDescription: e.shortDescription as string,
      publisher: publisher?.displayName as string,
      publisherId: publisher?.publisherName as string,
      version: latestVersion?.version as string ?? '',
      installCount: Math.round(stats['install'] ?? 0),
      averageRating: stats['averagerating'] ?? 0,
      ratingCount: Math.round(stats['ratingcount'] ?? 0),
      iconUrl: iconFile?.source as string | undefined,
    };
  });

  return { extensions, total };
}

// 通过 extensionId（publisher.name）精确查找单个扩展
export async function getExtensionById(extensionId: string): Promise<ExtensionInfo | undefined> {
  const body = JSON.stringify({
    filters: [
      {
        criteria: [
          { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
          { filterType: 4, value: extensionId }, // filterType 4 = ExtensionId，精确匹配
        ],
        pageNumber: 1,
        pageSize: 1,
      },
    ],
    flags: 0x200 | 0x1,
  });

  const raw = await httpsPost(
    '/_apis/public/gallery/extensionquery?api-version=7.1-preview.1',
    body,
    { Accept: 'application/json;api-version=7.1-preview.1' }
  );

  const json = JSON.parse(raw);
  const exts: unknown[] = json?.results?.[0]?.extensions ?? [];
  if (exts.length === 0) return undefined;

  const e = exts[0] as Record<string, unknown>;
  const publisher = e.publisher as Record<string, unknown>;
  const stats: Record<string, number> = {};
  ((e.statistics as unknown[]) ?? []).forEach((s: unknown) => {
    const stat = s as Record<string, unknown>;
    stats[stat.statisticName as string] = stat.value as number;
  });
  const versions = (e.versions as unknown[]) ?? [];
  const latestVersion = versions[0] as Record<string, unknown> | undefined;
  const iconFile = ((latestVersion?.files as unknown[]) ?? []).find((f: unknown) => {
    const file = f as Record<string, unknown>;
    return file.assetType === 'Microsoft.VisualStudio.Services.Icons.Default';
  }) as Record<string, unknown> | undefined;

  return {
    extensionId: e.extensionId as string,
    extensionName: e.extensionName as string,
    displayName: e.displayName as string,
    shortDescription: e.shortDescription as string,
    publisher: publisher?.displayName as string,
    publisherId: publisher?.publisherName as string,
    version: latestVersion?.version as string ?? '',
    installCount: Math.round(stats['install'] ?? 0),
    averageRating: stats['averagerating'] ?? 0,
    ratingCount: Math.round(stats['ratingcount'] ?? 0),
    iconUrl: iconFile?.source as string | undefined,
  };
}

export async function getExtensionReviews(
  publisher: string,
  extensionName: string,
  pageNumber: number = 1,
  pageSize: number = 20
): Promise<ReviewsResult> {
  const skip = (pageNumber - 1) * pageSize;
  const path = `/_apis/public/gallery/publishers/${publisher}/extensions/${extensionName}/reviews?count=${pageSize}&filterOptions=0&skip=${skip}&api-version=7.1-preview.1`;

  const raw = await httpsGet(path, { Accept: 'application/json;api-version=7.1-preview.1' });
  const json = JSON.parse(raw);

  const reviews: Review[] = ((json.reviews as unknown[]) ?? []).map((r: unknown) => {
    const rev = r as Record<string, unknown>;
    const userInfo = rev.userDisplayName
      ? { userId: rev.userId as string, userDisplayName: rev.userDisplayName as string }
      : { userId: '', userDisplayName: 'Anonymous' };
    return {
      id: rev.id as string,
      text: rev.text as string,
      rating: rev.rating as number,
      productVersion: rev.productVersion as string,
      createdDate: rev.createdDate as string,
      updatedDate: rev.updatedDate as string,
      userId: userInfo.userId,
      userDisplayName: userInfo.userDisplayName,
      helpfulCount: (rev.helpfulCount as number) ?? 0,
      unhelpfulCount: (rev.unhelpfulCount as number) ?? 0,
    };
  });

  return {
    reviews,
    totalCount: (json.totalReviewCount as number) ?? (json.totalCount as number) ?? reviews.length,
    hasMoreReviews: (json.hasMoreReviews as boolean) ?? (reviews.length >= pageSize),
  };
}
