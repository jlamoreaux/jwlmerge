/**
 * End-to-end tests for public/workers/merge-worker.js.
 *
 * These build real .jwlibrary archives with real SQLite databases and run the
 * shipped worker source against them, so the assertions describe what a user
 * actually gets back rather than what a hand-written mock does.
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { describe, test, expect } from 'bun:test';
import JSZip from 'jszip';
import initSqlJs from 'sql.js/dist/sql-wasm.js';

const WORKER_PATH = new URL('../public/workers/merge-worker.js', import.meta.url).pathname;
const SQL_DIST = new URL('../node_modules/sql.js/dist/', import.meta.url).pathname;

/** Realistic subset of the JW Library userData.db schema. */
const SCHEMA = `
CREATE TABLE LastModified (LastModified TEXT NOT NULL);
CREATE TABLE Location (
  LocationId INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  BookNumber INTEGER, ChapterNumber INTEGER, DocumentId INTEGER, Track INTEGER,
  IssueTagNumber INTEGER NOT NULL DEFAULT 0, KeySymbol TEXT, MepsLanguage INTEGER,
  Type INTEGER NOT NULL, Title TEXT,
  UNIQUE (BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type),
  UNIQUE (KeySymbol, IssueTagNumber, MepsLanguage, DocumentId, Track, Type)
);
CREATE TABLE UserMark (
  UserMarkId INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  ColorIndex INTEGER NOT NULL, LocationId INTEGER NOT NULL, StyleIndex INTEGER NOT NULL,
  UserMarkGuid TEXT NOT NULL, Version INTEGER NOT NULL,
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId), UNIQUE (UserMarkGuid)
);
CREATE TABLE BlockRange (
  BlockRangeId INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  BlockType INTEGER NOT NULL, Identifier INTEGER NOT NULL, StartToken INTEGER, EndToken INTEGER,
  UserMarkId INTEGER NOT NULL, FOREIGN KEY(UserMarkId) REFERENCES UserMark(UserMarkId)
);
CREATE TABLE Note (
  NoteId INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, Guid TEXT NOT NULL,
  UserMarkId INTEGER, LocationId INTEGER, Title TEXT, Content TEXT,
  LastModified TEXT NOT NULL, Created TEXT NOT NULL, BlockType INTEGER NOT NULL DEFAULT 0,
  BlockIdentifier INTEGER,
  FOREIGN KEY(UserMarkId) REFERENCES UserMark(UserMarkId),
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId), UNIQUE (Guid)
);
CREATE TABLE Tag (
  TagId INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, Type INTEGER NOT NULL,
  Name TEXT NOT NULL, UNIQUE (Type, Name)
);
CREATE TABLE TagMap (
  TagMapId INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, PlaylistItemId INTEGER, LocationId INTEGER,
  NoteId INTEGER, TagId INTEGER NOT NULL, Position INTEGER NOT NULL,
  FOREIGN KEY(TagId) REFERENCES Tag(TagId), FOREIGN KEY(NoteId) REFERENCES Note(NoteId),
  UNIQUE (TagId, Position), UNIQUE (TagId, NoteId), UNIQUE (TagId, LocationId)
);
CREATE TABLE Bookmark (
  BookmarkId INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, LocationId INTEGER NOT NULL,
  PublicationLocationId INTEGER NOT NULL, Slot INTEGER NOT NULL, Title TEXT NOT NULL,
  Snippet TEXT, BlockType INTEGER NOT NULL DEFAULT 0, BlockIdentifier INTEGER,
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId), UNIQUE (PublicationLocationId, Slot)
);
CREATE TABLE InputField (
  LocationId INTEGER NOT NULL, TextTag TEXT NOT NULL, Value TEXT NOT NULL,
  FOREIGN KEY(LocationId) REFERENCES Location(LocationId), PRIMARY KEY (LocationId, TextTag)
);
CREATE TABLE IndependentMedia (
  IndependentMediaId INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, OriginalFilename TEXT,
  FilePath TEXT NOT NULL, MimeType TEXT NOT NULL, Hash TEXT, UNIQUE (FilePath)
);
CREATE INDEX IX_Note_LocationId ON Note(LocationId);
CREATE UNIQUE INDEX IX_UserMark_Guid ON UserMark(UserMarkGuid);
`;

