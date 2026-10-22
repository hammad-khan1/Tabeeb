declare module 'node:sqlite' {
  export class StatementSync {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  }

  export class DatabaseSync {
    constructor(location: string, options?: { readOnly?: boolean; enableForeignKeyConstraints?: boolean });
    close(): void;
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
  }
}
