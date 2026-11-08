export function createIdGenerator(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}${++next}`;
}