/** Assert a value the test setup guarantees, with a message when it is not there. */
function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${what} to be present`);
  }
  return value;
}

const ALL_DATA_TYPES = {
  notes: true,
  bookmarks: true,
  highlights: true,
  tags: true,
  usermarks: true,
  inputfields: true,
  playlists: true,
};

type SqlDatabase = {
  exec: (sql: string, params?: unknown[]) => Array<{ values: unknown[][] }>;
  export: () => Uint8Array;
  close: () => void;
};

let sqlPromise: Promise<{ Database: new (data?: Uint8Array) => SqlDatabase }> | null = null;
/** Initialise sql.js once and share it; loading the WASM per test is slow. */
function getSql() {
  if (!sqlPromise) {
    sqlPromise = (initSqlJs as (config: object) => Promise<never>)({
      locateFile: (file: string) => SQL_DIST + file,
    });
  }
  return sqlPromise;
}

/** Build a .jwlibrary archive around the rows a test cares about. */
async function buildBackup(options: {
  deviceName: string;
  statements: string[];
  media?: Record<string, string>;
  schemaVersion?: number;
}): Promise<ArrayBuffer> {
  const SQL = await getSql();
  const db = new SQL.Database();
  db.exec(SCHEMA);
  options.statements.forEach(statement => db.exec(statement));
  const data = Buffer.from(db.export());
  db.close();

  const zip = new JSZip();
  zip.file(
    'manifest.json',
    JSON.stringify({
      name: options.deviceName,
      creationDate: '2026-09-01',
      version: 1,
      type: 0,
      userDataBackup: {
        lastModifiedDate: '2026-09-01T10:00:00+0000',
        databaseName: 'userData.db',
        deviceName: options.deviceName,
        hash: createHash('sha256').update(data).digest('hex'),
        schemaVersion: options.schemaVersion ?? 14,
      },
    })
  );
  zip.file('userData.db', data);
  for (const [path, contents] of Object.entries(options.media ?? {})) {
    zip.file(path, contents);
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

type WorkerMessage = { type: string; error?: string; result?: { blob: Blob; validation: unknown } };

/**
 * Run the shipped worker source in a simulated DedicatedWorkerGlobalScope.
 * importScripts is stubbed because the libraries it fetches from the CDN are
 * the same ones installed locally.
 */
async function runWorker(
  files: Array<{ name: string; data: ArrayBuffer; dataTypes: Record<string, boolean> }>,
  mergeConfig: { globalDataTypes: Record<string, boolean> }
): Promise<WorkerMessage> {
  let settle: (message: WorkerMessage) => void;
  const done = new Promise<WorkerMessage>(resolve => {
    settle = resolve;
  });

  const sandbox: Record<string, unknown> = {
    console: { log() {}, warn() {}, error() {} },
    crypto: globalThis.crypto,
    JSZip,
    initSqlJs,
    importScripts: () => {},
    postMessage: (message: WorkerMessage) => {
      if (message.type === 'success' || message.type === 'error') {settle(message);}
    },
    setTimeout,
    clearTimeout,
    Promise,
    Uint8Array,
    Blob,
    TextDecoder,
    TextEncoder,
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const source = readFileSync(WORKER_PATH, 'utf8').replace(
    /https:\/\/unpkg\.com\/sql\.js@1\.13\.0\/dist\//g,
    SQL_DIST
  );
  vm.runInContext(source, sandbox, { filename: 'merge-worker.js' });

  const onmessage = sandbox.self as { onmessage: (e: { data: unknown }) => Promise<void> };
  // A worker that throws instead of posting leaves the UI waiting forever, so
  // the test treats an escaped rejection as a failure rather than hanging.
  await Promise.race([
    onmessage.onmessage({ data: { type: 'merge', files, mergeConfig } }).catch((error: Error) => {
      settle({ type: 'escaped', error: `worker threw without posting a message: ${error.message}` });
    }),
    done,
  ]);

  return done;
}

/** Merge the given backups and open the resulting database for inspection. */
async function merge(
  backups: Array<{ name: string; data: ArrayBuffer }>,
  dataTypes: Record<string, boolean> = ALL_DATA_TYPES
) {
  const message = await runWorker(
    backups.map(backup => ({ ...backup, dataTypes })),
    { globalDataTypes: dataTypes }
  );

  if (message.type !== 'success') {
    return { ok: false as const, error: message.error ?? 'unknown error' };
  }

  const merged = required(message.result, 'a merge result');
  const zip = await JSZip.loadAsync(await merged.blob.arrayBuffer());
  const manifest = JSON.parse(
    await required(zip.file('manifest.json'), 'manifest.json in the merged archive').async('string')
  );
  const dbBytes = await required(zip.file('userData.db'), 'userData.db in the merged archive').async(
    'nodebuffer'
  );

  const SQL = await getSql();
  const db = new SQL.Database(new Uint8Array(dbBytes));
  const rows = (sql: string): unknown[][] => {
    const result = db.exec(sql);
    return result.length ? required(result[0], 'a result set').values : [];
  };
  const count = (sql: string): number => Number(rows(sql)[0]?.[0] ?? 0);

  return {
    ok: true as const,
    manifest,
    dbBytes,
    entries: Object.keys(zip.files),
    validation: merged.validation,
    rows,
    count,
    close: () => db.close(),
  };
}

// Two devices whose ids overlap: A's LocationId 1 is a Bible chapter, B's
// LocationId 1 is a magazine, and B's LocationId 2 is the same Bible chapter A
// already has. This is the ordinary case when one person backs up two devices.
const DEVICE_A = [
  'INSERT INTO LastModified VALUES (\'2026-09-01T10:00:00Z\')',
  `INSERT INTO Location (LocationId,BookNumber,ChapterNumber,DocumentId,Track,IssueTagNumber,KeySymbol,MepsLanguage,Type,Title)
   VALUES (1,40,1,NULL,NULL,0,'nwtsty',0,0,'Matthew 1'),
          (2,NULL,NULL,1102024050,NULL,20240200,'w',0,0,'Watchtower 2024 No.2')`,
  'INSERT INTO UserMark VALUES (1,1,1,0,\'AAAA-0001\',1),(2,3,2,0,\'SHARED-GUID\',1)',
  'INSERT INTO BlockRange VALUES (1,2,5,0,12,1),(2,2,9,0,20,2)',
  'INSERT INTO Note VALUES (1,\'NOTE-A1\',1,1,\'Matt 1 thought\',\'Genealogy\',\'2026-09-01T10:00:00Z\',\'2026-08-01T10:00:00Z\',2,5)',
  'INSERT INTO Tag VALUES (1,1,\'Research\'),(2,1,\'Study\')',
  'INSERT INTO TagMap VALUES (1,NULL,NULL,1,1,0)',
  'INSERT INTO Bookmark VALUES (1,1,2,0,\'Matthew 1\',\'In the beginning\',0,NULL)',
  'INSERT INTO InputField VALUES (2,\'tf1\',\'Answer from device A\')',
  'INSERT INTO IndependentMedia VALUES (1,\'clip.mp4\',\'media/clip.mp4\',\'video/mp4\',\'hashA\')',
];

const DEVICE_B = [
  'INSERT INTO LastModified VALUES (\'2026-09-05T12:00:00Z\')',
  `INSERT INTO Location (LocationId,BookNumber,ChapterNumber,DocumentId,Track,IssueTagNumber,KeySymbol,MepsLanguage,Type,Title)
   VALUES (1,NULL,NULL,1102025050,NULL,20250500,'w',0,0,'Watchtower 2025 No.5'),
          (2,40,1,NULL,NULL,0,'nwtsty',0,0,'Matthew 1')`,
  'INSERT INTO UserMark VALUES (1,5,1,0,\'BBBB-0001\',1),(2,3,2,0,\'SHARED-GUID\',1)',
  'INSERT INTO BlockRange VALUES (1,2,3,0,8,1),(2,2,9,0,20,2)',
  'INSERT INTO Note VALUES (1,\'NOTE-B1\',1,1,\'W25 thought\',\'Study article\',\'2026-09-05T12:00:00Z\',\'2026-09-02T10:00:00Z\',2,3)',
  'INSERT INTO Tag VALUES (1,1,\'Study\'),(2,1,\'Preaching\')',
  'INSERT INTO TagMap VALUES (1,NULL,NULL,1,2,0)',
  'INSERT INTO Bookmark VALUES (1,2,1,0,\'Watchtower 2025\',\'Study article\',0,NULL)',
  'INSERT INTO InputField VALUES (1,\'tf1\',\'Answer from device B\')',
  'INSERT INTO IndependentMedia VALUES (1,\'clip.mp4\',\'media/clip.mp4\',\'video/mp4\',\'hashB\')',
];

/** The two overlapping backups most tests merge. */
async function twoDevices() {
  return [
    { name: 'deviceA.jwlibrary', data: await buildBackup({ deviceName: 'Device A', statements: DEVICE_A }) },
    { name: 'deviceB.jwlibrary', data: await buildBackup({ deviceName: 'Device B', statements: DEVICE_B }) },
  ];
}

describe('merge worker: overlapping backups from two devices', () => {
  test('keeps every record and points each one at its own content', async () => {
    const result = await merge(await twoDevices());
    expect(result.ok).toBe(true);
    if (!result.ok) {return;}

    // Matthew 1 exists in both backups and must collapse to one row; the two
    // magazines are different content and must both survive.
    expect(result.count('SELECT COUNT(*) FROM Location')).toBe(3);

    // The highlight both devices share (SHARED-GUID) collapses; the two
    // device-specific highlights survive.
    expect(result.count('SELECT COUNT(*) FROM UserMark')).toBe(3);

    // Device B's highlight must keep pointing at the 2025 magazine, not at
    // whatever row inherited its original LocationId.
    const [markB] = result.rows(
      'SELECT l.Title FROM UserMark u JOIN Location l USING(LocationId) WHERE u.UserMarkGuid = \'BBBB-0001\''
    );
    expect(markB?.[0]).toBe('Watchtower 2025 No.5');

    // Device B's note must stay attached to device B's highlight.
    const [noteB] = result.rows(
      `SELECT u.UserMarkGuid, l.Title FROM Note n
       JOIN UserMark u USING(UserMarkId) JOIN Location l ON l.LocationId = n.LocationId
       WHERE n.Guid = 'NOTE-B1'`
    );
    expect(noteB?.[0]).toBe('BBBB-0001');
    expect(noteB?.[1]).toBe('Watchtower 2025 No.5');

    // Each device's tag assignment keeps its own tag name.
    const tagged = result.rows(
      'SELECT n.Guid, t.Name FROM TagMap m JOIN Tag t USING(TagId) JOIN Note n USING(NoteId) ORDER BY n.Guid'
    );
    expect(tagged).toEqual([
      ['NOTE-A1', 'Research'],
      ['NOTE-B1', 'Preaching'],
    ]);

    // Bookmarks reference two separate Location columns; both must be mapped.
    const [bookmarkB] = result.rows(
      `SELECT loc.Title, pub.Title FROM Bookmark b
       JOIN Location loc ON loc.LocationId = b.LocationId
       JOIN Location pub ON pub.LocationId = b.PublicationLocationId
       WHERE b.Title = 'Watchtower 2025'`
    );
    expect(bookmarkB).toEqual(['Matthew 1', 'Watchtower 2025 No.5']);

    // InputField's primary key is (LocationId, TextTag): LocationId is a
    // foreign key and must never be renumbered arithmetically.
    const inputs = result.rows(
      'SELECT l.Title, i.Value FROM InputField i JOIN Location l USING(LocationId) ORDER BY i.Value'
    );
    expect(inputs).toEqual([
      ['Watchtower 2024 No.2', 'Answer from device A'],
      ['Watchtower 2025 No.5', 'Answer from device B'],
    ]);

    // The shared highlight's block range appears in both backups once.
    expect(result.count('SELECT COUNT(*) FROM BlockRange')).toBe(3);

    result.close();
  });

  test('leaves no dangling foreign keys or duplicate locations', async () => {
    const result = await merge(await twoDevices());
    expect(result.ok).toBe(true);
    if (!result.ok) {return;}

    expect(result.validation).toMatchObject({ orphanedReferences: 0, duplicateLocations: 0 });
    result.close();
  });

  test('produces a manifest that describes the database it ships', async () => {
    const result = await merge(await twoDevices());
    expect(result.ok).toBe(true);
    if (!result.ok) {return;}

    // JW Library verifies this hash and reads the database with the declared
    // schema version, so neither may be invented.
    expect(result.manifest.userDataBackup.hash).toBe(
      createHash('sha256').update(result.dbBytes).digest('hex')
    );
    expect(result.manifest.userDataBackup.schemaVersion).toBe(14);
    expect(result.manifest.userDataBackup.databaseName).toBe('userData.db');
    expect(result.manifest.creationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // LastModified describes the backup as a whole - one row, newest wins.
    expect(result.count('SELECT COUNT(*) FROM LastModified')).toBe(1);
    expect(result.rows('SELECT LastModified FROM LastModified')[0]?.[0]).toBe('2026-09-05T12:00:00Z');

    result.close();
  });

  test('carries the source schema across, indexes included', async () => {
    const result = await merge(await twoDevices());
    expect(result.ok).toBe(true);
    if (!result.ok) {return;}

    const indexes = result
      .rows("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
      .map(row => row[0]);
    expect(indexes).toContain('IX_Note_LocationId');
    expect(indexes).toContain('IX_UserMark_Guid');

    result.close();
  });
});

describe('merge worker: unique-constraint clashes', () => {
  test('keeps both bookmarks when two devices used the same slot', async () => {
    const [a, b] = await twoDevices();
    const result = await merge([
      { name: 'deviceA.jwlibrary', data: required(a, 'device A backup').data },
      { name: 'deviceB.jwlibrary', data: required(b, 'device B backup').data },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) {return;}

    // Device A bookmarks Matthew 1 inside the 2024 magazine at slot 0; device B
    // bookmarks it inside the 2025 magazine, also at slot 0. Different
    // publications, so no clash - both keep slot 0.
    expect(result.count('SELECT COUNT(*) FROM Bookmark')).toBe(2);

    // Now a genuine clash: a third backup bookmarks a different place in the
    // publication device A already used slot 0 for.
    const third = await buildBackup({
      deviceName: 'Device C',
      statements: [
        'INSERT INTO LastModified VALUES (\'2026-09-06T12:00:00Z\')',
        `INSERT INTO Location (LocationId,BookNumber,ChapterNumber,DocumentId,Track,IssueTagNumber,KeySymbol,MepsLanguage,Type,Title)
         VALUES (1,41,2,NULL,NULL,0,'nwtsty',0,0,'Mark 2'),
                (2,NULL,NULL,1102024050,NULL,20240200,'w',0,0,'Watchtower 2024 No.2')`,
        'INSERT INTO Bookmark VALUES (1,1,2,0,\'Mark 2\',\'A different place\',0,NULL)',
      ],
    });

    const clash = await merge([
      { name: 'deviceA.jwlibrary', data: required(a, 'device A backup').data },
      { name: 'deviceC.jwlibrary', data: third },
    ]);
    expect(clash.ok).toBe(true);
    if (!clash.ok) {return;}

    const bookmarks = clash.rows(
      `SELECT b.Title, b.Slot, pub.Title FROM Bookmark b
       JOIN Location pub ON pub.LocationId = b.PublicationLocationId ORDER BY b.Slot`
    );
    expect(bookmarks).toEqual([
      ['Matthew 1', 0, 'Watchtower 2024 No.2'],
      ['Mark 2', 1, 'Watchtower 2024 No.2'],
    ]);

    clash.close();
    result.close();
  });
});

describe('merge worker: repeated merges', () => {
  test('merging a backup with a copy of itself changes nothing', async () => {
    const data = await buildBackup({ deviceName: 'Device A', statements: DEVICE_A });
    const result = await merge([
      { name: 'a.jwlibrary', data },
      { name: 'a-copy.jwlibrary', data },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) {return;}

    expect(result.count('SELECT COUNT(*) FROM Location')).toBe(2);
    expect(result.count('SELECT COUNT(*) FROM UserMark')).toBe(2);
    expect(result.count('SELECT COUNT(*) FROM BlockRange')).toBe(2);
    expect(result.count('SELECT COUNT(*) FROM Note')).toBe(1);
    expect(result.count('SELECT COUNT(*) FROM Tag')).toBe(2);
    expect(result.count('SELECT COUNT(*) FROM TagMap')).toBe(1);
    expect(result.count('SELECT COUNT(*) FROM Bookmark')).toBe(1);
    expect(result.count('SELECT COUNT(*) FROM InputField')).toBe(1);
    expect(result.count('SELECT COUNT(*) FROM IndependentMedia')).toBe(1);

    result.close();
  });

  test('two backups that share a filename keep separate id mappings', async () => {
    const [a, b] = await twoDevices();
    const result = await merge([
      { name: 'userData.jwlibrary', data: required(a, 'device A backup').data },
      { name: 'userData.jwlibrary', data: required(b, 'device B backup').data },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) {return;}

    expect(result.validation).toMatchObject({ orphanedReferences: 0 });
    expect(result.count('SELECT COUNT(*) FROM Location')).toBe(3);
    const [markB] = result.rows(
      'SELECT l.Title FROM UserMark u JOIN Location l USING(LocationId) WHERE u.UserMarkGuid = \'BBBB-0001\''
    );
    expect(markB?.[0]).toBe('Watchtower 2025 No.5');

    result.close();
  });
});

describe('merge worker: media files', () => {
  test('republishes clashing media under distinct names and repoints the database', async () => {
    const backups = [
      {
        name: 'deviceA.jwlibrary',
        data: await buildBackup({
          deviceName: 'Device A',
          statements: DEVICE_A,
          media: { 'media/clip.mp4': 'contents from device A' },
        }),
      },
      {
        name: 'deviceB.jwlibrary',
        data: await buildBackup({
          deviceName: 'Device B',
          statements: DEVICE_B,
          media: { 'media/clip.mp4': 'different contents from device B' },
        }),
      },
    ];

    const result = await merge(backups);
    expect(result.ok).toBe(true);
    if (!result.ok) {return;}

    // Both files survive under distinct names...
    const mediaEntries = result.entries.filter(name => name.startsWith('media/') && !name.endsWith('/'));
    expect(mediaEntries).toHaveLength(2);

    // ...and every IndependentMedia row points at a file that is in the archive.
    const paths = result.rows('SELECT FilePath FROM IndependentMedia').map(row => String(row[0]));
    expect(paths).toHaveLength(2);
    paths.forEach(path => expect(result.entries).toContain(path));

    result.close();
  });

  test('identical media stored under one name is not duplicated', async () => {
    const backups = [
      {
        name: 'deviceA.jwlibrary',
        data: await buildBackup({
          deviceName: 'Device A',
          statements: DEVICE_A,
          media: { 'media/clip.mp4': 'same bytes' },
        }),
      },
      {
        name: 'deviceB.jwlibrary',
        data: await buildBackup({
          deviceName: 'Device B',
          statements: DEVICE_B,
          media: { 'media/clip.mp4': 'same bytes' },
        }),
      },
    ];

    const result = await merge(backups);
    expect(result.ok).toBe(true);
    if (!result.ok) {return;}

    expect(
      result.entries.filter(name => name.startsWith('media/') && !name.endsWith('/'))
    ).toEqual(['media/clip.mp4']);
    expect(result.count('SELECT COUNT(*) FROM IndependentMedia')).toBe(1);

    result.close();
  });
});

describe('merge worker: failure reporting', () => {
  test('reports an error instead of leaving the caller waiting', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ name: 'broken' }));
    const broken = await zip.generateAsync({ type: 'nodebuffer' });

    const [a] = await twoDevices();
    const message = await runWorker(
      [
        { name: 'deviceA.jwlibrary', data: required(a, 'device A backup').data, dataTypes: ALL_DATA_TYPES },
        {
          name: 'broken.jwlibrary',
          data: broken.buffer.slice(broken.byteOffset, broken.byteOffset + broken.byteLength) as ArrayBuffer,
          dataTypes: ALL_DATA_TYPES,
        },
      ],
      { globalDataTypes: ALL_DATA_TYPES }
    );

    expect(message.type).toBe('error');
    expect(message.error).toContain('broken.jwlibrary');
  });

  test('carries a newer backup\'s extra tables through the merge', async () => {
    const [a] = await twoDevices();
    const newer = await buildBackup({
      deviceName: 'Device C',
      statements: [
        ...DEVICE_B,
        'CREATE TABLE FutureFeature (FutureFeatureId INTEGER PRIMARY KEY, Value TEXT)',
        'INSERT INTO FutureFeature VALUES (1,\'data a merge must not silently drop\')',
      ],
      schemaVersion: 15,
    });

    // The newer backup becomes the schema donor, so its extra table survives.
    const result = await merge([
      { name: 'old.jwlibrary', data: required(a, 'device A backup').data },
      { name: 'new.jwlibrary', data: newer },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) {return;}

    expect(result.manifest.userDataBackup.schemaVersion).toBe(15);
    expect(result.count('SELECT COUNT(*) FROM FutureFeature')).toBe(1);

    result.close();
  });

  test('refuses backups whose schemas cannot both fit in one file', async () => {
    // Neither backup is a superset of the other, so merging either way would
    // drop data. Say so rather than shipping a lossy file.
    const one = await buildBackup({
      deviceName: 'Device C',
      statements: [
        ...DEVICE_A,
        'CREATE TABLE FeatureOne (FeatureOneId INTEGER PRIMARY KEY, Value TEXT)',
        'INSERT INTO FeatureOne VALUES (1,\'from one\')',
      ],
      schemaVersion: 15,
    });
    const two = await buildBackup({
      deviceName: 'Device D',
      statements: [
        ...DEVICE_B,
        'CREATE TABLE FeatureTwo (FeatureTwoId INTEGER PRIMARY KEY, Value TEXT)',
        'INSERT INTO FeatureTwo VALUES (1,\'from two\')',
      ],
      schemaVersion: 14,
    });

    const message = await runWorker(
      [
        { name: 'one.jwlibrary', data: one, dataTypes: ALL_DATA_TYPES },
        { name: 'two.jwlibrary', data: two, dataTypes: ALL_DATA_TYPES },
      ],
      { globalDataTypes: ALL_DATA_TYPES }
    );

    expect(message.type).toBe('error');
    expect(message.error).toContain('FeatureTwo');
    expect(message.error).toContain('incompatible JW Library versions');
  });
});

describe('merge worker: data type selection', () => {
  test('excluding notes leaves no dangling tag assignments behind', async () => {
    const result = await merge(await twoDevices(), { ...ALL_DATA_TYPES, notes: false });
    expect(result.ok).toBe(true);
    if (!result.ok) {return;}

    expect(result.count('SELECT COUNT(*) FROM Note')).toBe(0);
    expect(result.count('SELECT COUNT(*) FROM TagMap WHERE NoteId IS NOT NULL')).toBe(0);
    expect(result.validation).toMatchObject({ orphanedReferences: 0 });

    result.close();
  });

  test('excluding highlights removes everything that hangs off them', async () => {
    const result = await merge(await twoDevices(), { ...ALL_DATA_TYPES, highlights: false, usermarks: false });
    expect(result.ok).toBe(true);
    if (!result.ok) {return;}

    expect(result.count('SELECT COUNT(*) FROM UserMark')).toBe(0);
    // BlockRange.UserMarkId is NOT NULL, so those rows cannot survive...
    expect(result.count('SELECT COUNT(*) FROM BlockRange')).toBe(0);
    // ...while notes are anchored to a Location too, so they keep their text
    // and simply lose the highlight link.
    expect(result.count('SELECT COUNT(*) FROM Note')).toBe(2);
    expect(result.count('SELECT COUNT(*) FROM Note WHERE UserMarkId IS NOT NULL')).toBe(0);
    expect(result.validation).toMatchObject({ orphanedReferences: 0 });

    result.close();
  });

  test('an unrecognised data type id does not silently drop data', async () => {
    // The UI and the worker disagreeing about an id must not wipe a data type.
    const result = await merge(await twoDevices(), { somethingElse: true });
    expect(result.ok).toBe(true);
    if (!result.ok) {return;}

    expect(result.count('SELECT COUNT(*) FROM Note')).toBe(2);
    expect(result.count('SELECT COUNT(*) FROM UserMark')).toBe(3);

    result.close();
  });
});
