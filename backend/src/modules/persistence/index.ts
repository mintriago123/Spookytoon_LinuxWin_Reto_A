import { InMemoryPersistenceAdapter, type PersistenceAdapter } from "./adapter.ts";
import { DynamoDbPersistenceAdapter } from "./dynamodb-adapter.ts";
export { DynamoDbPersistenceAdapter, InMemoryPersistenceAdapter };
export type { PersistenceAdapter };

/** Sin tabla explícita o bajo node:test no se hacen llamadas a AWS. Un error AWS real no se oculta. */
export function createPersistenceAdapter(env: NodeJS.ProcessEnv = process.env): PersistenceAdapter {
  if (!env.DYNAMODB_TABLE_NAME?.trim() || env.NODE_ENV === "test" || env.NODE_TEST_CONTEXT) return new InMemoryPersistenceAdapter();
  return new DynamoDbPersistenceAdapter({ region: env.AWS_REGION ?? "us-east-2", tableName: env.DYNAMODB_TABLE_NAME });
}
