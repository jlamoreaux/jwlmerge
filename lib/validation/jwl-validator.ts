import JSZip from 'jszip';

export interface JWLMetadata {
  deviceName?: string | undefined;
  creationDate?: string | undefined;
  version?: string | undefined;
  databaseVersion?: number | undefined;
  hash?: string | undefined;
  userDataLocale?: string | undefined;
  fileSize: number;
  fileName: string;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string | undefined;
  errorType?: 'extension' | 'size' | 'structure' | 'manifest' | 'corrupted' | undefined;
  metadata?: JWLMetadata | undefined;
}

export interface ManifestData {
  name?: string;
  creationDate?: string;
  version?: string;
  databaseVersion?: number;
  hash?: string;
  userDataLocale?: string;
  [key: string]: unknown;
}

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const REQUIRED_FILES = ['manifest.json', 'userData.db'];

export class JWLValidator {
  /**
   * Validates a JWL file and extracts metadata
   */
  static async validateFile(file: File): Promise<ValidationResult> {
    try {
      // Basic validation
      const basicValidation = this.validateBasics(file);
      if (!basicValidation.isValid) {
        return basicValidation;
      }

      // ZIP structure validation
      const zipValidation = await this.validateZipStructure(file);
      if (!zipValidation.isValid) {
        return zipValidation;
      }

      // Manifest validation and metadata extraction
      const manifestValidation = await this.validateManifestAndExtractMetadata(file);
      return manifestValidation;
    } catch (error) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Unknown validation error',
        errorType: 'corrupted',
      };
    }
  }

  /**
   * Basic file validation (extension and size)
   */
  private static validateBasics(file: File): ValidationResult {
    // Extension check
    if (!file.name.toLowerCase().endsWith('.jwlibrary')) {
      return {
        isValid: false,
        error: 'File must have .jwlibrary extension',
        errorType: 'extension',
      };
    }

    // Size check
    if (file.size > MAX_FILE_SIZE) {
      return {
        isValid: false,
        error: `File size (${this.formatFileSize(file.size)}) exceeds the 100MB limit`,
        errorType: 'size',
      };
    }

    if (file.size === 0) {
      return {
        isValid: false,
        error: 'File is empty',
        errorType: 'size',
      };
    }

    return { isValid: true };
  }

  /**
   * Validates ZIP file structure and required files
   */
  private static async validateZipStructure(file: File): Promise<ValidationResult> {
    try {
      const zip = await JSZip.loadAsync(file);

      // Check for required files
      const missingFiles = REQUIRED_FILES.filter(
        (fileName) => !zip.files[fileName]
      );

      if (missingFiles.length > 0) {
        return {
          isValid: false,
          error: `Missing required files: ${missingFiles.join(', ')}`,
          errorType: 'structure',
        };
      }

      return { isValid: true };
    } catch {
      return {
        isValid: false,
        error: 'Invalid or corrupted ZIP file',
        errorType: 'corrupted',
      };
    }
  }

  /**
   * Validates manifest.json and extracts metadata
   */
  private static async validateManifestAndExtractMetadata(
    file: File
  ): Promise<ValidationResult> {
    try {
      const zip = await JSZip.loadAsync(file);
      const manifestFile = zip.files['manifest.json'];

      if (!manifestFile) {
        return {
          isValid: false,
          error: 'manifest.json not found',
          errorType: 'structure',
        };
      }

      const manifestContent = await manifestFile.async('text');

      let manifestData: ManifestData;
      try {
        manifestData = JSON.parse(manifestContent) as ManifestData;
      } catch {
        return {
          isValid: false,
          error: 'Invalid manifest.json format',
          errorType: 'manifest',
        };
      }

      // Extract metadata
      const metadata: JWLMetadata = {
        fileName: file.name,
        fileSize: file.size,
        deviceName: manifestData.name || 'Unknown Device',
        creationDate: manifestData.creationDate
          ? this.formatDate(manifestData.creationDate)
          : undefined,
        version: manifestData.version || 'Unknown',
        databaseVersion: manifestData.databaseVersion,
        hash: manifestData.hash,
        userDataLocale: manifestData.userDataLocale,
      };

      return {
        isValid: true,
        metadata,
      };
    } catch {
      return {
        isValid: false,
        error: 'Failed to read manifest.json',
        errorType: 'manifest',
      };
    }
  }

  /**
   * Format file size for display
   */
  private static formatFileSize(bytes: number): string {
    if (bytes === 0) {return '0 Bytes';}
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Format date for display
   */
  private static formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString; // Return original if parsing fails
    }
  }
}

/**
 * Quick validation for basic checks (used in upload component)
 */
export function validateJWLFileBasic(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.jwlibrary')) {
    return 'Only .jwlibrary files are supported';
  }

  if (file.size > MAX_FILE_SIZE) {
    return 'File size must be less than 100MB';
  }

  if (file.size === 0) {
    return 'File is empty';
  }

  return null;
}