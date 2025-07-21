import type { JWLMetadata } from '@/lib/validation/jwl-validator';

export interface JWLDataType {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface ManagedFile {
  id: string;
  file: File;
  metadata: JWLMetadata;
  dataTypes: JWLDataType[];
  isSelected: boolean;
}

export const DEFAULT_JWL_DATA_TYPES: Omit<JWLDataType, 'enabled'>[] = [
  {
    id: 'notes',
    name: 'Notes',
    description: 'User annotations and personal notes',
  },
  {
    id: 'bookmarks',
    name: 'Bookmarks',
    description: 'Saved locations in publications',
  },
  {
    id: 'highlights',
    name: 'Highlights',
    description: 'Highlighted text and passages',
  },
  {
    id: 'tags',
    name: 'Tags',
    description: 'User-created tags and categories',
  },
  {
    id: 'usermarks',
    name: 'User Marks',
    description: 'User markings and underlines',
  },
  {
    id: 'inputfields',
    name: 'Input Fields',
    description: 'Form input data and responses',
  },
  {
    id: 'playlists',
    name: 'Playlists',
    description: 'Media playlists and favorites',
  },
] as const;

export type JWLDataTypeId = typeof DEFAULT_JWL_DATA_TYPES[number]['id'];