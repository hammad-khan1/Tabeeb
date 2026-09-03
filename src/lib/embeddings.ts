const PINECONE_API_URL = 'https://api.pinecone.io/embed';
const PINECONE_MODEL = 'multilingual-e5-large';
const EMBEDDING_DIMENSIONS = 1024;
const MAX_BATCH_SIZE = 96;

function getApiKey(): string {
  const key = process.env.PINECONE_API_KEY;
  if (!key) throw new Error('PINECONE_API_KEY environment variable is not set');
  return key;
}

/**
 * multilingual-e5-large is asymmetric: stored text must be embedded as 'passage' and
 * search text as 'query'. Using one type for both silently degrades every retrieval.
 */
export type EmbeddingInputType = 'query' | 'passage';

export interface EmbeddingProvider {
  embed(text: string, inputType: EmbeddingInputType): Promise<number[]>;
  embedBatch(texts: string[], inputType: EmbeddingInputType): Promise<number[][]>;
}

async function pineconeEmbed(
  inputs: string[],
  inputType: EmbeddingInputType
): Promise<number[][]> {
  const response = await fetch(PINECONE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': getApiKey(),
      'X-Pinecone-Api-Version': '2026-04',
    },
    body: JSON.stringify({
      model: PINECONE_MODEL,
      inputs: inputs.map((text) => ({ text })),
      parameters: {
        input_type: inputType,
        truncate: 'END',
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Pinecone API error (${response.status}): ${err}`);
  }

  const payload = (await response.json()) as { data?: Array<{ values?: number[] }> };
  const data = payload.data;

  if (!Array.isArray(data) || data.length !== inputs.length) {
    throw new Error(
      `Pinecone returned ${data?.length ?? 0} embeddings for ${inputs.length} inputs`
    );
  }

  return data.map((entry, i) => {
    const values = entry.values;
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding ${i} has ${values?.length ?? 0} dimensions, expected ${EMBEDDING_DIMENSIONS}`
      );
    }
    return values;
  });
}

export const embeddingProvider: EmbeddingProvider = {
  async embed(text: string, inputType: EmbeddingInputType) {
    const results = await pineconeEmbed([text], inputType);
    return results[0];
  },

  async embedBatch(texts: string[], inputType: EmbeddingInputType) {
    if (texts.length === 0) return [];
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      allEmbeddings.push(...(await pineconeEmbed(batch, inputType)));
    }
    return allEmbeddings;
  },
};

export { EMBEDDING_DIMENSIONS };
