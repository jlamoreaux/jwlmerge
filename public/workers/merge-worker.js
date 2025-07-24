/**
 * Web Worker for client-side JWL file merging
 * Runs heavy operations in background thread to avoid UI freezing
 * Version: 2.0 - Holistic Location merge implementation
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
  
  try {
    SQL = await initSqlJs({
      locateFile: file => `https://unpkg.com/sql.js@1.13.0/dist/${file}`
    });
    sqlInitialized = true;
    return SQL;
  } catch (error) {
    postMessage({
      type: 'error',
      error: `Failed to initialize SQLite: ${error.message}`
    });
    throw error;
  }
}

// Merge media files from all source databases, deduplicating by content hash
async function mergeMediaFiles(databases) {
  const mediaFiles = new Map(); // filename -> {data, hash}
  const seenHashes = new Set(); // track content hashes to deduplicate
  
  for (const database of databases) {
    try {
      // Get all files from the ZIP except manifest.json and userData.db
      const fileEntries = Object.keys(database.zip.files).filter(filename => 
        filename !== 'manifest.json' && 
        filename !== 'userData.db' &&
        !filename.endsWith('/') // exclude directories
      );
      
      for (const filename of fileEntries) {
        try {
          const fileData = await database.zip.file(filename)?.async('arraybuffer');
          if (!fileData) continue;
          
          // Generate hash of file content for deduplication
          const hashBuffer = await crypto.subtle.digest('SHA-256', fileData);
          const hashArray = new Uint8Array(hashBuffer);
          const contentHash = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
          
          // Only add if we haven't seen this content before
          if (!seenHashes.has(contentHash)) {
            seenHashes.add(contentHash);
            mediaFiles.set(filename, fileData);
            console.log(`Added media file: ${filename} (${fileData.byteLength} bytes)`);
          } else {
            console.log(`Skipped duplicate media file: ${filename} (content hash: ${contentHash.substring(0, 8)}...)`);
          }
        } catch (error) {
          console.warn(`Failed to process media file ${filename}:`, error.message);
        }
      }
    } catch (error) {
      console.warn(`Failed to extract media files from ${database.name}:`, error.message);
    }
  }
  
  console.log(`Media merge complete: ${mediaFiles.size} unique files from ${databases.length} databases`);
  return mediaFiles;
}

// Create proper constraint signature for Location entries
// Handles the two unique constraints in the Location table correctly
function createLocationConstraintSignature(row, columnNames) {
  const type = row[columnNames.indexOf('Type')];
  const bookNumber = row[columnNames.indexOf('BookNumber')];
  const chapterNumber = row[columnNames.indexOf('ChapterNumber')];
  const keySymbol = row[columnNames.indexOf('KeySymbol')];
  const mepsLanguage = row[columnNames.indexOf('MepsLanguage')];
  const documentId = row[columnNames.indexOf('DocumentId')];
  const track = row[columnNames.indexOf('Track')];
  const issueTagNumber = row[columnNames.indexOf('IssueTagNumber')];
  
  // Normalize MepsLanguage: treat NULL and 0 as equivalent
  const normalizedMepsLang = (mepsLanguage === null || mepsLanguage === 0) ? '0' : String(mepsLanguage);
  
  // Determine which unique constraint applies based on Type and data structure
  // The Location table has two unique constraints:
  // 1. UNIQUE(BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type) - for Bible chapters (Type=0 with BookNumber/ChapterNumber)
  // 2. UNIQUE(KeySymbol, IssueTagNumber, MepsLanguage, DocumentId, Track, Type) - for publications (Type=1 and Type=0 without BookNumber/ChapterNumber)
  
  if (type === 0 && bookNumber !== null && bookNumber !== 0 && chapterNumber !== null && chapterNumber !== 0) {
    // Type 0 with BookNumber/ChapterNumber: Bible chapter - use constraint 1
    return [
      bookNumber,
      chapterNumber,
      keySymbol || 'NULL',
      normalizedMepsLang,
      type || 'NULL'
    ].join('|');
  } else {
    // Type 1 (Bible publications) OR Type 0 without BookNumber/ChapterNumber (publications/documents)
    // Both use constraint 2: UNIQUE(KeySymbol, IssueTagNumber, MepsLanguage, DocumentId, Track, Type)
    return [
      keySymbol || 'NULL',
      issueTagNumber || 'NULL',
      normalizedMepsLang,
      documentId || 'NULL',
      track || 'NULL',
      type || 'NULL'
    ].join('|');
  }
}

// Process merge operation
async function processMerge(files, mergeConfig) {
  try {
    // Clear any previous ID mappings
    idMappings.clear();
    
    // Clear previous debug logs
    // Configuration and table inclusion verified as working correctly
    
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
        progress: 10 + (i / files.length) * 20 
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
          zip: zip
        });
      } catch (error) {
        throw new Error(`Failed to load ${file.name}: ${error.message}`);
      }
    }
    
    postMessage({ type: 'progress', message: 'Analyzing databases...', progress: 35 });
    
    // Initialize databases
    const databases = loadedFiles.map(file => {
      try {
        return {
          ...file,
          db: new SQL.Database(new Uint8Array(file.database))
        };
      } catch (error) {
        throw new Error(`Failed to open database in ${file.name}: ${error.message}`);
      }
    });
    
    postMessage({ type: 'progress', message: 'Creating merged database...', progress: 45 });
    
    // Create new merged database
    const mergedDb = new SQL.Database();
    
    // Get schema from first database
    const firstDb = databases[0].db;
    const tables = firstDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    
    if (tables.length === 0 || !tables[0].values) {
      throw new Error('No tables found in database');
    }
    
    // Create tables in merged database
    for (const [tableName] of tables[0].values) {
      const createTableStmt = firstDb.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName}'`);
      if (createTableStmt.length > 0 && createTableStmt[0].values[0]) {
        mergedDb.exec(createTableStmt[0].values[0][0]);
      }
    }
    
    postMessage({ type: 'progress', message: 'Merging data...', progress: 55 });
    
    // Get all available tables and merge in dependency order
    const availableTableNames = tables[0].values.map(row => row[0]);
    const orderedTables = getTableMergeOrder();
    
    // Filter ordered tables to only include those that exist in the database, EXCLUDING Location
    const tablesToMerge = orderedTables.filter(tableName => 
      availableTableNames.includes(tableName) && tableName !== 'Location'
    );
    
    // Add any tables not in our predefined order (merge them last), EXCLUDING Location
    const unorderedTables = availableTableNames.filter(tableName => 
      !orderedTables.includes(tableName) && tableName !== 'Location'
    );
    tablesToMerge.push(...unorderedTables);
    
    // Process Location table FIRST if it exists and should be included
    let processedTables = 0;
    const totalTables = tablesToMerge.length + (availableTableNames.includes('Location') ? 1 : 0);
    
    if (availableTableNames.includes('Location') && shouldIncludeDataType('Location', mergeConfig)) {
      postMessage({ 
        type: 'progress', 
        message: 'Merging Location data...', 
        progress: 55 + (processedTables / totalTables) * 30 
      });
      
      await mergeLocationData(mergedDb, databases, mergeConfig);
      processedTables++;
    }
    
    // Process all other tables
    for (const tableName of tablesToMerge) {
      postMessage({ 
        type: 'progress', 
        message: `Merging ${tableName} data...`, 
        progress: 55 + (processedTables / totalTables) * 30 
      });
      
      // Check if this data type should be included
      const shouldIncludeTable = shouldIncludeDataType(tableName, mergeConfig);
      
      if (shouldIncludeTable) {
        await mergeTableData(mergedDb, databases, tableName, mergeConfig);
      }
      
      processedTables++;
    }
    
    postMessage({ type: 'progress', message: 'Merging media files...', progress: 85 });
    
    // Merge media files from all source databases
    const mergedMediaFiles = await mergeMediaFiles(databases);
    
    postMessage({ type: 'progress', message: 'Creating merged JWL file...', progress: 90 });
    
    // Export merged database
    const mergedDbData = mergedDb.export();
    
    // Create new JWL file
    const mergedZip = new JSZip();
    
    // Create merged manifest using format from source files
    const now = new Date();
    const dateString = now.toISOString().substring(0, 19); // Keep the T separator
    const timezoneOffset = -now.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(timezoneOffset) / 60);
    const offsetMinutes = Math.abs(timezoneOffset) % 60;
    const offsetSign = timezoneOffset >= 0 ? '+' : '-';
    const formattedDate = `${dateString}${offsetSign}${String(offsetHours).padStart(2, '0')}${String(offsetMinutes).padStart(2, '0')}`;
    
    // Generate SHA-256 hash of the database file
    // Ensure we're hashing the raw database bytes correctly
    const dbBuffer = new Uint8Array(mergedDbData);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dbBuffer);
    const hashArray = new Uint8Array(hashBuffer);
    const hash = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
    
    const mergedManifest = {
      name: `merged-library-${now.toISOString().split('T')[0]}.jwlibrary`,
      creationDate: formattedDate,
      version: 1,
      type: 0,
      userDataBackup: {
        lastModifiedDate: formattedDate,
        databaseName: 'userData.db',
        deviceName: 'JWL Merge',
        hash: hash,
        schemaVersion: 14
      }
    };
    
    mergedZip.file('manifest.json', JSON.stringify(mergedManifest, null, 2));
    mergedZip.file('userData.db', mergedDbData);
    
    // Add merged media files to the ZIP
    for (const [filename, fileData] of mergedMediaFiles) {
      mergedZip.file(filename, fileData);
    }
    
    postMessage({ type: 'progress', message: 'Finalizing file...', progress: 95 });
    
    // Generate final ZIP
    const mergedBlob = await mergedZip.generateAsync({ 
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      mimeType: 'application/octet-stream'
    });
    
    postMessage({ type: 'progress', message: 'Complete!', progress: 100 });
    
    // Run post-merge data integrity validation
    const validationResults = validateMergeIntegrity(mergedDb);
    
    // Send result back to main thread
    postMessage({
      type: 'success',
      result: {
        blob: mergedBlob,
        fileName: `merged-library-${new Date().toISOString().split('T')[0]}.jwlibrary`,
        stats: {
          filesProcessed: files.length,
          tablesProcessed: processedTables,
          finalSize: mergedBlob.size
        },
        validation: validationResults
      }
    });
    
    // Clean up
    databases.forEach(db => {
      try { db.db.close(); } catch (e) { console.warn('Error closing source database:', e.message); }
    });
    try { mergedDb.close(); } catch (e) { console.warn('Error closing merged database:', e.message); }
    
  } catch (error) {
    // Ensure cleanup happens even on error
    databases.forEach(db => {
      try { db.db.close(); } catch (e) { console.warn('Error closing source database during cleanup:', e.message); }
    });
    try { mergedDb.close(); } catch (e) { console.warn('Error closing merged database during cleanup:', e.message); }
    
    postMessage({
      type: 'error',
      error: error.message || 'Unknown error during merge processing'
    });
  }
}

// Helper function to determine if a table/data type should be included
function shouldIncludeDataType(tableName, mergeConfig) {
  // Map database table names to data type IDs
  const tableMap = {
    'Note': 'notes',
    'Bookmark': 'bookmarks', 
    'UserMark': 'highlights',
    'TagMap': 'tags',
    'InputField': 'inputfields',
    'Playlist': 'playlists'
  };
  
  const dataTypeId = tableMap[tableName];
  if (!dataTypeId) {
    // Include unknown tables by default
    return true;
  }
  
  // Check if this data type is enabled in global config
  // If mergeConfig.globalDataTypes is undefined/null, include all data types by default
  if (!mergeConfig.globalDataTypes) {
    return true;
  }
  
  return mergeConfig.globalDataTypes[dataTypeId];
}

// Check if table has GUID-based or composite unique constraints
function isGuidOrCompositeUniqueTable(tableName) {
  const guidOrCompositeTables = [
    'UserMark',      // UserMarkGuid
    'Note',          // Guid
    'Bookmark',      // PublicationLocationId + Slot composite
    'TagMap',        // Multiple UNIQUE constraints (TagId+Position, TagId+NoteId, etc.)
    'Location',      // BookNumber + ChapterNumber + KeySymbol + MepsLanguage + Type + IssueTagNumber composite
    'Tag',           // Type + Name composite
    'PlaylistItem',  // Content-based duplicates (Label + timings)
    'PlaylistItemMarker', // PlaylistItemId + StartTimeTicks composite
    'IndependentMedia',   // FilePath
    'PlaylistItemAccuracy', // Description
    'grdb_migrations'     // identifier
  ];
  
  return guidOrCompositeTables.includes(tableName);
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
    'UserMark',           // depends on Location
    'PlaylistItem',       // depends on PlaylistItemAccuracy, IndependentMedia
    'Bookmark',           // depends on Location
    
    // Level 3: Tables that depend on Level 2
    'Note',               // depends on UserMark, Location
    'BlockRange',         // depends on UserMark
    'PlaylistItemMarker', // depends on PlaylistItem
    'PlaylistItemLocationMap', // depends on PlaylistItem, Location
    'PlaylistItemIndependentMediaMap', // depends on PlaylistItem, IndependentMedia
    
    // Level 4: Tables that depend on Level 3
    'TagMap',             // depends on Tag, PlaylistItem, Location, Note
    'PlaylistItemMarkerBibleVerseMap', // depends on PlaylistItemMarker
    'PlaylistItemMarkerParagraphMap',  // depends on PlaylistItemMarker
    
    // Level 5: Input fields (depends on various tables)
    'InputField'
  ];
}

// Global ID mapping tracker for foreign key updates
const idMappings = new Map(); // Map: tableName -> Map(originalId -> newId)

// Track ID remapping for foreign key updates
function trackIdMapping(tableName, originalId, newId) {
  if (!idMappings.has(tableName)) {
    idMappings.set(tableName, new Map());
  }
  idMappings.get(tableName).set(originalId, newId);
}

// Helper function to get readable location description for logging
function getLocationDescription(row, columnNames) {
  const bookNumberIndex = columnNames.indexOf('BookNumber');
  const chapterNumberIndex = columnNames.indexOf('ChapterNumber');
  const keySymbolIndex = columnNames.indexOf('KeySymbol');
  const issueTagNumberIndex = columnNames.indexOf('IssueTagNumber');
  
  const bookNumber = bookNumberIndex >= 0 ? row[bookNumberIndex] : null;
  const chapterNumber = chapterNumberIndex >= 0 ? row[chapterNumberIndex] : null;
  const keySymbol = keySymbolIndex >= 0 ? row[keySymbolIndex] : null;
  const issueTagNumber = issueTagNumberIndex >= 0 ? row[issueTagNumberIndex] : null;
  
  if (issueTagNumber) {
    return `${keySymbol}/${issueTagNumber}`;
  } else if (bookNumber && chapterNumber) {
    return `Book ${bookNumber}, Chapter ${chapterNumber} (${keySymbol})`;
  } else {
    return `${keySymbol || 'Unknown'}`;
  }
}

// Data integrity validation function
function validateMergeIntegrity(targetDb) {
  console.log('\n=== POST-MERGE DATA INTEGRITY VALIDATION ===');
  
  try {
    // 1. Check for orphaned UserMarks
    const orphanedUserMarks = targetDb.exec(`
      SELECT COUNT(*) FROM UserMark u 
      LEFT JOIN Location l ON u.LocationId = l.LocationId 
      WHERE l.LocationId IS NULL
    `);
    
    const orphanedCount = orphanedUserMarks.length > 0 ? orphanedUserMarks[0].values[0][0] : 0;
    if (orphanedCount > 0) {
      console.error(`🚨 CRITICAL: Found ${orphanedCount} orphaned UserMarks with missing Location references!`);
      
      // Get details of orphaned UserMarks
      const orphanedDetails = targetDb.exec(`
        SELECT u.UserMarkId, u.LocationId FROM UserMark u 
        LEFT JOIN Location l ON u.LocationId = l.LocationId 
        WHERE l.LocationId IS NULL
        LIMIT 10
      `);
      if (orphanedDetails.length > 0) {
        console.error('   Sample orphaned UserMarks:');
        orphanedDetails[0].values.forEach(row => {
          console.error(`     UserMarkId: ${row[0]}, missing LocationId: ${row[1]}`);
        });
      }
    } else {
      console.log('✅ No orphaned UserMarks found');
    }
    
    // 2. Check for orphaned Notes
    const orphanedNotes = targetDb.exec(`
      SELECT COUNT(*) FROM Note n 
      LEFT JOIN Location l ON n.LocationId = l.LocationId 
      WHERE n.LocationId IS NOT NULL AND l.LocationId IS NULL
    `);
    
    const orphanedNotesCount = orphanedNotes.length > 0 ? orphanedNotes[0].values[0][0] : 0;
    if (orphanedNotesCount > 0) {
      console.error(`🚨 CRITICAL: Found ${orphanedNotesCount} orphaned Notes with missing Location references!`);
    } else {
      console.log('✅ No orphaned Notes found');
    }
    
    // 3. Verify Location content integrity using the same constraint handler logic
    const duplicateLocations = targetDb.exec(`
      WITH LocationConstraints AS (
        SELECT LocationId,
               CASE 
                 WHEN Type = 0 AND BookNumber IS NOT NULL AND BookNumber != 0 AND ChapterNumber IS NOT NULL AND ChapterNumber != 0 THEN
                   -- Type 0 Bible chapter - UNIQUE(BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type)
                   BookNumber || '|' || ChapterNumber || '|' || COALESCE(KeySymbol, 'NULL') || '|' || 
                   CASE WHEN MepsLanguage IS NULL OR MepsLanguage = 0 THEN '0' ELSE MepsLanguage END || '|' || Type
                 ELSE
                   -- Type 1 OR Type 0 Publication - UNIQUE(KeySymbol, IssueTagNumber, MepsLanguage, DocumentId, Track, Type)
                   COALESCE(KeySymbol, 'NULL') || '|' || COALESCE(IssueTagNumber, 'NULL') || '|' || 
                   CASE WHEN MepsLanguage IS NULL OR MepsLanguage = 0 THEN '0' ELSE MepsLanguage END || '|' || 
                   COALESCE(DocumentId, 'NULL') || '|' || COALESCE(Track, 'NULL') || '|' || Type
               END as ConstraintSignature
        FROM Location
      )
      SELECT ConstraintSignature, COUNT(*) as count
      FROM LocationConstraints
      GROUP BY ConstraintSignature
      HAVING COUNT(*) > 1
    `);
    
    if (duplicateLocations.length > 0 && duplicateLocations[0].values.length > 0) {
      console.error(`🚨 CRITICAL: Found ${duplicateLocations[0].values.length} duplicate Location entries that should have been merged!`);
      duplicateLocations[0].values.forEach(row => {
        const [constraintSignature, count] = row;
        console.error(`  - Duplicate constraint signature: ${constraintSignature} (${count} entries)`);
      });
    } else {
      console.log('✅ No duplicate Location content found (constraint-aware merge successful)');
    }
    
    // 4. Count statistics
    const locationCount = targetDb.exec('SELECT COUNT(*) FROM Location');
    const userMarkCount = targetDb.exec('SELECT COUNT(*) FROM UserMark');
    const noteCount = targetDb.exec('SELECT COUNT(*) FROM Note');
    
    console.log('\n📊 Merge Statistics:');
    console.log(`   Locations: ${locationCount[0].values[0][0]}`);
    console.log(`   UserMarks: ${userMarkCount[0].values[0][0]}`);
    console.log(`   Notes: ${noteCount[0].values[0][0]}`);
    
    // 5. Check ID mapping statistics
    let totalMappings = 0;
    idMappings.forEach((mappingMap, tableName) => {
      const mappingCount = mappingMap.size;
      if (mappingCount > 0) {
        totalMappings += mappingCount;
        console.log(`   ID Mappings for ${tableName}: ${mappingCount}`);
      }
    });
    console.log(`   Total ID Mappings Created: ${totalMappings}`);
    
    console.log('=== VALIDATION COMPLETE ===\n');
    
    return {
      orphanedUserMarks: orphanedCount,
      orphanedNotes: orphanedNotesCount,
      duplicateLocations: duplicateLocations.length > 0 ? duplicateLocations[0].values.length : 0,
      totalMappings
    };
    
  } catch (error) {
    console.error('❌ Error during integrity validation:', error.message);
    return null;
  }
}

// Update foreign key references based on ID mappings
function updateForeignKeyReferences(row, tableName, columnNames, targetDb) {
  // Define foreign key relationships
  const foreignKeyMappings = {
    'BlockRange': { 'UserMarkId': 'UserMark' },
    'UserMark': { 'LocationId': 'Location' },
    'Note': { 'UserMarkId': 'UserMark', 'LocationId': 'Location' },
    'PlaylistItem': { 'PlaylistItemAccuracyId': 'PlaylistItemAccuracy', 'IndependentMediaId': 'IndependentMedia' },
    'TagMap': { 'TagId': 'Tag', 'PlaylistItemId': 'PlaylistItem', 'LocationId': 'Location', 'NoteId': 'Note' },
    'Bookmark': { 'LocationId': 'Location' },
    'PlaylistItemMarker': { 'PlaylistItemId': 'PlaylistItem' },
    'PlaylistItemLocationMap': { 'PlaylistItemId': 'PlaylistItem', 'LocationId': 'Location' },
    'PlaylistItemIndependentMediaMap': { 'PlaylistItemId': 'PlaylistItem', 'IndependentMediaId': 'IndependentMedia' },
    'PlaylistItemMarkerBibleVerseMap': { 'PlaylistItemMarkerId': 'PlaylistItemMarker' },
    'PlaylistItemMarkerParagraphMap': { 'PlaylistItemMarkerId': 'PlaylistItemMarker' }
  };
  
  const fkRelations = foreignKeyMappings[tableName];
  if (!fkRelations) return row;
  
  return row.map((value, index) => {
    const columnName = columnNames[index];
    const referencedTable = fkRelations[columnName];
    
    if (referencedTable && value !== null) {
      // ALWAYS check for ID mappings first - mappings represent correct semantic linkage
      if (idMappings.has(referencedTable)) {
        const mapping = idMappings.get(referencedTable);
        const newId = mapping.get(value);
        
        if (newId !== undefined) {
          // We have a mapping for this ID - use it (mappings always take priority)
          if (referencedTable === 'Location') {
            console.log(`🔗 FK Update: ${tableName}.${columnName} ${value} → ${newId} (Location mapping)`);
          } else {
            console.log(`🔗 FK Update: ${tableName}.${columnName} ${value} → ${newId} (${referencedTable})`);
          }
          return newId;
        }
      }
      
      // No mapping found - check if original ID exists (and is valid)
      const idColumn = referencedTable === 'UserMark' ? 'UserMarkId' : 
                      referencedTable === 'Note' ? 'NoteId' :
                      referencedTable === 'Tag' ? 'TagId' :
                      referencedTable === 'PlaylistItem' ? 'PlaylistItemId' :
                      referencedTable === 'Location' ? 'LocationId' :
                      referencedTable === 'PlaylistItemMarker' ? 'PlaylistItemMarkerId' :
                      referencedTable === 'PlaylistItemAccuracy' ? 'PlaylistItemAccuracyId' :
                      referencedTable === 'IndependentMedia' ? 'IndependentMediaId' :
                      `${referencedTable}Id`;
      
      try {
        const existsQuery = `SELECT COUNT(*) FROM ${referencedTable} WHERE ${idColumn} = ?`;
        const existsResult = targetDb.exec(existsQuery, [value]);
        const originalIdExists = existsResult.length > 0 && existsResult[0].values[0][0] > 0;
        
        if (originalIdExists) {
          // Original ID exists and no mapping needed, keep it as-is
          return value;
        } else {
          // Original ID doesn't exist and no mapping available - orphaned reference
          console.warn(`⚠️ Orphaned FK reference: ${tableName}.${columnName} = ${value} (${referencedTable} not found)`);
          return value; // Keep original value but it will be orphaned
        }
      } catch (error) {
        console.warn(`Error checking FK reference existence:`, error.message);
        return value;
      }
    }
    
    return value;
  });
}

// Holistic Location merge with two-phase approach:
// Phase 1: Global duplicate detection across ALL databases
// Phase 2: Insert unique content with proper ID conflict resolution
async function mergeLocationData(targetDb, sourceDatabases, mergeConfig) {
  try {
    console.log('🔄 Starting constraint-aware Location merge with global duplicate detection...');
    console.log('✨ CONSTRAINT-AWARE MERGE v2.8 - Fixed ID conflict mapping: track all reassignments!');
    
    // PHASE 1: Collect ALL locations from ALL databases
    const allLocations = [];
    const globalContentMap = new Map(); // content signature -> first occurrence info
    
    for (const database of sourceDatabases) {
      const sourceDb = database.db;
      
      try {
        const data = sourceDb.exec('SELECT * FROM Location ORDER BY LocationId');
        
        if (!data.length || !data[0].values) {
          console.log(`📋 No Location data in ${database.name}`);
          continue;
        }
        
        // Get column names
        const columns = sourceDb.exec('PRAGMA table_info(Location)');
        const columnNames = columns[0].values.map(col => col[1]);
        
        console.log(`📍 Found ${data[0].values.length} locations in ${database.name}`);
        
        for (const row of data[0].values) {
          const locationInfo = {
            row,
            columnNames,
            sourceDb: database.name,
            originalLocationId: row[columnNames.indexOf('LocationId')]
          };
          
          // Create content signature using proper unique constraint logic
          // The Location table has two unique constraints that must be respected:
          // 1. UNIQUE(BookNumber, ChapterNumber, KeySymbol, MepsLanguage, Type) - for Bible chapters
          // 2. UNIQUE(KeySymbol, IssueTagNumber, MepsLanguage, DocumentId, Track, Type) - for publications/documents
          const contentSignature = createLocationConstraintSignature(row, columnNames);
          
          locationInfo.contentSignature = contentSignature;
          allLocations.push(locationInfo);
          
          // Track first occurrence of each unique content
          if (!globalContentMap.has(contentSignature)) {
            globalContentMap.set(contentSignature, locationInfo);
          }
        }
      } catch (error) {
        console.warn(`⚠ Warning: Could not read Location table from ${database.name}:`, error.message);
      }
    }
    
    console.log(`📊 Global analysis: ${allLocations.length} total locations, ${globalContentMap.size} unique content signatures`);
    
    // PHASE 2: Insert unique content and create mappings for duplicates
    const usedLocationIds = new Set();
    let insertedCount = 0;
    let duplicateCount = 0;
    
    for (const locationInfo of allLocations) {
      const { row, columnNames, sourceDb, originalLocationId, contentSignature } = locationInfo;
      const firstOccurrence = globalContentMap.get(contentSignature);
      
      if (firstOccurrence !== locationInfo) {
        // This is a duplicate - map to the first occurrence's final ID
        const firstOccurrenceId = firstOccurrence.finalLocationId || firstOccurrence.originalLocationId;
        
        // Only create ID mapping if the IDs are actually different
        if (originalLocationId !== firstOccurrenceId) {
          trackIdMapping('Location', originalLocationId, firstOccurrenceId);
        }
        
        const keySymbol = row[columnNames.indexOf('KeySymbol')] || 'NULL';
        console.log(`  🔗 Duplicate ${keySymbol} location: ${originalLocationId} (${sourceDb}) → ${firstOccurrenceId}`);
        duplicateCount++;
      } else {
        // This is the first occurrence - insert it with ID conflict resolution
        const idColumnIndex = columnNames.indexOf('LocationId');
        let finalLocationId = originalLocationId;
        let adjustedRow = [...row];
        
        // Check for ID conflicts with previously inserted locations
        if (usedLocationIds.has(originalLocationId)) {
          // Find next available ID
          let newLocationId = originalLocationId;
          while (usedLocationIds.has(newLocationId)) {
            newLocationId++;
          }
          
          finalLocationId = newLocationId;
          adjustedRow[idColumnIndex] = newLocationId;
          
          console.log(`  ⚠️ LocationId conflict: ${originalLocationId} → ${newLocationId} (${sourceDb})`);
        }
        
        // Insert the location
        try {
          const columnNamesCsv = columnNames.join(',');
          const placeholders = columnNames.map(() => '?').join(',');
          const insertQuery = `INSERT INTO Location (${columnNamesCsv}) VALUES (${placeholders})`;
          
          targetDb.exec(insertQuery, adjustedRow);
          
          // Track this ID as used
          usedLocationIds.add(finalLocationId);
          
          // Store final ID back to first occurrence for duplicate mapping
          firstOccurrence.finalLocationId = finalLocationId;
          
          // Create mapping if ID was changed
          if (finalLocationId !== originalLocationId) {
            trackIdMapping('Location', originalLocationId, finalLocationId);
          }
          
          const keySymbol = row[columnNames.indexOf('KeySymbol')] || 'NULL';
          console.log(`  ✅ Inserted ${keySymbol} location: ${originalLocationId} as ${finalLocationId} (${sourceDb})`);
          insertedCount++;
          
        } catch (error) {
          console.error(`❌ Failed to insert Location ${originalLocationId} from ${sourceDb}:`, error.message);
          throw error;
        }
      }
    }
    
    console.log(`✅ Semantic Location merge complete: ${insertedCount} inserted, ${duplicateCount} duplicates mapped`);
    
  } catch (error) {
    console.error('❌ Error in semantic mergeLocationData:', error);
    throw error;
  }
}

// REMOVED: Old KeySymbol-based function replaced by holistic two-phase merge in mergeLocationData

// Merge data from multiple databases into target table
async function mergeTableData(targetDb, sourceDatabases, tableName, mergeConfig) {
  // Location table is handled by specialized mergeLocationData function
  if (tableName === 'Location') {
    console.log('⚠️ Location table should be processed by mergeLocationData, skipping general merge');
    return;
  }
  
  try {
    // Get column information
    const firstDb = sourceDatabases[0].db;
    const columns = firstDb.exec(`PRAGMA table_info(${tableName})`);
    
    if (!columns.length || !columns[0].values) {
      return; // Skip empty tables
    }
    
    const columnNames = columns[0].values.map(col => col[1]); // col[1] is column name
    
    // Find ID column by name patterns
    const idColumnIndex = columnNames.findIndex(name => 
      name === 'Id' || name.endsWith('Id') || name === `${tableName}Id`
    );
    const hasId = idColumnIndex !== -1;
    
    let idOffset = 0;
    
    // Track next available ID for GUID/composite tables to avoid assigning same ID to multiple conflicts
    let nextAvailableId = null;
    if (hasId && isGuidOrCompositeUniqueTable(tableName)) {
      const maxIdQuery = `SELECT MAX(${columnNames[idColumnIndex]}) FROM ${tableName}`;
      const maxResult = targetDb.exec(maxIdQuery);
      const maxId = maxResult.length > 0 && maxResult[0].values.length > 0 ? maxResult[0].values[0][0] : 0;
      nextAvailableId = (maxId || 0) + 1;
    }
    
    // Process each source database
    for (const sourceDb of sourceDatabases) {
      try {
        // Get all data from this table
        const data = sourceDb.db.exec(`SELECT * FROM ${tableName}`);
        
        if (!data.length || !data[0].values) {
          continue; // Skip empty tables
        }
        
        // Insert data with proper duplicate handling
        for (const row of data[0].values) {
          let adjustedRow = row;
          
          // FIRST: Check for content-based duplicates before any ID processing
          // This prevents creating unnecessary ID mappings for content duplicates
          
          // Special handling for Tag content-based duplicates
          if (tableName === 'Tag') {
            const typeIndex = columnNames.indexOf('Type');
            const nameIndex = columnNames.indexOf('Name');
            
            if (typeIndex !== -1 && nameIndex !== -1) {
              const type = row[typeIndex];
              const name = row[nameIndex];
              
              // Check if this Tag content already exists (Type + Name composite)
              try {
                const existing = targetDb.exec(`SELECT TagId FROM Tag WHERE Type = ? AND Name = ?`, [type, name]);
                if (existing.length > 0 && existing[0].values[0]) {
                  const existingTagId = existing[0].values[0][0];
                  const originalTagId = row[idColumnIndex];
                  
                  // Create ID mapping from original ID to existing ID
                  trackIdMapping(tableName, originalTagId, existingTagId);
                  console.log(`Skipping duplicate Tag: Type=${type}, Name="${name}" (mapping ${originalTagId} -> ${existingTagId})`);
                  continue; // Skip this row entirely - ID mapping created
                }
              } catch (error) {
                console.warn(`Error checking Tag duplicate:`, error.message);
              }
            }
          }
          
          // NOTE: Location table is handled by specialized mergeLocationData function
          // No Location-specific processing needed here
          
          // SECOND: Handle ID conflicts for non-duplicate content
          if (hasId) {
            if (isGuidOrCompositeUniqueTable(tableName)) {
              // For GUID tables, check for ID conflicts and reassign if needed
              const originalId = row[idColumnIndex];
              const checkQuery = `SELECT COUNT(*) FROM ${tableName} WHERE ${columnNames[idColumnIndex]} = ?`;
              try {
                const existing = targetDb.exec(checkQuery, [originalId]);
                if (existing.length > 0 && existing[0].values[0][0] > 0) {
                  // ID conflict detected, find truly next available ID
                  let newId = nextAvailableId;
                  
                  // For GUID-based tables, double-check ID availability to prevent silent failures
                  let attempts = 0;
                  while (attempts < 1000) { // Prevent infinite loops
                    const checkNewIdQuery = `SELECT COUNT(*) FROM ${tableName} WHERE ${columnNames[idColumnIndex]} = ?`;
                    const newIdCheck = targetDb.exec(checkNewIdQuery, [newId]);
                    if (newIdCheck.length === 0 || newIdCheck[0].values[0][0] === 0) {
                      break; // ID is available
                    }
                    newId++; // Try next ID
                    attempts++;
                  }
                  
                  if (attempts >= 1000) {
                    console.error(`❌ Could not find available ID for ${tableName} after 1000 attempts, starting from ${nextAvailableId}`);
                  }
                  
                  nextAvailableId = newId + 1; // Update for next potential conflict
                  
                  // Enhanced logging for ID conflict resolution
                  if (tableName === 'Location') {
                    const locationDescription = getLocationDescription(row, columnNames);
                    console.log(`⚠ LocationId conflict detected: ${originalId} already exists`);
                    console.log(`  Content: ${locationDescription}`);
                    console.log(`  Assigning new ID: ${originalId} → ${newId}`);
                  } else if (tableName === 'UserMark') {
                    console.log(`⚠ UserMark ID conflict: ${originalId} → ${newId} (attempting robust ID assignment)`);
                  } else {
                    console.log(`⚠ ${tableName} ID conflict: ${originalId} → ${newId}`);
                  }
                  
                  // Don't create ID mapping yet - wait until after successful insert
                  adjustedRow = row.map((value, index) => 
                    index === idColumnIndex ? newId : value
                  );
                  // Store the mapping info to create after successful insert
                  adjustedRow._pendingIdMapping = { tableName, originalId, newId };
                } else {
                  adjustedRow = row; // No conflict, use original
                  if (tableName === 'Location') {
                    const locationDescription = getLocationDescription(row, columnNames);
                    console.log(`✓ No conflict for Location ${originalId}: ${locationDescription}`);
                  }
                }
              } catch (error) {
                console.warn(`✗ Error checking ID conflict for ${tableName}:`, error.message);
                adjustedRow = row;
              }
            } else {
              // For simple ID tables, apply offset to avoid conflicts
              adjustedRow = row.map((value, index) => 
                index === idColumnIndex ? value + idOffset : value
              );
            }
          }
          
          // Special handling for UserMark GUID-based duplicates
          if (tableName === 'UserMark') {
            const userMarkGuidIndex = columnNames.indexOf('UserMarkGuid');
            
            if (userMarkGuidIndex !== -1) {
              const userMarkGuid = row[userMarkGuidIndex];
              
              // Check if this UserMark GUID already exists
              try {
                const existing = targetDb.exec(`SELECT UserMarkId FROM UserMark WHERE UserMarkGuid = ?`, [userMarkGuid]);
                if (existing.length > 0 && existing[0].values[0]) {
                  const existingUserMarkId = existing[0].values[0][0];
                  console.log(`Skipping duplicate UserMark GUID: ${userMarkGuid} (already exists as UserMarkId ${existingUserMarkId})`);
                  continue; // Skip this row entirely - duplicate detected
                }
              } catch (error) {
                console.warn(`Error checking UserMark duplicate:`, error.message);
              }
            }
          }
          
          // Special handling for Note GUID-based duplicates
          if (tableName === 'Note') {
            const noteGuidIndex = columnNames.indexOf('Guid');
            
            if (noteGuidIndex !== -1) {
              const noteGuid = row[noteGuidIndex];
              
              // Check if this Note GUID already exists
              try {
                const existing = targetDb.exec(`SELECT NoteId FROM Note WHERE Guid = ?`, [noteGuid]);
                if (existing.length > 0 && existing[0].values[0]) {
                  const existingNoteId = existing[0].values[0][0];
                  console.log(`Skipping duplicate Note GUID: ${noteGuid} (already exists as NoteId ${existingNoteId})`);
                  continue; // Skip this row entirely - duplicate detected
                }
              } catch (error) {
                console.warn(`Error checking Note duplicate:`, error.message);
              }
            }
          }
          
          // Special handling for PlaylistItem content-based duplicates (Label + ThumbnailFilePath)
          if (tableName === 'PlaylistItem') {
            const labelIndex = columnNames.indexOf('Label');
            const thumbnailFilePathIndex = columnNames.indexOf('ThumbnailFilePath');
            
            if (labelIndex !== -1) {
              const label = row[labelIndex];
              const thumbnailFilePath = thumbnailFilePathIndex !== -1 ? row[thumbnailFilePathIndex] : null;
              
              // Check if this Label + ThumbnailFilePath combination already exists (JWLMerge logic)
              const checkQuery = `SELECT PlaylistItemId FROM PlaylistItem WHERE Label = ? AND ThumbnailFilePath ${thumbnailFilePath === null ? 'IS NULL' : '= ?'}`;
              const checkParams = [label];
              if (thumbnailFilePath !== null) checkParams.push(thumbnailFilePath);
              
              try {
                const existing = targetDb.exec(checkQuery, checkParams);
                if (existing.length > 0 && existing[0].values[0]) {
                  const existingPlaylistItemId = existing[0].values[0][0];
                  const originalPlaylistItemId = row[idColumnIndex];
                  
                  // Create ID mapping from original ID to existing ID
                  trackIdMapping(tableName, originalPlaylistItemId, existingPlaylistItemId);
                  console.log(`Skipping duplicate PlaylistItem: Label="${label}", ThumbnailFilePath="${thumbnailFilePath}" (mapping ${originalPlaylistItemId} -> ${existingPlaylistItemId})`);
                  continue; // Skip this row entirely - duplicate detected
                }
              } catch (error) {
                console.warn(`Error checking PlaylistItem duplicate:`, error.message);
              }
            }
          }
          
          // Special handling for IndependentMedia FilePath-based duplicates
          if (tableName === 'IndependentMedia') {
            const filePathIndex = columnNames.indexOf('FilePath');
            
            if (filePathIndex !== -1) {
              const filePath = row[filePathIndex];
              
              // Check if this FilePath already exists
              try {
                const existing = targetDb.exec(`SELECT IndependentMediaId FROM IndependentMedia WHERE FilePath = ?`, [filePath]);
                if (existing.length > 0 && existing[0].values[0]) {
                  const existingId = existing[0].values[0][0];
                  const originalId = row[idColumnIndex];
                  
                  // Create ID mapping from original ID to existing ID
                  trackIdMapping(tableName, originalId, existingId);
                  console.log(`Skipping duplicate IndependentMedia FilePath: ${filePath} (mapping ${originalId} -> ${existingId})`);
                  continue; // Skip this row entirely - duplicate detected
                }
              } catch (error) {
                console.warn(`Error checking IndependentMedia duplicate:`, error.message);
              }
            }
          }
          
          // Special handling for PlaylistItemAccuracy Description-based duplicates
          if (tableName === 'PlaylistItemAccuracy') {
            const descriptionIndex = columnNames.indexOf('Description');
            
            if (descriptionIndex !== -1) {
              const description = row[descriptionIndex];
              
              // Check if this Description already exists (UNIQUE constraint)
              try {
                const existing = targetDb.exec(`SELECT PlaylistItemAccuracyId FROM PlaylistItemAccuracy WHERE Description = ?`, [description]);
                if (existing.length > 0 && existing[0].values[0]) {
                  const existingId = existing[0].values[0][0];
                  const originalId = row[idColumnIndex];
                  
                  // Create ID mapping from original ID to existing ID
                  trackIdMapping(tableName, originalId, existingId);
                  console.log(`Skipping duplicate PlaylistItemAccuracy Description: "${description}" (mapping ${originalId} -> ${existingId})`);
                  continue; // Skip this row entirely - duplicate detected
                }
              } catch (error) {
                console.warn(`Error checking PlaylistItemAccuracy duplicate:`, error.message);
              }
            }
          }
          
          // Special handling for Bookmark composite unique constraints
          if (tableName === 'Bookmark') {
            const locationIdIndex = columnNames.indexOf('LocationId');
            const publicationLocationIdIndex = columnNames.indexOf('PublicationLocationId');
            
            if (locationIdIndex !== -1 && publicationLocationIdIndex !== -1) {
              let locationId = adjustedRow[locationIdIndex];
              let publicationLocationId = adjustedRow[publicationLocationIdIndex];
              
              // Apply any Location ID mappings
              if (idMappings.has('Location')) {
                if (idMappings.get('Location').has(locationId)) {
                  const mappedLocationId = idMappings.get('Location').get(locationId);
                  adjustedRow[locationIdIndex] = mappedLocationId;
                  locationId = mappedLocationId;
                  console.log(`Applied Location ID mapping in Bookmark: ${locationId} → ${mappedLocationId}`);
                }
                if (idMappings.get('Location').has(publicationLocationId)) {
                  const mappedPubLocationId = idMappings.get('Location').get(publicationLocationId);
                  adjustedRow[publicationLocationIdIndex] = mappedPubLocationId;
                  publicationLocationId = mappedPubLocationId;
                  console.log(`Applied Publication Location ID mapping in Bookmark: ${publicationLocationId} → ${mappedPubLocationId}`);
                }
              }
              
              // Check if this LocationId + PublicationLocationId combination already exists
              try {
                const existing = targetDb.exec(`SELECT COUNT(*) FROM Bookmark WHERE LocationId = ? AND PublicationLocationId = ?`, [locationId, publicationLocationId]);
                if (existing.length > 0 && existing[0].values[0][0] > 0) {
                  console.log(`Skipping duplicate Bookmark: LocationId=${locationId}, PublicationLocationId=${publicationLocationId}`);
                  continue; // Skip this row entirely - duplicate detected
                }
              } catch (error) {
                console.warn(`Error checking Bookmark duplicate:`, error.message);
              }
            }
          }
          
          // Special handling for PlaylistItemMarker foreign key updates
          if (tableName === 'PlaylistItemMarker') {
            const playlistItemIdIndex = columnNames.indexOf('PlaylistItemId');
            
            if (playlistItemIdIndex !== -1) {
              const playlistItemId = adjustedRow[playlistItemIdIndex];
              
              // Apply any PlaylistItem ID mappings
              if (idMappings.has('PlaylistItem') && idMappings.get('PlaylistItem').has(playlistItemId)) {
                const mappedPlaylistItemId = idMappings.get('PlaylistItem').get(playlistItemId);
                adjustedRow[playlistItemIdIndex] = mappedPlaylistItemId;
                console.log(`Applied PlaylistItem ID mapping in PlaylistItemMarker: ${playlistItemId} → ${mappedPlaylistItemId}`);
              }
            }
          }
          
          // Special handling for TagMap unique constraints
          if (tableName === 'TagMap') {
            const tagIdIndex = columnNames.indexOf('TagId');
            const locationIdIndex = columnNames.indexOf('LocationId');
            const noteIdIndex = columnNames.indexOf('NoteId');
            const positionIndex = columnNames.indexOf('Position');
            
            if (tagIdIndex !== -1) {
              const tagId = adjustedRow[tagIdIndex];
              const locationId = adjustedRow[locationIdIndex];
              const noteId = adjustedRow[noteIdIndex];
              const position = adjustedRow[positionIndex];
              
              // Check TagId_Position constraint
              if (position !== null) {
                try {
                  const positionCheck = targetDb.exec(`SELECT COUNT(*) FROM TagMap WHERE TagId = ? AND Position = ?`, [tagId, position]);
                  if (positionCheck.length > 0 && positionCheck[0].values[0][0] > 0) {
                    console.log(`Skipping duplicate TagMap: TagId=${tagId}, Position=${position}`);
                    continue;
                  }
                } catch (error) {
                  console.warn(`Error checking TagMap Position constraint:`, error.message);
                }
              }
              
              // Check TagId_LocationId constraint
              if (locationId !== null) {
                try {
                  const locationCheck = targetDb.exec(`SELECT COUNT(*) FROM TagMap WHERE TagId = ? AND LocationId = ?`, [tagId, locationId]);
                  if (locationCheck.length > 0 && locationCheck[0].values[0][0] > 0) {
                    console.log(`Skipping duplicate TagMap: TagId=${tagId}, LocationId=${locationId}`);
                    continue;
                  }
                } catch (error) {
                  console.warn(`Error checking TagMap LocationId constraint:`, error.message);
                }
              }
              
              // Check TagId_NoteId constraint
              if (noteId !== null) {
                try {
                  const noteCheck = targetDb.exec(`SELECT COUNT(*) FROM TagMap WHERE TagId = ? AND NoteId = ?`, [tagId, noteId]);
                  if (noteCheck.length > 0 && noteCheck[0].values[0][0] > 0) {
                    console.log(`Skipping duplicate TagMap: TagId=${tagId}, NoteId=${noteId}`);
                    continue;
                  }
                } catch (error) {
                  console.warn(`Error checking TagMap NoteId constraint:`, error.message);
                }
              }
            }
          }
          
          // Update foreign key references based on ID mappings
          adjustedRow = updateForeignKeyReferences(adjustedRow, tableName, columnNames, targetDb);
          
          const placeholders = new Array(adjustedRow.length).fill('?').join(',');
          
          // Use INSERT OR IGNORE to skip duplicates gracefully
          const insertStmt = `INSERT OR IGNORE INTO ${tableName} VALUES (${placeholders})`;
          
          try {
            // For critical tables, perform pre-insert constraint validation
            if (tableName === 'Location' && hasId) {
              const insertedId = adjustedRow[idColumnIndex];
              
              // Double-check ID doesn't already exist (should be caught earlier but this is defensive)
              const idCheckQuery = `SELECT COUNT(*) FROM Location WHERE LocationId = ?`;
              const idCheckResult = targetDb.exec(idCheckQuery, [insertedId]);
              
              if (idCheckResult.length > 0 && idCheckResult[0].values[0][0] > 0) {
                const locationDescription = getLocationDescription(adjustedRow, columnNames);
                console.error(`🚨 Pre-insert ID conflict detected for Location ${insertedId}: ${locationDescription}`);
                console.error(`   Finding next available ID to resolve conflict...`);
                
                // Find next truly available ID
                let searchId = insertedId + 1;
                let idAvailable = false;
                while (!idAvailable && searchId < insertedId + 1000) { // Prevent infinite loop
                  const searchQuery = `SELECT COUNT(*) FROM Location WHERE LocationId = ?`;
                  const searchResult = targetDb.exec(searchQuery, [searchId]);
                  if (searchResult.length === 0 || searchResult[0].values[0][0] === 0) {
                    idAvailable = true;
                  } else {
                    searchId++;
                  }
                }
                
                if (idAvailable) {
                  console.log(`   Using LocationId ${searchId} instead of ${insertedId}`);
                  adjustedRow[idColumnIndex] = searchId;
                  nextAvailableId = Math.max(nextAvailableId, searchId + 1);
                  
                  // Update pending mapping if it exists
                  if (adjustedRow._pendingIdMapping) {
                    adjustedRow._pendingIdMapping.newId = searchId;
                  }
                } else {
                  console.error(`   Could not find available ID for Location: ${locationDescription}`);
                  continue; // Skip this row as last resort
                }
              }
              
              // Check for composite unique constraint violations
              const bookNumberIndex = columnNames.indexOf('BookNumber');
              const chapterNumberIndex = columnNames.indexOf('ChapterNumber');
              const keySymbolIndex = columnNames.indexOf('KeySymbol');
              const mepsLanguageIndex = columnNames.indexOf('MepsLanguage');
              const typeIndex = columnNames.indexOf('Type');
              const issueTagNumberIndex = columnNames.indexOf('IssueTagNumber');
              
              if (bookNumberIndex !== -1 && keySymbolIndex !== -1) {
                const bookNumber = adjustedRow[bookNumberIndex];
                const chapterNumber = chapterNumberIndex !== -1 ? adjustedRow[chapterNumberIndex] : null;
                const keySymbol = adjustedRow[keySymbolIndex];
                const mepsLanguage = mepsLanguageIndex !== -1 ? adjustedRow[mepsLanguageIndex] : null;
                const type = typeIndex !== -1 ? adjustedRow[typeIndex] : null;
                const issueTagNumber = issueTagNumberIndex !== -1 ? adjustedRow[issueTagNumberIndex] : null;
                
                const compositeCheckQuery = `SELECT LocationId FROM Location WHERE ` +
                  `BookNumber ${bookNumber === null ? 'IS NULL' : '= ?'} AND ` +
                  `ChapterNumber ${chapterNumber === null ? 'IS NULL' : '= ?'} AND ` +
                  `KeySymbol ${keySymbol === null ? 'IS NULL' : '= ?'} AND ` +
                  `MepsLanguage ${mepsLanguage === null ? 'IS NULL' : '= ?'} AND ` +
                  `Type ${type === null ? 'IS NULL' : '= ?'} AND ` +
                  `IssueTagNumber ${issueTagNumber === null ? 'IS NULL' : '= ?'}`;
                
                const params = [];
                if (bookNumber !== null) params.push(bookNumber);
                if (chapterNumber !== null) params.push(chapterNumber);
                if (keySymbol !== null) params.push(keySymbol);
                if (mepsLanguage !== null) params.push(mepsLanguage);
                if (type !== null) params.push(type);
                if (issueTagNumber !== null) params.push(issueTagNumber);
                
                const compositeCheck = targetDb.exec(compositeCheckQuery, params);
                if (compositeCheck.length > 0 && compositeCheck[0].values[0]) {
                  const existingId = compositeCheck[0].values[0][0];
                  const locationDescription = getLocationDescription(adjustedRow, columnNames);
                  console.error(`🚨 Pre-insert composite constraint violation for Location ${insertedId}: ${locationDescription}`);
                  console.error(`   Content already exists with LocationId ${existingId} - this should have been caught as duplicate!`);
                  continue; // Skip this row
                }
              }
            }
            
            targetDb.exec(insertStmt, adjustedRow);
            
            // Enhanced verification for critical tables and ID mappings
            if (hasId) {
              const insertedId = adjustedRow[idColumnIndex];
              const idColumn = columnNames[idColumnIndex];
              const verifyQuery = `SELECT COUNT(*) FROM ${tableName} WHERE ${idColumn} = ?`;
              const verifyResult = targetDb.exec(verifyQuery, [insertedId]);
              
              const insertSucceeded = verifyResult.length > 0 && verifyResult[0].values[0][0] > 0;
              
              if (!insertSucceeded) {
                // Insert failed silently - this is critical for ID mappings
                if (tableName === 'Location') {
                  const locationDescription = getLocationDescription(adjustedRow, columnNames);
                  
                  // Check if this is a debug location we're tracking
                  const keySymbolIndex = columnNames.indexOf('KeySymbol');
                  const issueTagNumberIndex = columnNames.indexOf('IssueTagNumber');
                  const keySymbol = keySymbolIndex !== -1 ? adjustedRow[keySymbolIndex] : null;
                  const issueTagNumber = issueTagNumberIndex !== -1 ? adjustedRow[issueTagNumberIndex] : null;
                  const isDebugLocation = keySymbol === 'w' && (issueTagNumber === 20240200 || issueTagNumber === 20250500);
                  
                  console.error(`✗ CRITICAL: Location insert failed silently!`);
                  console.error(`  ID: ${insertedId}, Content: ${locationDescription}`);
                  console.error(`  This will cause foreign key mapping failures!`);
                  
                  if (isDebugLocation) {
                    console.error(`  🚨 DEBUG: This is a tracked location - investigating why insert failed`);
                    const bookNumberIndex = columnNames.indexOf('BookNumber');
                    const chapterNumberIndex = columnNames.indexOf('ChapterNumber');
                    const mepsLanguageIndex = columnNames.indexOf('MepsLanguage');
                    const typeIndex = columnNames.indexOf('Type');
                    
                    console.error(`    Full row data: [${adjustedRow.map((val, idx) => `${columnNames[idx]}=${val}`).join(', ')}]`);
                  }
                } else if (tableName === 'UserMark') {
                  // For UserMark, provide additional diagnostic information
                  const userMarkGuidIndex = columnNames.indexOf('UserMarkGuid');
                  const locationIdIndex = columnNames.indexOf('LocationId');
                  const guid = userMarkGuidIndex >= 0 ? adjustedRow[userMarkGuidIndex] : 'Unknown';
                  const locationId = locationIdIndex >= 0 ? adjustedRow[locationIdIndex] : 'Unknown';
                  
                  console.error(`✗ CRITICAL: UserMark insert failed silently for ID ${insertedId}`);
                  console.error(`  GUID: ${guid}, LocationId: ${locationId}`);
                  
                  // Check if the LocationId exists to diagnose FK constraint issues
                  try {
                    const locationCheck = targetDb.exec('SELECT COUNT(*) FROM Location WHERE LocationId = ?', [locationId]);
                    const locationExists = locationCheck.length > 0 && locationCheck[0].values[0][0] > 0;
                    if (!locationExists) {
                      console.error(`  ❌ CAUSE: Referenced LocationId ${locationId} does not exist (FK constraint violation)`);
                    }
                  } catch (error) {
                    console.error(`  Error checking LocationId existence:`, error.message);
                  }
                } else {
                  console.error(`✗ CRITICAL: ${tableName} insert failed silently for ID ${insertedId}`);
                }
                
                // Don't create the pending ID mapping since insert failed
                if (adjustedRow._pendingIdMapping) {
                  console.error(`❌ Not creating ID mapping due to failed insert: ${adjustedRow._pendingIdMapping.originalId} → ${adjustedRow._pendingIdMapping.newId}`);
                }
              } else {
                // Insert succeeded - create pending ID mapping if exists
                if (adjustedRow._pendingIdMapping) {
                  const { tableName: mappingTable, originalId, newId } = adjustedRow._pendingIdMapping;
                  trackIdMapping(mappingTable, originalId, newId);
                  console.log(`✅ ID mapping created after successful insert: ${originalId} → ${newId}`);
                }
                
                if (tableName === 'Location') {
                  // Log successful Location inserts for debugging
                  const locationDescription = getLocationDescription(adjustedRow, columnNames);
                  
                  // Check if this is a debug location we're tracking
                  const keySymbolIndex = columnNames.indexOf('KeySymbol');
                  const issueTagNumberIndex = columnNames.indexOf('IssueTagNumber');
                  const keySymbol = keySymbolIndex !== -1 ? adjustedRow[keySymbolIndex] : null;
                  const issueTagNumber = issueTagNumberIndex !== -1 ? adjustedRow[issueTagNumberIndex] : null;
                  const isDebugLocation = keySymbol === 'w' && (issueTagNumber === 20240200 || issueTagNumber === 20250500);
                  
                  if (isDebugLocation) {
                    console.log(`✅ DEBUG: Location insert succeeded: ID ${insertedId}, Content: ${locationDescription}`);
                    const mepsLanguageIndex = columnNames.indexOf('MepsLanguage');
                    const typeIndex = columnNames.indexOf('Type');
                    const mepsLanguage = mepsLanguageIndex !== -1 ? adjustedRow[mepsLanguageIndex] : null;
                    const type = typeIndex !== -1 ? adjustedRow[typeIndex] : null;
                    console.log(`    MepsLanguage=${mepsLanguage}, Type=${type}`);
                  }
                  console.log(`✓ Location insert succeeded: ID ${insertedId}, Content: ${locationDescription}`);
                }
              }
            }
          } catch (error) {
            // Log individual row errors but continue processing
            console.warn(`✗ Failed to insert row in ${tableName}:`, error.message);
            if (tableName === 'Location' && hasId) {
              const locationDescription = getLocationDescription(adjustedRow, columnNames);
              console.warn(`  Failed Location: ${locationDescription}`);
            }
          }
        }
        
        // Update ID offset for next database (only for simple ID tables)
        if (hasId && !isGuidOrCompositeUniqueTable(tableName) && data[0].values.length > 0) {
          const maxId = Math.max(...data[0].values.map(row => row[idColumnIndex]));
          idOffset = Math.max(idOffset, maxId + 1);
        }
        
      } catch (error) {
        // Log error but continue with other databases
        console.warn(`Error merging ${tableName} from ${sourceDb.name}:`, error);
      }
    }
  } catch (error) {
    console.warn(`Error setting up merge for table ${tableName}:`, error);
  }
}

// Handle messages from main thread
self.onmessage = async function(e) {
  const { type, files, mergeConfig } = e.data;
  
  if (type === 'merge') {
    await processMerge(files, mergeConfig);
  }
};