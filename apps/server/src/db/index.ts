import postgres from 'postgres';

export type Sql = postgres.Sql<{}>;

export function createDb(url: string, max = 10): Sql {
  return postgres(url, {
    max,
    idle_timeout: 30,
    onnotice: () => {},
    types: {
      // Return bigint (int8) as JS number — ids never exceed 2^53 in practice.
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
    },
    transform: { undefined: null },
  });
}
