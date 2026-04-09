import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalQuery } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load queries from the local queries.json file.
 */
export function loadQueries(): EvalQuery[] {
  const raw = readFileSync(join(__dirname, 'queries.json'), 'utf-8');
  return JSON.parse(raw) as EvalQuery[];
}

/**
 * Sync queries to a LangSmith dataset.
 * Skips gracefully if no API key is configured.
 */
export async function syncToLangSmith(queries: EvalQuery[]): Promise<void> {
  if (!process.env.LANGSMITH_API_KEY) {
    console.log('Skipping LangSmith sync (no API key)');
    return;
  }

  try {
    const { Client } = await import('langsmith');
    const client = new Client();

    const dataset = await client
      .createDataset('voxpopuli-evals', {
        description: 'VoxPopuli eval harness queries',
      })
      .catch(async () => {
        // Dataset may already exist — find it instead
        const datasets = client.listDatasets({ datasetName: 'voxpopuli-evals' });
        for await (const ds of datasets) {
          return ds;
        }
        throw new Error('Could not create or find dataset');
      });

    for (const q of queries) {
      await client.createExample(
        { query: q.query, id: q.id },
        { expectedQualities: q.expectedQualities, expectedMinSources: q.expectedMinSources },
        { datasetId: dataset.id },
      );
    }

    console.log(`Synced ${queries.length} queries to LangSmith dataset "${dataset.name}"`);
  } catch (err) {
    console.error('LangSmith sync failed (non-fatal):', err);
  }
}
