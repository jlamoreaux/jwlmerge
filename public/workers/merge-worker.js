/**
 * Web Worker for client-side JWL file merging
 * Runs heavy operations in background thread to avoid UI freezing
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

// Process merge operation
async function processMerge(files, mergeConfig) {
  try {
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
    
    // Filter ordered tables to only include those that exist in the database
    const tablesToMerge = orderedTables.filter(tableName => availableTableNames.includes(tableName));
    
    // Add any tables not in our predefined order (merge them last)
    const unorderedTables = availableTableNames.filter(tableName => !orderedTables.includes(tableName));
    tablesToMerge.push(...unorderedTables);
    
    let processedTables = 0;
    const totalTables = tablesToMerge.length;
    
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
    
    postMessage({ type: 'progress', message: 'Creating merged JWL file...', progress: 90 });
    
    // Export merged database
    const mergedDbData = mergedDb.export();
    
    // Create new JWL file
    const mergedZip = new JSZip();
    
    // Create merged manifest
    const mergedManifest = {
      name: 'merged-library',
      creationDate: new Date().toISOString(),
      version: 1,
      type: 0,
      userDataBackup: {
        lastModifiedDate: new Date().toISOString(),
        deviceName: 'JWL Merge Web - Client Processed',
        hash: `client-merged-${Date.now()}`,
        schemaVersion: 13
      }
    };
    
    mergedZip.file('manifest.json', JSON.stringify(mergedManifest, null, 2));
    mergedZip.file('userData.db', mergedDbData);
    
    postMessage({ type: 'progress', message: 'Finalizing file...', progress: 95 });
    
    // Generate final ZIP
    const mergedBlob = await mergedZip.generateAsync({ 
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      mimeType: 'application/octet-stream'
    });
    
    postMessage({ type: 'progress', message: 'Complete!', progress: 100 });
    
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
        }
      }
    });
    
    // Clean up
    databases.forEach(db => db.db.close());
    mergedDb.close();
    
  } catch (error) {
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
  return mergeConfig.globalDataTypes && mergeConfig.globalDataTypes[dataTypeId];
}

// Check if table has GUID-based or composite unique constraints
function isGuidOrCompositeUniqueTable(tableName) {
  const guidOrCompositeTables = [
    'UserMark',      // UserMarkGuid
    'Note',          // Guid
    'Bookmark',      // PublicationLocationId + Slot composite
    'TagMap',        // Multiple UNIQUE constraints (TagId+Position, TagId+NoteId, etc.)
    'Location',      // BookNumber + ChapterNumber + KeySymbol + MepsLanguage + Type composite
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

// Update foreign key references based on ID mappings
function updateForeignKeyReferences(row, tableName, columnNames, targetDb) {
  // Define foreign key relationships
  const foreignKeyMappings = {
    'BlockRange': { 'UserMarkId': 'UserMark' },
    'Note': { 'UserMarkId': 'UserMark', 'LocationId': 'Location' },
    'TagMap': { 'TagId': 'Tag', 'PlaylistItemId': 'PlaylistItem', 'LocationId': 'Location', 'NoteId': 'Note' },
    'PlaylistItemMarker': { 'PlaylistItemId': 'PlaylistItem' },
    'PlaylistItemLocationMap': { 'PlaylistItemId': 'PlaylistItem', 'LocationId': 'Location' },
    'PlaylistItemIndependentMediaMap': { 'PlaylistItemId': 'PlaylistItem' },
    'PlaylistItemMarkerBibleVerseMap': { 'PlaylistItemMarkerId': 'PlaylistItemMarker' },
    'PlaylistItemMarkerParagraphMap': { 'PlaylistItemMarkerId': 'PlaylistItemMarker' }
  };
  
  const fkRelations = foreignKeyMappings[tableName];
  if (!fkRelations) return row;
  
  return row.map((value, index) => {
    const columnName = columnNames[index];
    const referencedTable = fkRelations[columnName];
    
    if (referencedTable && idMappings.has(referencedTable) && value !== null) {
      // Check if the original ID still exists in the target database
      try {
        const idColumn = referencedTable === 'UserMark' ? 'UserMarkId' : 
                        referencedTable === 'Note' ? 'NoteId' :
                        referencedTable === 'Tag' ? 'TagId' :
                        referencedTable === 'PlaylistItem' ? 'PlaylistItemId' :
                        referencedTable === 'Location' ? 'LocationId' :
                        referencedTable === 'PlaylistItemMarker' ? 'PlaylistItemMarkerId' :
                        `${referencedTable}Id`;
        
        const existsQuery = `SELECT COUNT(*) FROM ${referencedTable} WHERE ${idColumn} = ?`;
        const existsResult = targetDb.exec(existsQuery, [value]);
        const exists = existsResult.length > 0 && existsResult[0].values[0][0] > 0;
        
        if (!exists) {
          // Original ID doesn't exist, use mapping if available
          const mapping = idMappings.get(referencedTable);
          const newId = mapping.get(value);
          return newId !== undefined ? newId : value;
        }
        // Original ID exists, keep it unchanged
        return value;
      } catch (error) {
        console.warn(`Error checking FK existence for ${referencedTable}:`, error.message);
        return value;
      }
    }
    
    return value;
  });
}

// Merge data from multiple databases into target table
async function mergeTableData(targetDb, sourceDatabases, tableName, mergeConfig) {
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
          
          // Handle ID conflicts differently for GUID vs simple ID tables
          if (hasId) {
            if (isGuidOrCompositeUniqueTable(tableName)) {
              // For GUID tables, check for ID conflicts and reassign if needed
              const originalId = row[idColumnIndex];
              const checkQuery = `SELECT COUNT(*) FROM ${tableName} WHERE ${columnNames[idColumnIndex]} = ?`;
              try {
                const existing = targetDb.exec(checkQuery, [originalId]);
                if (existing.length > 0 && existing[0].values[0][0] > 0) {
                  // ID conflict detected, get next available ID
                  const maxIdQuery = `SELECT MAX(${columnNames[idColumnIndex]}) FROM ${tableName}`;
                  const maxResult = targetDb.exec(maxIdQuery);
                  const maxId = maxResult.length > 0 && maxResult[0].values.length > 0 ? maxResult[0].values[0][0] : 0;
                  const newId = (maxId || 0) + 1;
                  // Track the ID mapping for foreign key updates
                  trackIdMapping(tableName, originalId, newId);
                  adjustedRow = row.map((value, index) => 
                    index === idColumnIndex ? newId : value
                  );
                } else {
                  adjustedRow = row; // No conflict, use original
                }
              } catch (error) {
                console.warn(`Error checking ID conflict for ${tableName}:`, error.message);
                adjustedRow = row;
              }
            } else {
              // For simple ID tables, apply offset to avoid conflicts
              adjustedRow = row.map((value, index) => 
                index === idColumnIndex ? value + idOffset : value
              );
            }
          }
          
          // Special handling for PlaylistItem content-based duplicates
          if (tableName === 'PlaylistItem') {
            const labelIndex = columnNames.indexOf('Label');
            const startTrimIndex = columnNames.indexOf('StartTrimOffsetTicks');
            const endTrimIndex = columnNames.indexOf('EndTrimOffsetTicks');
            
            if (labelIndex !== -1) {
              const label = row[labelIndex];
              const startTrim = startTrimIndex !== -1 ? row[startTrimIndex] : null;
              const endTrim = endTrimIndex !== -1 ? row[endTrimIndex] : null;
              
              // Check if this content already exists
              const checkQuery = `SELECT COUNT(*) FROM PlaylistItem WHERE Label = ? AND StartTrimOffsetTicks ${startTrim === null ? 'IS NULL' : '= ?'} AND EndTrimOffsetTicks ${endTrim === null ? 'IS NULL' : '= ?'}`;
              const checkParams = [label];
              if (startTrim !== null) checkParams.push(startTrim);
              if (endTrim !== null) checkParams.push(endTrim);
              
              try {
                const existing = targetDb.exec(checkQuery, checkParams);
                if (existing.length > 0 && existing[0].values[0][0] > 0) {
                  // Duplicate found, skip this row
                  console.log(`Skipping duplicate PlaylistItem: ${label}`);
                  continue;
                }
              } catch (error) {
                console.warn(`Error checking PlaylistItem duplicate:`, error.message);
              }
            }
          }
          
          // Update foreign key references based on ID mappings
          adjustedRow = updateForeignKeyReferences(adjustedRow, tableName, columnNames, targetDb);
          
          const placeholders = new Array(adjustedRow.length).fill('?').join(',');
          
          // Use INSERT OR IGNORE to skip duplicates gracefully
          const insertStmt = `INSERT OR IGNORE INTO ${tableName} VALUES (${placeholders})`;
          
          try {
            targetDb.exec(insertStmt, adjustedRow);
          } catch (error) {
            // Log individual row errors but continue processing
            console.warn(`Failed to insert row in ${tableName}:`, error.message);
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