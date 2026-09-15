/**
 * sql.js ships its WASM build without type declarations. Tests only need the
 * initializer and the handful of Database methods they call.
 */
declare module 'sql.js/dist/sql-wasm.js' {
  export interface SqlJsDatabase {
    exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => SqlJsDatabase;
  }

  export default function initSqlJs(config?: {
    locateFile?: (file: string) => string;
  }): Promise<SqlJsStatic>;
}
