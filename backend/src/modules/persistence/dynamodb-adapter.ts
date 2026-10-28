import { createHash, randomUUID } from "node:crypto";
import { gzip, gunzipSync } from "node:zlib";
import { promisify } from "node:util";
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { DEFAULT_AWS_REGION, DEFAULT_DYNAMODB_TABLE, pausedGame, toStoredGame,
  type PersistenceAdapter, type StoredGame } from "./adapter.ts";
import type { Immutable, WorldState } from "../simulator/types.ts";

export interface DocumentTransport { send(command: GetCommand | PutCommand | TransactWriteCommand): Promise<any> }
interface DynamoOptions {
    region?: string; tableName?: string; document?: DocumentTransport;
    describe?: () => Promise<void>; chunkBytes?: number;
}

const latestKey = { PK: "META#LATEST", SK: "SNAPSHOT" };
const compress = promisify(gzip);
/** Un solo escritor. Partes primero; manifiesto y puntero se publican en una transacción. */
export class DynamoDbPersistenceAdapter implements PersistenceAdapter {
  readonly region: string;
  readonly tableName: string;
  private ready = false;
  private readonly raw: DynamoDBClient;
  private readonly document: DocumentTransport;
  private readonly options: DynamoOptions;
  constructor(options: DynamoOptions = {}) {
    this.options = options;
    this.region = options.region ?? process.env.AWS_REGION ?? DEFAULT_AWS_REGION;
    this.tableName = options.tableName ?? process.env.DYNAMODB_TABLE_NAME ?? DEFAULT_DYNAMODB_TABLE;
    if (!this.tableName.trim()) throw new Error("Tabla DynamoDB vacía");
    // Los reintentos los gobierna la cola (1 intento + hasta 3 reintentos).
    this.raw = new DynamoDBClient({ region: this.region, maxAttempts: 1,
      requestHandler: { connectionTimeout: 2_000, requestTimeout: 5_000 } });
    this.document = options.document ?? DynamoDBDocumentClient.from(this.raw, { marshallOptions: { removeUndefinedValues: true } });
  }
  async initialize(): Promise<void> {
    if (this.options.describe) await this.options.describe();
    else {
      const { Table } = await this.raw.send(new DescribeTableCommand({ TableName: this.tableName }));
      if (Table?.TableStatus !== "ACTIVE" || !Table.KeySchema?.some(k => k.AttributeName === "PK" && k.KeyType === "HASH") ||
          !Table.KeySchema?.some(k => k.AttributeName === "SK" && k.KeyType === "RANGE") ||
          !["PK", "SK"].every(name => Table.AttributeDefinitions?.some(a => a.AttributeName === name && a.AttributeType === "S"))) {
        throw new Error("DynamoDB requiere tabla ACTIVE y claves PK (HASH), SK (RANGE)");
      }
    }
    this.ready = true;
  }
  isReady() { return this.ready; }
  async save(world: Immutable<WorldState>): Promise<void> {
    if (!this.ready) throw new Error("DynamoDB no inicializado");
    const state = toStoredGame(world);
    const json = Buffer.from(JSON.stringify(state));
    if (json.length > 16 * 1024 * 1024) throw new Error("Checkpoint excede 16 MiB descomprimidos");
    const bytes = await compress(json);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const key = { PK: `GAME#${world.gameId}`, SK: `TURN#${String(world.turnId).padStart(6, "0")}` };
    const limit = this.options.chunkBytes ?? 256 * 1024;
    if (!Number.isInteger(limit) || limit < 1 || limit > 350 * 1024) throw new Error("Fragmento inválido");
    const revision = randomUUID();
    const parts: string[] = [];
    if (bytes.length > limit) for (let offset = 0; offset < bytes.length; offset += limit) {
      const SK = `${key.SK}#${revision}#PART#${String(parts.length).padStart(6, "0")}`;
      await this.document.send(new PutCommand({ TableName: this.tableName,
        Item: { PK: key.PK, SK, payload: bytes.subarray(offset, offset + limit) } }));
      parts.push(SK);
    }
    const manifest = { ...key, schemaVersion: 1, encoding: "gzip", checksum, parts,
      ...(parts.length ? {} : { payload: bytes }), updatedAt: world.updatedAt };
    if (Buffer.byteLength(JSON.stringify({ ...manifest, payload: undefined })) > 350 * 1024) throw new Error("Manifiesto demasiado grande");
    await this.document.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: this.tableName, Item: manifest } },
      { Put: { TableName: this.tableName, Item: { ...latestKey, gamePK: key.PK, turnSK: key.SK } } },
    ] }));
  }
  async loadLatestPausedGame(): Promise<StoredGame | null> {
    if (!this.ready) throw new Error("DynamoDB no inicializado");
    const get = async (Key: { PK: string; SK: string }) => (await this.document.send(new GetCommand({
      TableName: this.tableName, Key, ConsistentRead: true,
    }))).Item;
    const pointer = await get(latestKey);
    if (!pointer) return null;
    if (typeof pointer.gamePK !== "string" || typeof pointer.turnSK !== "string") throw new Error("Puntero de recuperación inválido");
    const item = await get({ PK: pointer.gamePK, SK: pointer.turnSK });
    if (!item || item.schemaVersion !== 1 || item.encoding !== "gzip" || !Array.isArray(item.parts)) throw new Error("Snapshot incompleto");
    const chunks: Buffer[] = [];
    if (!item.parts.length) {
      if (!(item.payload instanceof Uint8Array)) throw new Error("Snapshot sin contenido");
      chunks.push(Buffer.from(item.payload));
    } else for (const SK of item.parts) {
      if (typeof SK !== "string") throw new Error("Referencia de fragmento inválida");
      const part = await get({ PK: pointer.gamePK, SK });
      if (!(part?.payload instanceof Uint8Array)) throw new Error("Falta un fragmento del snapshot");
      chunks.push(Buffer.from(part.payload));
    }
    const bytes = Buffer.concat(chunks);
    if (createHash("sha256").update(bytes).digest("hex") !== item.checksum) throw new Error("Checksum de snapshot inválido");
    const state = JSON.parse(gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 }).toString("utf8")) as StoredGame;
    if (`GAME#${state.gameId}` !== pointer.gamePK || `TURN#${String(state.turnId).padStart(6, "0")}` !== pointer.turnSK) throw new Error("Identidad de snapshot inválida");
    return pausedGame(state);
  }
  async close() { this.ready = false; this.raw.destroy(); }
}
