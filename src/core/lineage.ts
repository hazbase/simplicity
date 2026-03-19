export function verifyHashLinkedLineage<T, K extends string>(input: {
  entries: T[];
  summarize: (entry: T) => { hash: string };
  getPreviousHash: (entry: T) => string | null | undefined;
  isGenesis: (entry: T) => boolean;
  consistencyChecks?: Record<K, (entry: T, first: T) => boolean>;
}) {
  const entries = [...input.entries];
  if (entries.length === 0) {
    throw new Error("hash-linked lineage requires at least one entry");
  }

  const first = entries[0]!;
  const summaries = entries.map((entry) => input.summarize(entry));
  const startsAtGenesis = input.isGenesis(first);
  const previousHashLinked = entries.every((entry, index) => (
    index === 0
      ? true
      : input.getPreviousHash(entry) === summaries[index - 1]!.hash
  ));

  const consistency = Object.fromEntries(
    Object.entries(input.consistencyChecks ?? {}).map(([label, check]) => [
      label,
      entries.every((entry) => (check as (entry: T, first: T) => boolean)(entry, first)),
    ]),
  ) as Record<K, boolean>;

  const fullLineageVerified = startsAtGenesis
    && previousHashLinked
    && Object.values(consistency).every(Boolean);

  return {
    chainLength: entries.length,
    startsAtGenesis,
    previousHashLinked,
    consistency,
    fullLineageVerified,
    summaries,
  };
}
