import type { SearchClient } from 'instantsearch.js';

let _client: SearchClient | null = null;

declare global {
  interface Window {
    __searchDebug?: {
      engine: string;
      lastQuery: string;
      lastDurationMs: number;
      lastResultCount: number;
      lastTimestamp: number;
      initMs: number;
      totalMs: number;
    };
  }
}

let _initMs = 0;

function getHitCount(searchResult: unknown): number {
  if (
    typeof searchResult === 'object' &&
    searchResult !== null &&
    'hits' in searchResult &&
    Array.isArray(searchResult.hits)
  ) {
    return searchResult.hits.length;
  }

  return 0;
}

function createDebuggedClient(inner: SearchClient, engineName: string): SearchClient {
  return {
    ...inner,
    search(requests: Parameters<SearchClient['search']>[0]) {
      const t0 = performance.now();
      const firstRequest = requests[0] as unknown as {
        params?: { query?: string };
        query?: string;
      };
      const query = firstRequest?.params?.query || firstRequest?.query || '';
      return inner.search(requests).then((result) => {
        const duration = performance.now() - t0;
        const totalHits = result.results.reduce((sum, searchResult) => sum + getHitCount(searchResult), 0);
        const totalMs = _initMs + duration;
        console.log(`[search] init=${_initMs.toFixed(2)}ms query=${duration.toFixed(2)}ms total=${totalMs.toFixed(2)}ms`);
        if (typeof window !== 'undefined') {
          window.__searchDebug = {
            engine: engineName,
            lastQuery: query,
            lastDurationMs: Math.round(duration * 100) / 100,
            lastResultCount: totalHits,
            lastTimestamp: Date.now(),
            initMs: Math.round(_initMs * 100) / 100,
            totalMs: Math.round(totalMs * 100) / 100,
          };
        }
        return result;
      });
    },
  } as unknown as SearchClient;
}

const mockClient = {
  search(requests: Parameters<SearchClient['search']>[0]) {
    return Promise.resolve({
      results: requests.map((request) => {
        const params = request.params as { query?: string } | undefined;

        return {
          hits: [],
          nbHits: 0,
          page: 0,
          nbPages: 0,
          hitsPerPage: 20,
          processingTimeMS: 0,
          query: params?.query || '',
          params: '',
          index: request.indexName,
        };
      }),
    });
  },
  searchForFacetValues() {
    return Promise.resolve([]);
  },
} as unknown as SearchClient;

export async function getSearchClient(): Promise<SearchClient> {
  if (_client) return _client;

  const t0 = performance.now();
  const engine = process.env.NEXT_PUBLIC_SEARCH_ENGINE;

  if (engine === 'meilisearch') {
    const { instantMeiliSearch } = await import('@meilisearch/instant-meilisearch');
    const host = process.env.NEXT_PUBLIC_MEILI_URL || 'http://localhost:7700';
    const key = process.env.NEXT_PUBLIC_MEILI_SEARCH_KEY || '';
    const { searchClient } = instantMeiliSearch(host, key);
    _client = createDebuggedClient(searchClient as unknown as SearchClient, 'meilisearch');
  } else {
    _client = mockClient;
  }

  _initMs = performance.now() - t0;
  console.log(`[search] init=${_initMs.toFixed(2)}ms`);

  return _client;
}

export function getChronologicalMessageIndexName(): string {
  if (process.env.NEXT_PUBLIC_SEARCH_ENGINE === 'meilisearch') {
    return 'messages:createdAt:desc';
  }

  return 'messages';
}
