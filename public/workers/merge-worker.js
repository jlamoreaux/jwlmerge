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
    
    // Merge data from each database
    let processedTables = 0;
    const totalTables = tables[0].values.length;
    
    for (const [tableName] of tables[0].values) {
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
      compressionOptions: { level: 6 }
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
    const hasId = columnNames.includes('Id');
    
    let idOffset = 0;
    
    // Process each source database
    for (const sourceDb of sourceDatabases) {
      try {
        // Get all data from this table
        const data = sourceDb.db.exec(`SELECT * FROM ${tableName}`);
        
        if (!data.length || !data[0].values) {
          continue; // Skip empty tables
        }
        
        // Insert data with ID offset to avoid conflicts
        for (const row of data[0].values) {
          const adjustedRow = hasId ? 
            [row[0] + idOffset, ...row.slice(1)] : // Adjust ID if present
            row;
          
          const placeholders = new Array(adjustedRow.length).fill('?').join(',');
          const insertStmt = `INSERT INTO ${tableName} VALUES (${placeholders})`;
          
          targetDb.exec(insertStmt, adjustedRow);
        }
        
        // Update ID offset for next database
        if (hasId && data[0].values.length > 0) {
          const maxId = Math.max(...data[0].values.map(row => row[0]));
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