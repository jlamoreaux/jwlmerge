/**
 * Web Worker for client-side JWL file merging
 * Runs heavy operations in background thread to avoid UI freezing
 * Version: 3.0 - Source-scoped ID remapping, schema-faithful target database
 */

// Import JSZip for ZIP operations
importScripts('https://unpkg.com/jszip@3.10.1/dist/jszip.min.js');
// Import sql.js for SQLite operations
importScripts('https://unpkg.com/sql.js@1.13.0/dist/sql-wasm.js');

let sqlInitialized = false;
let SQL = null;

// Initialize sql.js
async function initSQL() {
  if (sqlInitialized) return SQL;

  SQL = await initSqlJs({
    locateFile: file => `https://unpkg.com/sql.js@1.13.0/dist/${file}`,
  });
  sqlInitialized = true;
  return SQL;
}

// ---------------------------------------------------------------------------
// ID remapping
//
// Every mapping is scoped to the backup it came from. A row from backup B that
// referenced LocationId 4 must follow *B's* LocationId 4, even when backup A
// also renumbered a LocationId 4. One shared map across all sources silently
// re-points one device's notes, tags and highlights at another device's
// content.
// ---------------------------------------------------------------------------

// Map<sourceName, Map<tableName, Map<originalId, newId>>>
const idMappings = new Map();

function resetIdMappings() {
  idMappings.clear();
}

function trackIdMapping(sourceName, tableName, originalId, newId) {
  if (originalId === newId) return;
  if (!idMappings.has(sourceName)) idMappings.set(sourceName, new Map());
  const bySource = idMappings.get(sourceName);
  if (!bySource.has(tableName)) bySource.set(tableName, new Map());
  bySource.get(tableName).set(originalId, newId);
}

function resolveMappedId(sourceName, tableName, originalId) {
  const bySource = idMappings.get(sourceName);
  if (!bySource) return undefined;
  const byTable = bySource.get(tableName);
  if (!byTable) return undefined;
  return byTable.get(originalId);
}

function countIdMappings() {
  let total = 0;
  idMappings.forEach(bySource =>
    bySource.forEach(byTable => {
      total += byTable.size;
    })
  );
  return total;
}

// Foreign key columns per table, so references can be rewritten when the row
// they point at was renumbered or deduplicated.
const FOREIGN_KEYS = {
  BlockRange: { UserMarkId: 'UserMark' },
  UserMark: { LocationId: 'Location' },
  Note: { UserMarkId: 'UserMark', LocationId: 'Location' },
  PlaylistItem: {
    PlaylistItemAccuracyId: 'PlaylistItemAccuracy',
    IndependentMediaId: 'IndependentMedia',
  },
  TagMap: { TagId: 'Tag', PlaylistItemId: 'PlaylistItem', LocationId: 'Location', NoteId: 'Note' },
  // PublicationLocationId is a second, independent reference into Location.
  // Leaving it unmapped re-points bookmarks at whatever publication happens to
  // own that id in the merged file.
  Bookmark: { LocationId: 'Location', PublicationLocationId: 'Location' },
  InputField: { LocationId: 'Location' },
  PlaylistItemMarker: { PlaylistItemId: 'PlaylistItem' },
  PlaylistItemLocationMap: { PlaylistItemId: 'PlaylistItem', LocationId: 'Location' },
  PlaylistItemIndependentMediaMap: {
    PlaylistItemId: 'PlaylistItem',
    IndependentMediaId: 'IndependentMedia',
  },
  PlaylistItemMarkerBibleVerseMap: { PlaylistItemMarkerId: 'PlaylistItemMarker' },
  PlaylistItemMarkerParagraphMap: { PlaylistItemMarkerId: 'PlaylistItemMarker' },
};

// Column sets that identify the same logical record across backups. The first
// matching set wins. Each set is also a UNIQUE constraint in the JW Library
// schema, so a hit means the incoming row cannot be inserted as-is anyway.
// A set is skipped when any of its values is NULL unless allowNull is set,
// because NULL columns would otherwise match unrelated rows.
const IDENTITY_KEYS = {
  UserMark: [{ cols: ['UserMarkGuid'] }],
  Note: [{ cols: ['Guid'] }],
  Tag: [{ cols: ['Type', 'Name'] }],
  IndependentMedia: [{ cols: ['FilePath'] }],
  PlaylistItemAccuracy: [{ cols: ['Description'] }],
  // Two devices bookmarking the same place is one bookmark. Two devices using
  // the same slot for different places is a slot clash, resolved below.
  Bookmark: [{ cols: ['PublicationLocationId', 'LocationId', 'BlockType', 'BlockIdentifier'], allowNull: true }],
  PlaylistItem: [{ cols: ['Label', 'ThumbnailFilePath'], allowNull: true }],
  PlaylistItemMarker: [{ cols: ['PlaylistItemId', 'StartTimeTicks'] }],
  BlockRange: [{ cols: ['UserMarkId', 'BlockType', 'Identifier', 'StartToken', 'EndToken'], allowNull: true }],
  InputField: [{ cols: ['LocationId', 'TextTag'] }],
  PlaylistItemLocationMap: [{ cols: ['PlaylistItemId', 'LocationId'] }],
  PlaylistItemIndependentMediaMap: [{ cols: ['PlaylistItemId', 'IndependentMediaId'] }],
  PlaylistItemMarkerBibleVerseMap: [{ cols: ['PlaylistItemMarkerId', 'VerseId'] }],
  PlaylistItemMarkerParagraphMap: [{ cols: ['PlaylistItemMarkerId', 'ParagraphIndex'] }],
  TagMap: [
    { cols: ['TagId', 'NoteId'] },
    { cols: ['TagId', 'LocationId'] },
    { cols: ['TagId', 'PlaylistItemId'] },
  ],
  grdb_migrations: [{ cols: ['identifier'] }],
};

