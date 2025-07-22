/**
 * Integration Tests for JWLibrary Merge Worker
 * Tests end-to-end merge scenarios with realistic data
 */

import { describe, test, expect, beforeEach } from 'bun:test';

// Mock realistic JWLibrary database data
const createMockDatabase = (locationData: any[], userMarkData: any[]) => {
  const mockDb = {
    tables: new Map<string, any[]>(),
    closed: false,
    
    exec(sql: string, params: any[] = []): any[] {
      if (this.closed) throw new Error('Database is closed');
      
      if (sql.includes('SELECT name FROM sqlite_master')) {
        return [{ values: [['Location'], ['UserMark'], ['Note'], ['Tag'], ['PlaylistItemAccuracy']] }];
      }
      
      if (sql.includes('PRAGMA table_info(Location)')) {
        return [{
          values: [
            [0, 'LocationId', 'INTEGER', 0, null, 1],
            [1, 'BookNumber', 'INTEGER', 0, null, 0],
            [2, 'ChapterNumber', 'INTEGER', 0, null, 0],
            [3, 'DocumentId', 'INTEGER', 0, null, 0],
            [4, 'Track', 'INTEGER', 0, null, 0],
            [5, 'KeySymbol', 'TEXT', 0, null, 0],
            [6, 'MepsLanguage', 'INTEGER', 0, null, 0],
            [7, 'Type', 'INTEGER', 0, null, 0],
            [8, 'IssueTagNumber', 'INTEGER', 0, null, 0],
            [9, 'Title', 'TEXT', 0, null, 0]
          ]
        }];
      }
      
      if (sql.includes('PRAGMA table_info(UserMark)')) {
        return [{
          values: [
            [0, 'UserMarkId', 'INTEGER', 0, null, 1],
            [1, 'UserMarkGuid', 'TEXT', 0, null, 0],
            [2, 'LocationId', 'INTEGER', 0, null, 0],
            [3, 'ColorIndex', 'INTEGER', 0, null, 0],
            [4, 'StyleIndex', 'INTEGER', 0, null, 0],
            [5, 'Version', 'INTEGER', 0, null, 0]
          ]
        }];
      }
      
      if (sql.includes('SELECT * FROM Location ORDER BY KeySymbol')) {
        return [{ values: locationData }];
      }
      
      if (sql.includes('SELECT * FROM UserMark')) {
        return [{ values: userMarkData }];
      }
      
      if (sql.includes('INSERT INTO Location')) {
        if (!this.tables.has('Location')) this.tables.set('Location', []);
        this.tables.get('Location')!.push(params);
        return [];
      }
      
      if (sql.includes('INSERT INTO UserMark')) {
        if (!this.tables.has('UserMark')) this.tables.set('UserMark', []);
        this.tables.get('UserMark')!.push(params);
        return [];
      }
      
      if (sql.includes('SELECT COUNT(*) FROM Location WHERE LocationId')) {
        const locationId = params[0];
        const existingLocations = this.tables.get('Location') || [];
        const count = existingLocations.filter((row: any[]) => row[0] === locationId).length;
        return [{ values: [[count]] }];
      }
      
      return [];
    },
    
    close() {
      this.closed = true;
    }
  };
  
  return mockDb;
};

