const PINECONE_API_URL = 'https://api.pinecone.io/embed';
const PINECONE_MODEL = 'multilingual-e5-large';
const EMBEDDING_DIMENSIONS = 1024;

function getApiKey(): string {
  const key = process.env.PINECONE_API_KEY;
  if (!key) throw new Error('PINECONE_API_KEY environment variable is not set');
  return key;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

async function pineconeEmbed(input: string[]): Promise<number[][]> {
  const response = await fetch(PINECONE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': getApiKey(),
      'X-Pinecone-Api-Version': '2026-04',
    },
    body: JSON.stringify({
      model: PINECONE_MODEL,
      inputs: input.map((text) => ({ text })),
      parameters: {
        input_type: 'passage',
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Pinecone API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.data
    .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
    .map((d: { values: number[] }) => d.values);
}

export const embeddingProvider: EmbeddingProvider = {
  async embed(text: string) {
    const results = await pineconeEmbed([text]);
    return results[0];
  },

  async embedBatch(texts: string[]) {
    if (texts.length === 0) return [];
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < texts.length; i += 96) {
      const batch = texts.slice(i, i + 96);
      const results = await pineconeEmbed(batch);
      allEmbeddings.push(...results);
    }
    return allEmbeddings;
  },
};