// ---------------------------------------------------------------------------
// Small SQL helpers
// ---------------------------------------------------------------------------

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function getColumns(db, tableName) {
  const result = db.exec(`PRAGMA table_info(${quoteIdent(tableName)})`);
  if (!result.length || !result[0].values) return [];
  // cid, name, type, notnull, dflt_value, pk
  return result[0].values.map(row => ({
    name: row[1],
    type: row[2] || '',
    notNull: row[3] === 1,
    pk: row[5],
  }));
}

function scalar(db, sql, params) {
  const result = db.exec(sql, params);
  if (!result.length || !result[0].values.length) return undefined;
  return result[0].values[0][0];
}

/**
 * The single-column INTEGER primary key of a table, or null when the table has
 * no such key.
 *
 * Renumbering is only ever safe for a surrogate key. A composite primary key
 * (InputField, PlaylistItemLocationMap, ...) or a primary key that is itself a
 * foreign key must be left alone; arithmetic on those columns silently
 * re-points the row at unrelated content.
 */
function getSurrogateKey(tableName, columns) {
  const pks = columns.filter(col => col.pk > 0);
  if (pks.length !== 1) return null;

  const pk = pks[0];
  if (!/INT/i.test(pk.type)) return null;
  if (FOREIGN_KEYS[tableName] && FOREIGN_KEYS[tableName][pk.name]) return null;

  return pk.name;
}

/** Build a NULL-safe equality lookup using SQLite's IS operator. */
function findExistingRow(targetDb, tableName, keyCols, values, returnColumn) {
  const where = keyCols.map(col => `${quoteIdent(col)} IS ?`).join(' AND ');
  const selection = returnColumn ? quoteIdent(returnColumn) : '1';
  const sql = `SELECT ${selection} FROM ${quoteIdent(tableName)} WHERE ${where} LIMIT 1`;
  const result = targetDb.exec(sql, values);
  if (!result.length || !result[0].values.length) return undefined;
  return result[0].values[0][0];
}

// Create proper constraint signature for Location entries
// Handles the two unique constraints in the Location table correctly
function createLocationConstraintSignature(row, columnNames) {
  const value = name => {
    const index = columnNames.indexOf(name);
    return index === -1 ? null : row[index];
  };

  const type = value('Type');
  const bookNumber = value('BookNumber');
  const chapterNumber = value('ChapterNumber');
  const keySymbol = value('KeySymbol');
  const mepsLanguage = value('MepsLanguage');
  const documentId = value('DocumentId');
  const track = value('Track');
  const issueTagNumber = value('IssueTagNumber');

  // Normalize MepsLanguage: treat NULL and 0 as equivalent
  const normalizedMepsLang = mepsLanguage === null || mepsLanguage === 0 ? '0' : String(mepsLanguage);

  // The Location table has two unique constraints:
  // 1. UNIQUE(BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type) - Bible chapters
  // 2. UNIQUE(KeySymbol, IssueTagNumber, MepsLanguage, DocumentId, Track, Type) - publications
  if (type === 0 && bookNumber !== null && bookNumber !== 0 && chapterNumber !== null && chapterNumber !== 0) {
    return ['bible', bookNumber, chapterNumber, keySymbol || 'NULL', normalizedMepsLang, type].join('|');
  }

  return [
    'pub',
    keySymbol || 'NULL',
    issueTagNumber === null || issueTagNumber === undefined ? 'NULL' : issueTagNumber,
    normalizedMepsLang,
    documentId === null || documentId === undefined ? 'NULL' : documentId,
    track === null || track === undefined ? 'NULL' : track,
    type === null || type === undefined ? 'NULL' : type,
  ].join('|');
}

// Merge media files from all source backups.
//
// Files are identified by (name, content). Two backups that carry byte
// identical media under the same name share one entry. A name reused for
// different content is republished under a new name and the referencing
// IndependentMedia rows are pointed at it, so neither backup loses its media.
async function mergeMediaFiles(databases) {
  const mediaFiles = new Map(); // published filename -> ArrayBuffer
  const hashToName = new Map(); // content hash -> published filename
  const nameToHash = new Map(); // published filename -> content hash
  const filePathRemaps = new Map(); // sourceName -> Map(originalPath -> publishedPath)

  for (const database of databases) {
    const remaps = new Map();
    filePathRemaps.set(database.name, remaps);

    const fileEntries = Object.keys(database.zip.files).filter(
      filename =>
        filename !== 'manifest.json' && filename !== 'userData.db' && !filename.endsWith('/')
    );

    for (const filename of fileEntries) {
      try {
        const fileData = await database.zip.file(filename)?.async('arraybuffer');
        if (!fileData) continue;

        const hashBuffer = await crypto.subtle.digest('SHA-256', fileData);
        const contentHash = Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        const existingName = hashToName.get(contentHash);
        if (existingName) {
          // Identical content already published, possibly under another name.
          if (existingName !== filename) remaps.set(filename, existingName);
          continue;
        }

        let publishedName = filename;
        if (nameToHash.has(filename)) {
          // Same name, different content - publish under a distinct name.
          publishedName = uniqueMediaName(filename, nameToHash, contentHash);
          remaps.set(filename, publishedName);
        }

        mediaFiles.set(publishedName, fileData);
        hashToName.set(contentHash, publishedName);
        nameToHash.set(publishedName, contentHash);
      } catch (error) {
        console.warn(`Failed to process media file ${filename}:`, error.message);
      }
    }
  }

  return { mediaFiles, filePathRemaps };
}

