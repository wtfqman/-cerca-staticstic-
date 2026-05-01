export const chunkArray = <T>(items: T[], size: number): T[][] => {
  if (size <= 0) {
    throw new Error('Batch size must be greater than zero');
  }

  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

export const mapInBatches = async <T, R>(
  items: T[],
  size: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results: R[] = [];

  for (const chunk of chunkArray(items, size)) {
    const offset = results.length;
    const chunkResults = await Promise.all(chunk.map((item, index) => mapper(item, offset + index)));
    results.push(...chunkResults);
  }

  return results;
};