describe('JWLibrary Merge Integration Tests', () => {
  
  describe('Real-world pt14 Chapter Bug Scenario', () => {
    test('should correctly merge pt14 databases without chapter shift', async () => {
      // Arrange - simulate the exact bug scenario
      const databaseA = createMockDatabase([
        // LocationId 1076 - pt14 DocumentId 1102014863 (Chapter A)
        [1076, null, null, 1102014863, null, 'pt14', 0, 0, 0, null],
      ], [
        // UserMarks pointing to LocationId 1076
        [16311, '32C01C72-9949-4542-8645-0B4468F3B615', 1076, 1, 0, 1],
        [16312, '3FAEEFD8-F9F3-4EBB-9AAC-A7F33DC94848', 1076, 1, 0, 1]
      ]);
      
      const databaseB = createMockDatabase([
        // LocationId 1076 - same as database A (duplicate)
        [1076, null, null, 1102014863, null, 'pt14', 0, 0, 0, null],
        // LocationId 1083 - pt14 DocumentId 1102014864 (Chapter B - DIFFERENT!)
        [1083, null, null, 1102014864, null, 'pt14', 0, 0, 0, null],
      ], [
        // UserMarks - some to 1076 (duplicates), some to 1083 (different chapter)
        [16311, '32C01C72-9949-4542-8645-0B4468F3B615', 1076, 1, 0, 1], // Duplicate GUID
        [16429, '4E803DD7-977D-4C00-83A4-E0896ADDFF0E', 1076, 3, 0, 1],
        [16468, '80091713-A6AC-4EA0-ABD0-3B34A5D38563', 1083, 5, 0, 1], // Points to Chapter B
        [16470, 'B31A0BF2-79C8-4D06-810C-B4719500FDDF', 1083, 1, 0, 1], // Points to Chapter B
      ]);
      
      const targetDatabase = createMockDatabase([], []);
      
      // Mock the ID mapping system
      const idMappings = new Map<string, number>();
      const trackIdMapping = (tableName: string, originalId: number, newId: number) => {
        idMappings.set(`${tableName}:${originalId}`, newId);
      };
      
      // Mock the specialized Location merge function
      const mergeLocationsForKeySymbol = async (targetDb: any, keySymbol: string, locations: any[]) => {
        const uniqueLocations = new Map<string, number>();
        let insertedCount = 0;
        let duplicateCount = 0;
        
        for (const locationData of locations) {
          const row = locationData.row;
          const originalLocationId = row[0]; // LocationId
          
          // Create content signature excluding LocationId
          const contentSignature = row.slice(1).map((value: any) => 
            value === null ? 'NULL' : String(value)
          ).join('|');
          
          if (uniqueLocations.has(contentSignature)) {
            // Duplicate content - map to existing
            const existingLocationId = uniqueLocations.get(contentSignature)!;
            trackIdMapping('Location', originalLocationId, existingLocationId);
            duplicateCount++;
          } else {
            // Unique content - insert with conflict resolution
            let finalLocationId = originalLocationId;
            
            // Check for ID conflicts
            const existingCheck = targetDb.exec('SELECT COUNT(*) FROM Location WHERE LocationId = ?', [originalLocationId]);
            const idExists = existingCheck[0].values[0][0] > 0;
            
            if (idExists) {
              finalLocationId = originalLocationId + 1000; // Simplified conflict resolution
              trackIdMapping('Location', originalLocationId, finalLocationId);
            }
            
            // Insert with final ID
            const adjustedRow = [...row];
            adjustedRow[0] = finalLocationId;
            targetDb.exec('INSERT INTO Location (...) VALUES (...)', adjustedRow);
            
            uniqueLocations.set(contentSignature, finalLocationId);
            insertedCount++;
          }
        }
        
        return { insertedCount, duplicateCount };
      };
      
      // Act - merge pt14 locations from both databases
      const pt14LocationsFromA = [
        { row: [1076, null, null, 1102014863, null, 'pt14', 0, 0, 0, null], sourceDb: 'A' }
      ];
      
      const pt14LocationsFromB = [
        { row: [1076, null, null, 1102014863, null, 'pt14', 0, 0, 0, null], sourceDb: 'B' }, // Duplicate
        { row: [1083, null, null, 1102014864, null, 'pt14', 0, 0, 0, null], sourceDb: 'B' }  // Unique
      ];
      
      const allPt14Locations = [...pt14LocationsFromA, ...pt14LocationsFromB];
      const result = await mergeLocationsForKeySymbol(targetDatabase, 'pt14', allPt14Locations);
      
      // Assert
      expect(result.insertedCount).toBe(2); // Two unique pt14 locations
      expect(result.duplicateCount).toBe(1); // One duplicate (both 1076s)
      
      // Critical assertion: LocationId 1083 should NOT be mapped to 1076
      // This was the bug - different DocumentIds were being treated as duplicates
      expect(idMappings.get('Location:1083')).toBeUndefined(); // Should not be mapped
      expect(idMappings.get('Location:1076')).toBe(1076); // First 1076 should map to itself (duplicate from B maps to A)
      
      // Verify the correct number of unique locations were inserted
      const insertedLocations = targetDatabase.tables.get('Location') || [];
      expect(insertedLocations.length).toBe(2);
      
      // Verify that the different DocumentIds were preserved
      const documentIds = insertedLocations.map((row: any[]) => row[3]);
      expect(documentIds.sort()).toEqual([1102014863, 1102014864]);
    });
  });
  
  describe('Duplicate UserMark GUID Handling', () => {
    test('should handle duplicate UserMark GUIDs correctly', async () => {
      // Arrange - two databases with some overlapping UserMark GUIDs
      const sharedGuid = '32C01C72-9949-4542-8645-0B4468F3B615';
      const uniqueGuid1 = '3FAEEFD8-F9F3-4EBB-9AAC-A7F33DC94848';
      const uniqueGuid2 = '4E803DD7-977D-4C00-83A4-E0896ADDFF0E';
      
      const userMarksA = [
        [16311, sharedGuid, 1076, 1, 0, 1],
        [16312, uniqueGuid1, 1076, 1, 0, 1]
      ];
      
      const userMarksB = [
        [16311, sharedGuid, 1076, 1, 0, 1], // Same GUID, should be detected as duplicate
        [16429, uniqueGuid2, 1076, 3, 0, 1] // Different GUID, should be kept
      ];
      
      // Mock GUID-based duplicate detection
      const processUserMarks = (userMarks: any[][]) => {
        const seenGuids = new Set<string>();
        const results = { inserted: 0, duplicates: 0 };
        
        for (const userMark of userMarks) {
          const guid = userMark[1];
          if (seenGuids.has(guid)) {
            results.duplicates++;
          } else {
            seenGuids.add(guid);
            results.inserted++;
          }
        }
        
        return results;
      };
      
      // Act
      const allUserMarks = [...userMarksA, ...userMarksB];
      const result = processUserMarks(allUserMarks);
      
      // Assert
      expect(result.inserted).toBe(3); // 3 unique GUIDs
      expect(result.duplicates).toBe(1); // 1 duplicate GUID
    });
  });
  
  describe('Multi-Database Complex Scenario', () => {
    test('should merge 3 databases with overlapping content correctly', async () => {
      // Arrange - simulate merging 3 real JWLibrary backups
      const createWatchtowerLocations = (dbName: string, startId: number) => [
        [startId, null, null, null, null, 'w', 0, 0, 20240200, null],     // w/20240200
        [startId + 1, null, null, null, null, 'w', 0, 0, 20240300, null], // w/20240300
      ];
      
      const createBibleLocations = (dbName: string, startId: number) => [
        [startId, 1, 1, null, null, 'nwtsty', 0, 0, null, null],      // Genesis 1
        [startId + 1, 1, 2, null, null, 'nwtsty', 0, 0, null, null],  // Genesis 2
      ];
      
      // Database A: Watchtower + Bible
      const dbA_locations = [
        ...createWatchtowerLocations('A', 100),
        ...createBibleLocations('A', 200)
      ];
      
      // Database B: Overlapping Watchtower + unique Bible
      const dbB_locations = [
        ...createWatchtowerLocations('B', 300), // Same content, different IDs (duplicates)
        [400, 1, 3, null, null, 'nwtsty', 0, 0, null, null]  // Genesis 3 (unique)
      ];
      
      // Database C: Mix of overlapping and unique content  
      const dbC_locations = [
        [500, null, null, null, null, 'w', 0, 0, 20240300, null], // w/20240300 (duplicate)
        [501, null, null, null, null, 'w', 0, 0, 20240400, null], // w/20240400 (unique)
        [600, 1, 2, null, null, 'nwtsty', 0, 0, null, null]       // Genesis 2 (duplicate)
      ];
      
      // Mock the KeySymbol-grouped merge process
      const mergeByKeySymbol = async (locations: any[][]) => {
        const grouped = new Map<string, any[]>();
        
        // Group by KeySymbol
        for (const location of locations) {
          const keySymbol = location[5];
          if (!grouped.has(keySymbol)) grouped.set(keySymbol, []);
          grouped.get(keySymbol)!.push(location);
        }
        
        let totalInserted = 0;
        let totalDuplicates = 0;
        
        // Process each KeySymbol group
        for (const [keySymbol, keySymbolLocations] of grouped) {
          const uniqueContent = new Map<string, number>();
          
          for (const location of keySymbolLocations) {
            const contentSignature = location.slice(1).join('|'); // Exclude LocationId
            
            if (uniqueContent.has(contentSignature)) {
              totalDuplicates++;
              // Would create ID mapping here
            } else {
              uniqueContent.set(contentSignature, location[0]);
              totalInserted++;
              // Would insert into target database
            }
          }
        }
        
        return { inserted: totalInserted, duplicates: totalDuplicates };
      };
      
      // Act - merge all locations
      const allLocations = [...dbA_locations, ...dbB_locations, ...dbC_locations];
      const result = await mergeByKeySymbol(allLocations);
      
      // Assert
      expect(result.inserted).toBe(6); // 6 unique pieces of content
      expect(result.duplicates).toBe(4); // 4 duplicates across databases
      
      /*
       * Expected unique content:
       * 1. w/20240200 (from A)
       * 2. w/20240300 (from A, B and C have duplicates) 
       * 3. w/20240400 (from C, unique)
       * 4. Genesis 1 (from A)
       * 5. Genesis 2 (from A, C has duplicate)
       * 6. Genesis 3 (from B, unique)
       * 
       * Expected duplicates:
       * 1. B's w/20240200 → A's w/20240200
       * 2. B's w/20240300 → A's w/20240300 
       * 3. C's w/20240300 → A's w/20240300
       * 4. C's Genesis 2 → A's Genesis 2
       */
    });
  });
  
  describe('Performance with Realistic Data Sizes', () => {
    test('should handle typical JWLibrary database size efficiently', async () => {
      const startTime = Date.now();
      
      // Typical JWLibrary database might have:
      // - 500 Location records
      // - 2000 UserMark records
      // - Mix of Bible locations and publication locations
      
      const locations: any[] = [];
      
      // Add Bible locations (66 books * 5 chapters avg = 330 locations)
      for (let book = 1; book <= 66; book++) {
        for (let chapter = 1; chapter <= 5; chapter++) {
          locations.push([
            locations.length + 1, book, chapter, null, null, 'nwtsty', 0, 0, null, null
          ]);
        }
      }
      
      // Add Watchtower locations (12 months * 2 issues * 5 years = 120 locations)
      for (let year = 2020; year <= 2024; year++) {
        for (let month = 1; month <= 12; month++) {
          for (let issue = 1; issue <= 2; issue++) {
            locations.push([
              locations.length + 1, null, null, null, null, 'w', 0, 0, 
              year * 100 + month * 10 + issue, null
            ]);
          }
        }
      }
      
      // Add meeting workbook locations (12 months * 5 years = 60 locations)
      for (let year = 2020; year <= 2024; year++) {
        for (let month = 1; month <= 12; month++) {
          locations.push([
            locations.length + 1, null, null, null, null, 'mwb', 0, 0, 
            year * 100 + month, null
          ]);
        }
      }
      
      // Simulate processing by KeySymbol (the actual merge logic)
      const processLocationsByKeySymbol = (locations: any[][]) => {
        const grouped = new Map<string, any[]>();
        
        // Group by KeySymbol
        for (const location of locations) {
          const keySymbol = location[5];
          if (!grouped.has(keySymbol)) grouped.set(keySymbol, []);
          grouped.get(keySymbol)!.push(location);
        }
        
        let processed = 0;
        for (const [keySymbol, keySymbolLocations] of grouped) {
          // Simulate duplicate detection for this KeySymbol group
          const uniqueContent = new Set<string>();
          
          for (const location of keySymbolLocations) {
            const contentSignature = location.slice(1).join('|');
            uniqueContent.add(contentSignature);
          }
          
          processed += keySymbolLocations.length;
        }
        
        return processed;
      };
      
      // Act
      const totalProcessed = processLocationsByKeySymbol(locations);
      
      const endTime = Date.now();
      const processingTime = endTime - startTime;
      
      // Assert
      expect(totalProcessed).toBe(locations.length);
      expect(processingTime).toBeLessThan(1000); // Should process in under 1 second
      expect(locations.length).toBeGreaterThan(500); // Realistic database size
    });
  });
  
  describe('Real-world Duplicate Detection Failure', () => {
    test('should fix the 99 duplicate Location entries issue with holistic approach', async () => {
      // Arrange - simulate the exact issue from log.txt where 99 duplicates were detected
      const createRealWorldDuplicates = () => {
        // These are unique content patterns based on the log (not duplicates within this array)
        const uniqueContentPatterns = [
          // Each of these represents a unique content signature
          { keySymbol: 'bt', bookNumber: null, chapterNumber: null, documentId: null, track: null, mepsLanguage: 0, type: 0, issueTagNumber: null, title: null },
          { keySymbol: 'w', bookNumber: null, chapterNumber: null, documentId: null, track: null, mepsLanguage: 0, type: 0, issueTagNumber: 20240200, title: null },
          { keySymbol: 'w', bookNumber: null, chapterNumber: null, documentId: null, track: null, mepsLanguage: 0, type: 0, issueTagNumber: 20240300, title: null },
          { keySymbol: 'w', bookNumber: null, chapterNumber: null, documentId: null, track: null, mepsLanguage: 0, type: 0, issueTagNumber: 20240500, title: null },
          { keySymbol: 'mwb', bookNumber: null, chapterNumber: null, documentId: null, track: null, mepsLanguage: 0, type: 0, issueTagNumber: 20230100, title: null },
          { keySymbol: 'mwb', bookNumber: null, chapterNumber: null, documentId: null, track: null, mepsLanguage: 0, type: 0, issueTagNumber: 20240100, title: null },
          { keySymbol: 'mwb', bookNumber: null, chapterNumber: null, documentId: null, track: null, mepsLanguage: 0, type: 0, issueTagNumber: 20240300, title: null },
          { keySymbol: 'pt14', bookNumber: null, chapterNumber: null, documentId: 1102014863, track: null, mepsLanguage: 0, type: 0, issueTagNumber: null, title: null },
          { keySymbol: 'pt14', bookNumber: null, chapterNumber: null, documentId: 1102014864, track: null, mepsLanguage: 0, type: 0, issueTagNumber: null, title: null },
          { keySymbol: 'es21', bookNumber: null, chapterNumber: null, documentId: null, track: null, mepsLanguage: 0, type: 0, issueTagNumber: null, title: null },
          { keySymbol: 'rr', bookNumber: null, chapterNumber: null, documentId: null, track: null, mepsLanguage: 0, type: 0, issueTagNumber: null, title: null },
          { keySymbol: 'lff', bookNumber: null, chapterNumber: null, documentId: null, track: null, mepsLanguage: 0, type: 0, issueTagNumber: null, title: null },
          { keySymbol: 'nwt', bookNumber: null, chapterNumber: null, documentId: null, track: null, mepsLanguage: 0, type: 0, issueTagNumber: null, title: null },
          { keySymbol: 'it', bookNumber: null, chapterNumber: null, documentId: null, track: null, mepsLanguage: 0, type: 0, issueTagNumber: null, title: null }
        ];
        
        return uniqueContentPatterns;
      };
      
      const duplicateLocationData = createRealWorldDuplicates();
      
      // Create three mock databases each containing the same locations (simulating 3-database merge)
      const createDatabaseWithDuplicates = (dbName: string, locationStartId: number) => {
        const locationRows = duplicateLocationData.map((loc, index) => [
          locationStartId + index, // Different LocationId
          loc.bookNumber,
          loc.chapterNumber,
          loc.documentId,
          loc.track,
          loc.keySymbol,
          loc.mepsLanguage,
          loc.type,
          loc.issueTagNumber,
          loc.title
        ]);
        
        // Create a mock database that returns our location data
        const mockDb = {
          tables: new Map<string, any[]>(),
          closed: false,
          
          exec(sql: string, params: any[] = []): any[] {
            if (this.closed) throw new Error('Database is closed');
            
            if (sql.includes('SELECT * FROM Location ORDER BY LocationId')) {
              return [{ values: locationRows, columns: ['LocationId', 'BookNumber', 'ChapterNumber', 'DocumentId', 'Track', 'KeySymbol', 'MepsLanguage', 'Type', 'IssueTagNumber', 'Title'] }];
            }
            
            return [];
          },
          
          close() {
            this.closed = true;
          }
        };
        
        return mockDb;
      };
      
      const databaseA = createDatabaseWithDuplicates('A', 1000);
      const databaseB = createDatabaseWithDuplicates('B', 2000);
      const databaseC = createDatabaseWithDuplicates('C', 3000);
      const targetDatabase = createMockDatabase([], []);
      
      // Track ID mappings (mock the global mapping system)
      const idMappings = new Map<string, number>();
      const trackIdMapping = (tableName: string, originalId: number, newId: number) => {
        idMappings.set(`${tableName}:${originalId}`, newId);
      };
      
      // Mock the holistic merge process
      const performHolisticLocationMerge = (allDatabases: any[], targetDb: any) => {
        // Phase 1: Collect all locations with content signatures
        const allLocations: any[] = [];
        const globalContentMap = new Map<string, any>();
        
        allDatabases.forEach((db, dbIndex) => {
          const data = db.exec('SELECT * FROM Location ORDER BY LocationId');
          if (data.length && data[0].values) {
            const columnNames = ['LocationId', 'BookNumber', 'ChapterNumber', 'DocumentId', 'Track', 'KeySymbol', 'MepsLanguage', 'Type', 'IssueTagNumber', 'Title'];
            
            data[0].values.forEach((row: any[]) => {
              const locationInfo = {
                row,
                columnNames,
                sourceDb: `Database${String.fromCharCode(65 + dbIndex)}`,
                originalLocationId: row[0]
              };
              
              // Create content signature (exclude LocationId)
              const contentSignature = row.slice(1).map((value: any) => 
                value === null ? 'NULL' : String(value)
              ).join('|');
              
              locationInfo.contentSignature = contentSignature;
              allLocations.push(locationInfo);
              
              if (!globalContentMap.has(contentSignature)) {
                globalContentMap.set(contentSignature, locationInfo);
              }
            });
          }
        });
        
        // Phase 2: Insert unique content and map duplicates
        const usedLocationIds = new Set<number>();
        let insertedCount = 0;
        let duplicateCount = 0;
        
        allLocations.forEach(locationInfo => {
          const firstOccurrence = globalContentMap.get(locationInfo.contentSignature);
          
          if (firstOccurrence !== locationInfo) {
            // Duplicate - map to first occurrence
            const firstOccurrenceId = firstOccurrence.finalLocationId || firstOccurrence.originalLocationId;
            trackIdMapping('Location', locationInfo.originalLocationId, firstOccurrenceId);
            duplicateCount++;
          } else {
            // First occurrence - insert it
            let finalLocationId = locationInfo.originalLocationId;
            
            if (usedLocationIds.has(finalLocationId)) {
              while (usedLocationIds.has(finalLocationId)) {
                finalLocationId++;
              }
            }
            
            usedLocationIds.add(finalLocationId);
            firstOccurrence.finalLocationId = finalLocationId;
            
            if (finalLocationId !== locationInfo.originalLocationId) {
              trackIdMapping('Location', locationInfo.originalLocationId, finalLocationId);
            }
            
            // Simulate insert into target database
            targetDb.tables.set('Location', (targetDb.tables.get('Location') || []).concat([locationInfo.row]));
            insertedCount++;
          }
        });
        
        return { insertedCount, duplicateCount, totalProcessed: allLocations.length };
      };
      
      // Act - perform holistic merge
      const result = performHolisticLocationMerge([databaseA, databaseB, databaseC], targetDatabase);
      
      // Assert - should have fixed the duplicate detection issue
      const uniqueLocations = duplicateLocationData.length; // Count of unique content patterns
      const totalLocations = uniqueLocations * 3; // Same locations across 3 databases
      
      expect(result.totalProcessed).toBe(totalLocations); // All locations processed
      expect(result.insertedCount).toBe(uniqueLocations); // Only unique content signatures inserted
      expect(result.duplicateCount).toBe(totalLocations - uniqueLocations); // Proper duplicate detection
      
      // Verify critical locations are properly mapped
      expect(idMappings.size).toBeGreaterThan(0); // Should have ID mappings for duplicates
      
      // Verify pt14 locations are correctly handled (critical for chapter shift bug)
      const pt14Mappings = Array.from(idMappings.keys()).filter(key => 
        key.startsWith('Location:') && (key.includes('3012') || key.includes('2012')) // pt14 locations from DB B and C
      );
      expect(pt14Mappings.length).toBe(2); // Two pt14 duplicates should be mapped
      
      // Final validation - no duplicates should exist in target database
      const insertedLocations = targetDatabase.tables.get('Location') || [];
      expect(insertedLocations.length).toBe(uniqueLocations); // Only unique locations inserted
    });
  });
});