function uniqueMediaName(filename, nameToHash, contentHash) {
  const dot = filename.lastIndexOf('.');
  const slash = filename.lastIndexOf('/');
  const hasExt = dot > slash;
  const stem = hasExt ? filename.slice(0, dot) : filename;
  const ext = hasExt ? filename.slice(dot) : '';
  const suffix = contentHash.substring(0, 8);

  let candidate = `${stem}-${suffix}${ext}`;
  let counter = 1;
  while (nameToHash.has(candidate)) {
    candidate = `${stem}-${suffix}-${counter}${ext}`;
    counter++;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Schema handling
// ---------------------------------------------------------------------------

/**
 * Pick the backup whose schema is a superset of all the others and copy its
 * full schema - tables *and* indexes, triggers and views. Copying only
 * CREATE TABLE statements drops every UNIQUE index the app relies on, which
 * both lets duplicates through the merge and hands JW Library a database that
 * no longer matches the one it wrote.
 */
function buildTargetSchema(targetDb, databases) {
  const donor = databases.reduce((best, candidate) => {
    const bestVersion = best.manifest?.userDataBackup?.schemaVersion ?? 0;
    const candidateVersion = candidate.manifest?.userDataBackup?.schemaVersion ?? 0;
    if (candidateVersion !== bestVersion) return candidateVersion > bestVersion ? candidate : best;
    return countSchemaColumns(candidate.db) > countSchemaColumns(best.db) ? candidate : best;
  }, databases[0]);

  const objects = donor.db.exec(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' " +
      "ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END"
  );

  if (!objects.length || !objects[0].values.length) {
    throw new Error('No tables found in the backup database');
  }

  for (const [type, name, sql] of objects[0].values) {
    try {
      targetDb.exec(sql);
    } catch (error) {
      throw new Error(`Failed to recreate ${type} ${name}: ${error.message}`);
    }
  }

  verifySourceSchemasFit(donor, databases);
  return donor;
}

function countSchemaColumns(db) {
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  if (!tables.length) return 0;
  return tables[0].values.reduce((sum, [name]) => sum + getColumns(db, name).length, 0);
}

/**
 * Every source must fit inside the donor schema. A backup written by a newer
 * JW Library version can carry tables or columns the donor has never heard of;
 * merging it anyway drops that data without telling anyone.
 */
function verifySourceSchemasFit(donor, databases) {
  const donorTables = new Map();
  const tables = donor.db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  if (tables.length) {
    for (const [name] of tables[0].values) {
      donorTables.set(name, new Set(getColumns(donor.db, name).map(col => col.name)));
    }
  }

  for (const database of databases) {
    if (database === donor) continue;

    const sourceTables = database.db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    if (!sourceTables.length) continue;

    for (const [tableName] of sourceTables[0].values) {
      const donorColumns = donorTables.get(tableName);
      if (!donorColumns) {
        throw new Error(
          `${database.name} contains a "${tableName}" table that ${donor.name} does not. ` +
            'These backups were made with incompatible JW Library versions - update the older ' +
            'device and export a fresh backup before merging.'
        );
      }

      const unknown = getColumns(database.db, tableName)
        .map(col => col.name)
        .filter(col => !donorColumns.has(col));

      if (unknown.length) {
        throw new Error(
          `${database.name} has ${tableName} column(s) "${unknown.join('", "')}" that ${donor.name} ` +
            'does not. These backups were made with incompatible JW Library versions - update the ' +
            'older device and export a fresh backup before merging.'
        );
      }
    }
  }
}

// Process merge operation
async function processMerge(files, mergeConfig) {
  // Declared outside the try so the failure path can still close them. When
  // these lived inside the try, the catch block threw "databases is not
  // defined" on every error, no message was ever posted, and the UI waited on
  // a promise that could never settle.
  let databases = [];
  let mergedDb = null;

  try {
    resetIdMappings();

    postMessage({ type: 'progress', message: 'Initializing SQLite engine...', progress: 5 });

    await initSQL();

    postMessage({ type: 'progress', message: 'Loading and validating files...', progress: 10 });

    // Load all JWL files
    const loadedFiles = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      postMessage({
        type: 'progress',
        message: `Loading ${file.name}...`,
        progress: 10 + (i / files.length) * 20,
      });

      try {
        const zip = await JSZip.loadAsync(file.data);
        const manifest = await zip.file('manifest.json')?.async('string');
        const userDataDb = await zip.file('userData.db')?.async('arraybuffer');

        if (!manifest || !userDataDb) {
          throw new Error(`Invalid JWL file: ${file.name} - missing required files`);
        }

        loadedFiles.push({
          name: file.name,
          manifest: JSON.parse(manifest),
          database: userDataDb,
          dataTypes: file.dataTypes || {},
          zip: zip,
        });
      } catch (error) {
        throw new Error(`Failed to load ${file.name}: ${error.message}`);
      }
    }

    if (loadedFiles.length < 2) {
      throw new Error('At least two backup files are required for a merge.');
    }

    // Mappings are keyed by source name, so duplicate names would merge two
    // backups' mappings together and mis-point their foreign keys.
    const uniqueNames = new Set();
    loadedFiles.forEach((file, index) => {
      let name = file.name;
      let counter = 2;
      while (uniqueNames.has(name)) {
        name = `${file.name} (${counter})`;
        counter++;
      }
      uniqueNames.add(name);
      loadedFiles[index].name = name;
    });

    postMessage({ type: 'progress', message: 'Analyzing databases...', progress: 35 });

    // Initialize databases
    databases = loadedFiles.map(file => {
      try {
        return { ...file, db: new SQL.Database(new Uint8Array(file.database)) };
      } catch (error) {
        throw new Error(`Failed to open database in ${file.name}: ${error.message}`);
      }
    });

    postMessage({ type: 'progress', message: 'Creating merged database...', progress: 45 });

    mergedDb = new SQL.Database();
    const donor = buildTargetSchema(mergedDb, databases);

    postMessage({ type: 'progress', message: 'Merging media files...', progress: 50 });

    // Media is merged before IndependentMedia so renamed files can be
    // reflected in the FilePath column the app looks them up by.
    const { mediaFiles, filePathRemaps } = await mergeMediaFiles(databases);

    postMessage({ type: 'progress', message: 'Merging data...', progress: 55 });

    const availableTableNames = donor.db
      .exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0]
      .values.map(row => row[0]);

    const orderedTables = getTableMergeOrder();
    // LastModified holds a single timestamp for the whole backup; it is
    // rewritten once at the end rather than accumulated row by row.
    const skip = new Set(['Location', 'LastModified']);

    const tablesToMerge = orderedTables.filter(
      tableName => availableTableNames.includes(tableName) && !skip.has(tableName)
    );
    tablesToMerge.push(
      ...availableTableNames.filter(
        tableName => !orderedTables.includes(tableName) && !skip.has(tableName)
      )
    );

    let processedTables = 0;
    const totalTables = tablesToMerge.length + (availableTableNames.includes('Location') ? 1 : 0);

    // Every insert would otherwise be its own transaction. Real backups carry
    // tens of thousands of rows, and the per-statement overhead is what makes
    // a merge look like it has hung.
    mergedDb.exec('BEGIN TRANSACTION');
    const temporaryIndexes = createIdentityIndexes(mergedDb);

    // Location first: almost everything else references it.
    if (availableTableNames.includes('Location')) {
      postMessage({
        type: 'progress',
        message: 'Merging Location data...',
        progress: 55 + (processedTables / totalTables) * 30,
      });

      mergeLocationData(mergedDb, databases);
      processedTables++;
    }

    for (const tableName of tablesToMerge) {
      postMessage({
        type: 'progress',
        message: `Merging ${tableName} data...`,
        progress: 55 + (processedTables / totalTables) * 30,
      });

      if (shouldIncludeDataType(tableName, mergeConfig)) {
        mergeTableData(mergedDb, databases, tableName, { filePathRemaps });
      }

      processedTables++;
    }

    if (availableTableNames.includes('LastModified')) {
      writeLastModified(mergedDb, databases);
    }

    // Excluded data types and unresolvable references leave dangling rows
    // behind. JW Library refuses a backup whose foreign keys do not resolve.
    const cleanup = removeDanglingRecords(mergedDb);

    dropIndexes(mergedDb, temporaryIndexes);
    mergedDb.exec('COMMIT');

    postMessage({ type: 'progress', message: 'Creating merged JWL file...', progress: 90 });

    const validationResults = validateMergeIntegrity(mergedDb, cleanup);

    // Export merged database
    const mergedDbData = mergedDb.export();

    // Create new JWL file
    const mergedZip = new JSZip();

    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    // creationDate is a plain calendar date in a JW Library manifest.
    const creationDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timezoneOffset = -now.getTimezoneOffset();
    const offsetSign = timezoneOffset >= 0 ? '+' : '-';
    const lastModifiedDate =
      `${creationDate}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
      `${offsetSign}${pad(Math.floor(Math.abs(timezoneOffset) / 60))}${pad(Math.abs(timezoneOffset) % 60)}`;

    // SHA-256 of the database file, lower-case hex - JW Library verifies this.
    const hashBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array(mergedDbData));
    const hash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // The manifest must describe the database that is actually in the archive.
    // A hard-coded schemaVersion makes JW Library read the file with the wrong
    // schema, which is rejected on import.
    const schemaVersion = donor.manifest?.userDataBackup?.schemaVersion;
    if (typeof schemaVersion !== 'number') {
      throw new Error('Source backups do not declare a schema version; cannot build a valid manifest.');
    }

    const mergedManifest = {
      name: `merged-library-${creationDate}`,
      creationDate: creationDate,
      version: 1,
      type: 0,
      userDataBackup: {
        lastModifiedDate: lastModifiedDate,
        databaseName: 'userData.db',
        deviceName: 'JWL Merge',
        hash: hash,
        schemaVersion: schemaVersion,
      },
    };

    mergedZip.file('manifest.json', JSON.stringify(mergedManifest, null, 2));
    mergedZip.file('userData.db', mergedDbData);

    for (const [filename, fileData] of mediaFiles) {
      mergedZip.file(filename, fileData);
    }

    postMessage({ type: 'progress', message: 'Finalizing file...', progress: 95 });

    const mergedBlob = await mergedZip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      mimeType: 'application/octet-stream',
    });

    postMessage({ type: 'progress', message: 'Complete!', progress: 100 });

    postMessage({
      type: 'success',
      result: {
        blob: mergedBlob,
        fileName: `merged-library-${creationDate}.jwlibrary`,
        stats: {
          filesProcessed: files.length,
          tablesProcessed: processedTables,
          finalSize: mergedBlob.size,
        },
        validation: validationResults,
      },
    });
  } catch (error) {
    postMessage({
      type: 'error',
      error: error.message || 'Unknown error during merge processing',
    });
  } finally {
    databases.forEach(database => {
      try {
        database.db?.close();
      } catch (error) {
        console.warn('Error closing source database:', error.message);
      }
    });
    try {
      mergedDb?.close();
    } catch (error) {
      console.warn('Error closing merged database:', error.message);
    }
  }
}

// Map database tables to the data types the UI exposes. Tables that carry a
// data type's supporting rows are listed against the same id so a disabled
// type does not leave half of itself behind.
const TABLE_DATA_TYPES = {
  Note: ['notes'],
  Bookmark: ['bookmarks'],
  UserMark: ['highlights', 'usermarks'],
  BlockRange: ['highlights', 'usermarks'],
  Tag: ['tags'],
  TagMap: ['tags'],
  InputField: ['inputfields'],
  PlaylistItem: ['playlists'],
  PlaylistItemAccuracy: ['playlists'],
  PlaylistItemMarker: ['playlists'],
  PlaylistItemLocationMap: ['playlists'],
  PlaylistItemIndependentMediaMap: ['playlists'],
  PlaylistItemMarkerBibleVerseMap: ['playlists'],
  PlaylistItemMarkerParagraphMap: ['playlists'],
  IndependentMedia: ['playlists'],
};

// Helper function to determine if a table/data type should be included
function shouldIncludeDataType(tableName, mergeConfig) {
  const dataTypeIds = TABLE_DATA_TYPES[tableName];
  if (!dataTypeIds) return true; // Structural tables are always merged

  const globalDataTypes = mergeConfig && mergeConfig.globalDataTypes;
  if (!globalDataTypes) return true;

  // A data type nobody configured is included. Treating an absent key as
  // "disabled" silently drops the user's notes when the UI and the worker
  // disagree about an id.
  const configured = dataTypeIds.filter(id => id in globalDataTypes);
  if (configured.length === 0) return true;

  return configured.some(id => globalDataTypes[id]);
}

// Define table merge order based on foreign key dependencies
function getTableMergeOrder() {
  // Tables must be merged in dependency order (referenced tables first)
  return [
    // Level 0: No dependencies
    'LastModified',
    'grdb_migrations',
    'PlaylistItemAccuracy',

    // Level 1: Basic reference tables
    'Location',
    'Tag',
    'IndependentMedia',

    // Level 2: Tables that depend on Level 1
    'UserMark', // depends on Location
    'PlaylistItem', // depends on PlaylistItemAccuracy, IndependentMedia
    'Bookmark', // depends on Location

    // Level 3: Tables that depend on Level 2
    'Note', // depends on UserMark, Location
    'BlockRange', // depends on UserMark
    'PlaylistItemMarker', // depends on PlaylistItem
    'PlaylistItemLocationMap', // depends on PlaylistItem, Location
    'PlaylistItemIndependentMediaMap', // depends on PlaylistItem, IndependentMedia

    // Level 4: Tables that depend on Level 3
    'TagMap', // depends on Tag, PlaylistItem, Location, Note
    'PlaylistItemMarkerBibleVerseMap', // depends on PlaylistItemMarker
    'PlaylistItemMarkerParagraphMap', // depends on PlaylistItemMarker

    // Level 5: Input fields (depends on Location)
    'InputField',
  ];
}

// Helper function to get readable location description for logging
function getLocationDescription(row, columnNames) {
  const value = name => {
    const index = columnNames.indexOf(name);
    return index === -1 ? null : row[index];
  };

  const bookNumber = value('BookNumber');
  const chapterNumber = value('ChapterNumber');
  const keySymbol = value('KeySymbol');
  const issueTagNumber = value('IssueTagNumber');

  if (issueTagNumber) return `${keySymbol}/${issueTagNumber}`;
  if (bookNumber && chapterNumber) return `Book ${bookNumber}, Chapter ${chapterNumber} (${keySymbol})`;
  return `${keySymbol || 'Unknown'}`;
}

/**
 * Rewrite every foreign key in a row to follow the rows this source's records
 * were actually merged into. Only this source's mappings are consulted.
 */
function remapForeignKeys(row, tableName, columnNames, sourceName) {
  const fkRelations = FOREIGN_KEYS[tableName];
  if (!fkRelations) return row.slice();

  return row.map((value, index) => {
    const referencedTable = fkRelations[columnNames[index]];
    if (!referencedTable || value === null || value === undefined) return value;

    const mapped = resolveMappedId(sourceName, referencedTable, value);
    return mapped === undefined ? value : mapped;
  });
}

/** Find the row in the target that already represents this incoming row. */
function findIdentityMatch(targetDb, tableName, row, columnNames, surrogateKey) {
  const keySets = IDENTITY_KEYS[tableName];
  if (!keySets) return undefined;

  for (const keySet of keySets) {
    const indexes = keySet.cols.map(col => columnNames.indexOf(col));
    if (indexes.some(index => index === -1)) continue;

    const values = indexes.map(index => row[index]);
    if (!keySet.allowNull && values.some(value => value === null || value === undefined)) continue;

    const existing = findExistingRow(targetDb, tableName, keySet.cols, values, surrogateKey);
    if (existing !== undefined) return existing === null ? true : existing;
  }

  return undefined;
}

/**
 * TagMap enforces UNIQUE(TagId, Position). Two devices independently number
 * their tag assignments from zero, so collisions are the norm rather than a
 * sign of duplication. Move the incoming row to the end of that tag's list
 * instead of dropping the assignment.
 */
function resolveTagMapPosition(targetDb, row, columnNames) {
  const tagIdIndex = columnNames.indexOf('TagId');
  const positionIndex = columnNames.indexOf('Position');
  if (tagIdIndex === -1 || positionIndex === -1) return row;

  const tagId = row[tagIdIndex];
  const position = row[positionIndex];
  if (tagId === null || position === null) return row;

  const taken = findExistingRow(targetDb, 'TagMap', ['TagId', 'Position'], [tagId, position], 'TagMapId');
  if (taken === undefined) return row;

  const maxPosition = scalar(targetDb, 'SELECT MAX(Position) FROM TagMap WHERE TagId IS ?', [tagId]);
  const adjusted = row.slice();
  adjusted[positionIndex] = (maxPosition === null || maxPosition === undefined ? -1 : maxPosition) + 1;
  return adjusted;
}

/**
 * Bookmark enforces UNIQUE(PublicationLocationId, Slot). Devices number their
 * bookmark slots independently, so a clash between two different bookmarks in
 * the same publication is expected. Move the incoming one to a free slot
 * rather than discarding the user's bookmark.
 */
function resolveBookmarkSlot(targetDb, row, columnNames) {
  const publicationIndex = columnNames.indexOf('PublicationLocationId');
  const slotIndex = columnNames.indexOf('Slot');
  if (publicationIndex === -1 || slotIndex === -1) return row;

  const publicationId = row[publicationIndex];
  const slot = row[slotIndex];
  if (publicationId === null || slot === null) return row;

  const taken = findExistingRow(
    targetDb,
    'Bookmark',
    ['PublicationLocationId', 'Slot'],
    [publicationId, slot],
    'BookmarkId'
  );
  if (taken === undefined) return row;

  const maxSlot = scalar(targetDb, 'SELECT MAX(Slot) FROM Bookmark WHERE PublicationLocationId IS ?', [
    publicationId,
  ]);
  const adjusted = row.slice();
  adjusted[slotIndex] = (maxSlot === null || maxSlot === undefined ? -1 : maxSlot) + 1;
  return adjusted;
}

/**
 * Holistic Location merge.
 * Phase 1: global duplicate detection across every backup.
 * Phase 2: insert unique content, resolving LocationId collisions.
 */
function mergeLocationData(targetDb, sourceDatabases) {
  const allLocations = [];
  const globalContentMap = new Map(); // content signature -> first occurrence

  for (const database of sourceDatabases) {
    try {
      const data = database.db.exec('SELECT * FROM Location ORDER BY LocationId');
      if (!data.length || !data[0].values) continue;

      const columnNames = getColumns(database.db, 'Location').map(col => col.name);
      const idIndex = columnNames.indexOf('LocationId');

      for (const row of data[0].values) {
        const locationInfo = {
          row,
          columnNames,
          sourceName: database.name,
          originalLocationId: row[idIndex],
          contentSignature: createLocationConstraintSignature(row, columnNames),
        };

        allLocations.push(locationInfo);
        if (!globalContentMap.has(locationInfo.contentSignature)) {
          globalContentMap.set(locationInfo.contentSignature, locationInfo);
        }
      }
    } catch (error) {
      console.warn(`Could not read Location table from ${database.name}:`, error.message);
    }
  }

  const usedLocationIds = new Set();
  let insertedCount = 0;
  let duplicateCount = 0;

  for (const locationInfo of allLocations) {
    const { row, columnNames, sourceName, originalLocationId, contentSignature } = locationInfo;
    const firstOccurrence = globalContentMap.get(contentSignature);

    if (firstOccurrence !== locationInfo) {
      const survivingId = firstOccurrence.finalLocationId;
      if (survivingId === undefined) {
        console.warn(`Location ${originalLocationId} from ${sourceName} has no surviving duplicate; skipping`);
        continue;
      }
      trackIdMapping(sourceName, 'Location', originalLocationId, survivingId);
      duplicateCount++;
      continue;
    }

    const idColumnIndex = columnNames.indexOf('LocationId');
    const adjustedRow = row.slice();
    let finalLocationId = originalLocationId;

    if (usedLocationIds.has(originalLocationId)) {
      let candidate = originalLocationId;
      while (usedLocationIds.has(candidate)) candidate++;
      finalLocationId = candidate;
      adjustedRow[idColumnIndex] = candidate;
      trackIdMapping(sourceName, 'Location', originalLocationId, candidate);
    }

    const columnList = columnNames.map(quoteIdent).join(',');
    const placeholders = columnNames.map(() => '?').join(',');
    targetDb.exec(`INSERT INTO Location (${columnList}) VALUES (${placeholders})`, adjustedRow);

    const inserted = findExistingRow(targetDb, 'Location', ['LocationId'], [finalLocationId], 'LocationId');
    if (inserted === undefined) {
      throw new Error(
        `Failed to insert Location ${getLocationDescription(adjustedRow, columnNames)} from ${sourceName}`
      );
    }

    usedLocationIds.add(finalLocationId);
    locationInfo.finalLocationId = finalLocationId;
    insertedCount++;
  }

  console.log(`Location merge complete: ${insertedCount} inserted, ${duplicateCount} duplicates mapped`);
}

/**
 * Merge one table from every source into the target.
 *
 * Order matters and is the source of most of the damage a naive merge does:
 *   1. rewrite foreign keys, so duplicate checks compare merged-world values
 *   2. look for an existing row with the same identity, and map onto it
 *   3. only then resolve a primary key collision
 *   4. insert, and record the mapping once the insert is known to have landed
 */
function mergeTableData(targetDb, sourceDatabases, tableName, options = {}) {
  const { filePathRemaps } = options;

  const targetColumns = getColumns(targetDb, tableName);
  if (!targetColumns.length) return;

  const targetColumnNames = new Set(targetColumns.map(col => col.name));
  const surrogateKey = getSurrogateKey(tableName, targetColumns);

  for (const database of sourceDatabases) {
    const sourceName = database.name;

    try {
      const sourceColumns = getColumns(database.db, tableName)
        .map(col => col.name)
        .filter(col => targetColumnNames.has(col));

      if (!sourceColumns.length) continue;

      const columnList = sourceColumns.map(quoteIdent).join(',');
      const data = database.db.exec(`SELECT ${columnList} FROM ${quoteIdent(tableName)}`);
      if (!data.length || !data[0].values) continue;

      const idIndex = surrogateKey ? sourceColumns.indexOf(surrogateKey) : -1;
      const placeholders = sourceColumns.map(() => '?').join(',');
      const insertSql = `INSERT INTO ${quoteIdent(tableName)} (${columnList}) VALUES (${placeholders})`;

      for (const sourceRow of data[0].values) {
        try {
          let row = remapForeignKeys(sourceRow, tableName, sourceColumns, sourceName);

          if (tableName === 'IndependentMedia' && filePathRemaps) {
            row = applyMediaPathRemap(row, sourceColumns, filePathRemaps.get(sourceName));
          }

          const originalId = idIndex === -1 ? undefined : sourceRow[idIndex];

          // 2. Same record, already merged from another backup.
          const existing = findIdentityMatch(targetDb, tableName, row, sourceColumns, surrogateKey);
          if (existing !== undefined) {
            if (originalId !== undefined && typeof existing === 'number') {
              trackIdMapping(sourceName, tableName, originalId, existing);
            }
            continue;
          }

          if (tableName === 'TagMap') {
            row = resolveTagMapPosition(targetDb, row, sourceColumns);
          } else if (tableName === 'Bookmark') {
            row = resolveBookmarkSlot(targetDb, row, sourceColumns);
          }

          // 3. Distinct record that happens to reuse a primary key.
          let finalId = originalId;
          if (surrogateKey && idIndex !== -1) {
            const taken = findExistingRow(targetDb, tableName, [surrogateKey], [originalId], surrogateKey);
            if (taken !== undefined) {
              finalId = nextAvailableId(targetDb, tableName, surrogateKey);
              row = row.slice();
              row[idIndex] = finalId;
            }
          }

          // A plain INSERT throws on a constraint violation rather than
          // dropping the row, so reaching the next line means it landed.
          targetDb.exec(insertSql, row);

          // 4. Record the mapping only once the row is actually there.
          if (surrogateKey && idIndex !== -1) {
            trackIdMapping(sourceName, tableName, originalId, finalId);
          }
        } catch (error) {
          console.warn(`Failed to insert row in ${tableName} from ${sourceName}:`, error.message);
        }
      }
    } catch (error) {
      console.warn(`Error merging ${tableName} from ${sourceName}:`, error.message);
    }
  }
}

function applyMediaPathRemap(row, columnNames, remaps) {
  if (!remaps || remaps.size === 0) return row;

  const pathIndex = columnNames.indexOf('FilePath');
  if (pathIndex === -1) return row;

  const remapped = remaps.get(row[pathIndex]);
  if (remapped === undefined) return row;

  const adjusted = row.slice();
  adjusted[pathIndex] = remapped;
  return adjusted;
}

/**
 * Duplicate detection looks rows up by their identity columns once per
 * incoming row. Several of those column sets carry no index in the JW Library
 * schema - BlockRange's especially - which turns each lookup into a full table
 * scan and a merge of two real backups into minutes of work. Index them for
 * the duration of the merge and drop the indexes again afterwards, so the
 * database that ships still matches the schema JW Library wrote.
 */
function createIdentityIndexes(targetDb) {
  const created = [];

  for (const [tableName, keySets] of Object.entries(IDENTITY_KEYS)) {
    const columns = new Set(getColumns(targetDb, tableName).map(col => col.name));
    if (!columns.size) continue;

    keySets.forEach((keySet, index) => {
      if (keySet.cols.some(col => !columns.has(col))) return;

      const indexName = `jwlmerge_tmp_${tableName}_${index}`;
      try {
        targetDb.exec(
          `CREATE INDEX IF NOT EXISTS ${quoteIdent(indexName)} ON ${quoteIdent(tableName)} ` +
            `(${keySet.cols.map(quoteIdent).join(',')})`
        );
        created.push(indexName);
      } catch (error) {
        console.warn(`Could not index ${tableName} for duplicate detection:`, error.message);
      }
    });
  }

  return created;
}

function dropIndexes(targetDb, indexNames) {
  for (const indexName of indexNames) {
    try {
      targetDb.exec(`DROP INDEX IF EXISTS ${quoteIdent(indexName)}`);
    } catch (error) {
      console.warn(`Could not drop temporary index ${indexName}:`, error.message);
    }
  }
}

function nextAvailableId(targetDb, tableName, idColumn) {
  const maxId = scalar(targetDb, `SELECT MAX(${quoteIdent(idColumn)}) FROM ${quoteIdent(tableName)}`);
  return (maxId === null || maxId === undefined ? 0 : maxId) + 1;
}

/**
 * LastModified holds one timestamp describing the whole backup. Accumulating a
 * row per source leaves a table JW Library reads a single value from.
 */
function writeLastModified(targetDb, sourceDatabases) {
  let latest = null;

  for (const database of sourceDatabases) {
    try {
      const value = scalar(database.db, 'SELECT MAX(LastModified) FROM LastModified');
      if (value && (latest === null || value > latest)) latest = value;
    } catch (error) {
      console.warn(`Could not read LastModified from ${database.name}:`, error.message);
    }
  }

  try {
    targetDb.exec('DELETE FROM LastModified');
    targetDb.exec('INSERT INTO LastModified (LastModified) VALUES (?)', [
      latest || new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    ]);
  } catch (error) {
    console.warn('Could not write LastModified:', error.message);
  }
}

/**
 * Drop or detach rows whose foreign keys do not resolve. A reference that
 * survived unmapped - because its data type was excluded, or its target could
 * not be merged - makes JW Library reject the whole backup.
 */
function removeDanglingRecords(targetDb) {
  const summary = { deleted: 0, detached: 0 };

  // Deleting a row can orphan rows that reference it, and the rule covering
  // those may already have run. Repeat until a pass changes nothing.
  for (let pass = 0; pass < 10; pass++) {
    const before = summary.deleted + summary.detached;
    danglingPass(targetDb, summary);
    if (summary.deleted + summary.detached === before) break;
  }

  return summary;
}

function danglingPass(targetDb, summary) {
  const idColumnFor = table => {
    const columns = getColumns(targetDb, table);
    const pk = columns.filter(col => col.pk > 0);
    return pk.length === 1 ? pk[0].name : null;
  };

  for (const [tableName, relations] of Object.entries(FOREIGN_KEYS)) {
    const columns = getColumns(targetDb, tableName);
    if (!columns.length) continue;

    for (const [columnName, referencedTable] of Object.entries(relations)) {
      const column = columns.find(col => col.name === columnName);
      if (!column) continue;

      const referencedId = idColumnFor(referencedTable);
      if (!referencedId) continue;

      const dangling =
        `${quoteIdent(columnName)} IS NOT NULL AND NOT EXISTS ` +
        `(SELECT 1 FROM ${quoteIdent(referencedTable)} t WHERE t.${quoteIdent(referencedId)} = ` +
        `${quoteIdent(tableName)}.${quoteIdent(columnName)})`;

      try {
        const affected = scalar(
          targetDb,
          `SELECT COUNT(*) FROM ${quoteIdent(tableName)} WHERE ${dangling}`
        );
        if (!affected) continue;

        if (column.notNull) {
          // The row cannot exist without its target.
          targetDb.exec(`DELETE FROM ${quoteIdent(tableName)} WHERE ${dangling}`);
          summary.deleted += affected;
          console.warn(`Removed ${affected} ${tableName} row(s) referencing a missing ${referencedTable}`);
        } else {
          // Optional link: keep the record, drop the broken reference.
          targetDb.exec(
            `UPDATE ${quoteIdent(tableName)} SET ${quoteIdent(columnName)} = NULL WHERE ${dangling}`
          );
          summary.detached += affected;
          console.warn(`Cleared ${affected} ${tableName}.${columnName} reference(s) to a missing ${referencedTable}`);
        }
      } catch (error) {
        console.warn(`Could not clean ${tableName}.${columnName}:`, error.message);
      }
    }
  }
}

// Data integrity validation function
function validateMergeIntegrity(targetDb, cleanup) {
  const results = {
    orphanedReferences: 0,
    duplicateLocations: 0,
    totalMappings: countIdMappings(),
    removedRows: cleanup ? cleanup.deleted : 0,
    detachedReferences: cleanup ? cleanup.detached : 0,
    counts: {},
  };

  try {
    // Every declared foreign key must resolve.
    for (const [tableName, relations] of Object.entries(FOREIGN_KEYS)) {
      const columns = getColumns(targetDb, tableName);
      if (!columns.length) continue;

      for (const [columnName, referencedTable] of Object.entries(relations)) {
        if (!columns.some(col => col.name === columnName)) continue;

        const referencedColumns = getColumns(targetDb, referencedTable).filter(col => col.pk > 0);
        if (referencedColumns.length !== 1) continue;

        const orphaned = scalar(
          targetDb,
          `SELECT COUNT(*) FROM ${quoteIdent(tableName)} WHERE ${quoteIdent(columnName)} IS NOT NULL ` +
            `AND NOT EXISTS (SELECT 1 FROM ${quoteIdent(referencedTable)} t ` +
            `WHERE t.${quoteIdent(referencedColumns[0].name)} = ${quoteIdent(tableName)}.${quoteIdent(columnName)})`
        );

        if (orphaned) {
          results.orphanedReferences += orphaned;
          console.error(`${orphaned} ${tableName}.${columnName} reference(s) point at a missing ${referencedTable}`);
        }
      }
    }

    // No two Location rows may share a unique-constraint signature.
    const locations = targetDb.exec('SELECT * FROM Location');
    if (locations.length && locations[0].values) {
      const columnNames = getColumns(targetDb, 'Location').map(col => col.name);
      const seen = new Set();
      for (const row of locations[0].values) {
        const signature = createLocationConstraintSignature(row, columnNames);
        if (seen.has(signature)) results.duplicateLocations++;
        seen.add(signature);
      }
      if (results.duplicateLocations) {
        console.error(`${results.duplicateLocations} duplicate Location entries survived the merge`);
      }
    }

    for (const tableName of ['Location', 'UserMark', 'Note', 'Bookmark', 'Tag', 'TagMap', 'InputField']) {
      const count = scalar(targetDb, `SELECT COUNT(*) FROM ${quoteIdent(tableName)}`);
      if (count !== undefined) results.counts[tableName] = count;
    }

    console.log('Merge statistics:', JSON.stringify(results));
  } catch (error) {
    console.error('Error during integrity validation:', error.message);
  }

  return results;
}

// Handle messages from main thread
self.onmessage = async function (e) {
  const { type, files, mergeConfig } = e.data;

  if (type !== 'merge') return;

  try {
    await processMerge(files, mergeConfig);
  } catch (error) {
    // Nothing may escape this handler: an unhandled rejection posts no message
    // and leaves the caller waiting on a promise that never settles.
    postMessage({
      type: 'error',
      error: error && error.message ? error.message : 'Unknown error during merge processing',
    });
  }
};
