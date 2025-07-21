# Product Requirements Document: JWLMerge Web

## Executive Summary
JWLMerge Web is a modern web application that brings the desktop JWLMerge functionality to the browser, enabling users to merge JW Library backup files without installing software. The application will prioritize privacy, ease of use, and performance while offering optional account features for backup history.

## Product Overview

### Vision
Create a zero-friction web tool that allows JW Library users to merge their backup files from any device with a modern, intuitive interface while maintaining the privacy-focused approach of the desktop application.

### Key Differentiators
- **No Installation Required**: Works in any modern browser
- **Privacy-First**: Client-side processing with optional cloud features
- **Modern UX**: Simplified workflow compared to desktop version
- **Cross-Platform**: Works on any OS including mobile devices
- **Version History**: Optional account system for backup management

## Technical Architecture

### Frontend Stack
- **Framework**: Next.js 14+ with App Router
- **UI Library**: Tailwind CSS + shadcn/ui components
- **State Management**: Zustand for complex state, React Context for simple state
- **File Handling**: react-dropzone for drag-and-drop
- **Analytics**: Vercel Analytics + Web Vitals

### Backend Stack
- **API Routes**: Next.js API routes for lightweight operations
- **Serverless Functions**: Vercel Functions for heavy processing
- **Database**: Supabase (PostgreSQL) for user accounts and metadata
- **File Storage**: Vercel Blob Storage for temporary file processing
- **Authentication**: Supabase Auth with magic links

### Architecture Decisions

1. **Hybrid Processing Model**
   - Light operations (file validation, manifest reading) in browser
   - Heavy operations (merging, database operations) in serverless functions
   - This balances performance with browser limitations

2. **Database Usage**
   - Store user accounts, merge history metadata
   - NOT storing actual backup file contents (privacy)
   - Track: merge timestamps, file counts, data type selections

3. **File Processing Flow**
   ```
   Browser → Upload to Blob → Serverless Processing → Download URL → Browser
   ```

## Core Features

### Phase 1: MVP (Essential Features)

1. **File Upload & Validation**
   - Drag-and-drop multiple .jwlibrary files
   - Real-time validation and error messaging
   - File size limits (100MB per file)
   - Visual file cards showing metadata

2. **Selective Merging**
   - Checkboxes for each data type:
     - Notes
     - Bookmarks
     - Underlining
     - Tags
     - Input Fields
     - Playlists
   - "Select All" / "Deselect All" options

3. **Merge Processing**
   - Progress indicator with step details
   - Cancel operation support
   - Error recovery suggestions

4. **Download Result**
   - Auto-generated filename with timestamp
   - One-click download
   - 24-hour temporary link

### Phase 2: Enhanced Features

1. **User Accounts (Optional)**
   - Magic link authentication
   - Merge history with metadata
   - Re-download recent merges (7 days)
   - Usage statistics dashboard

2. **Advanced Tools**
   - Remove notes by tag
   - Remove underlining by color
   - Bible notes export (CSV/Excel)
   - Preview backup contents

3. **Batch Operations**
   - Save merge presets
   - Apply saved configurations
   - Bulk processing queue

### Phase 3: Premium Features

1. **Extended Features**
   - 30-day merge history
   - Priority processing queue
   - Larger file size limits (500MB)
   - API access for automation

## User Interface Design

### Design Principles
1. **Minimal Cognitive Load**: Guide users through clear steps
2. **Visual Feedback**: Immediate response to all actions
3. **Mobile-First**: Responsive design that works on phones
4. **Accessibility**: WCAG 2.1 AA compliance

### UI Components

1. **Homepage Hero**
   ```
   - Large drop zone with animated border
   - "Drop .jwlibrary files here or click to browse"
   - Feature highlights below fold
   - Privacy statement prominently displayed
   ```

2. **File Management Section**
   ```
   - Grid of file cards (responsive 1-3 columns)
   - Each card shows:
     - Device name
     - Creation date
     - File size
     - Data type toggles
     - Remove button
   - Floating action button for adding more files
   ```

3. **Merge Configuration**
   ```
   - Sliding panel with global options
   - Master toggle for each data type
   - Estimated output size
   - Start merge button (sticky on mobile)
   ```

4. **Processing View**
   ```
   - Full-screen takeover
   - Circular progress with percentage
   - Current step description
   - Cancel button
   - Success animation on completion
   ```

### Color Scheme
- **Primary**: Blue-600 (#2563eb) - Trust and reliability
- **Secondary**: Emerald-600 (#059669) - Success states
- **Accent**: Amber-500 (#f59e0b) - Warnings
- **Neutral**: Slate scale for UI elements
- **Error**: Red-600 (#dc2626)

### Modern UI Patterns
1. **Micro-interactions**: Subtle animations on hover/click
2. **Skeleton Screens**: During loading states
3. **Toast Notifications**: For non-blocking feedback
4. **Command Palette**: (Cmd+K) for power users
5. **Dark Mode**: System preference detection

## User Flows

### Primary Flow: Anonymous Merge
1. Land on homepage
2. Drag multiple .jwlibrary files
3. Configure merge options
4. Click "Merge Files"
5. Wait for processing
6. Download merged file

### Secondary Flow: Authenticated User
1. Click "Sign In" → Enter email
2. Receive magic link → Authenticate
3. Upload and merge files
4. View in merge history
5. Re-download from dashboard

## Database Schema (Supabase)

```sql
-- Users table (handled by Supabase Auth)

-- Merge history
CREATE TABLE merges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(20) NOT NULL,
  input_file_count INTEGER NOT NULL,
  output_file_url TEXT,
  expires_at TIMESTAMPTZ,
  metadata JSONB
);

-- Merge statistics
CREATE TABLE merge_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merge_id UUID REFERENCES merges(id),
  notes_count INTEGER,
  bookmarks_count INTEGER,
  underlines_count INTEGER,
  tags_count INTEGER,
  data_types_selected JSONB
);

-- User preferences
CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  default_merge_options JSONB,
  ui_preferences JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Analytics & Metrics

### Key Metrics (Vercel Analytics)
1. **Usage Metrics**
   - Daily active users
   - Files processed per day
   - Average merge size
   - Feature adoption rates

2. **Performance Metrics**
   - Page load times
   - Merge processing duration
   - Error rates by operation
   - API response times

3. **User Journey Metrics**
   - Conversion funnel (upload → merge → download)
   - Drop-off points
   - Feature discovery rates
   - Return user percentage

## Security & Privacy

1. **Data Handling**
   - Files processed in memory, not persisted
   - 24-hour auto-deletion of temporary files
   - No backup content stored in database
   - Client-side encryption option

2. **Authentication**
   - Passwordless (magic links)
   - Session management with JWT
   - Rate limiting on all endpoints

3. **Compliance**
   - GDPR-compliant data handling
   - Clear privacy policy
   - Data export capabilities
   - Right to deletion

## Performance Requirements

1. **Response Times**
   - Page load: < 2s (FCP)
   - File upload: Stream with progress
   - Merge operation: < 30s for typical files
   - Download initiation: < 1s

2. **Scalability**
   - Support 1000+ concurrent users
   - Handle files up to 100MB (MVP)
   - Auto-scaling serverless functions

## Success Criteria

1. **Adoption Metrics**
   - 1000+ merges per week within 3 months
   - 30% user registration rate
   - 4.5+ user satisfaction score

2. **Technical Metrics**
   - 99.9% uptime
   - < 0.1% merge failure rate
   - < 3s average merge time

## Development Phases

### Phase 1: MVP (8 weeks)
- Core merging functionality
- Basic UI with file management
- Anonymous usage only
- Essential error handling

### Phase 2: User Accounts (4 weeks)
- Authentication system
- Merge history
- Advanced tools
- Enhanced UI/UX

### Phase 3: Premium Features (4 weeks)
- Extended retention
- API access
- Batch operations
- Advanced analytics

## Risk Mitigation

1. **Large File Handling**
   - Implement chunked uploads
   - Stream processing where possible
   - Clear size limit messaging

2. **Browser Compatibility**
   - Progressive enhancement
   - Fallback for older browsers
   - Mobile-specific optimizations

3. **Privacy Concerns**
   - Clear data handling disclosure
   - Optional anonymous mode
   - No tracking without consent

## Appendix A: Supported Data Types

Based on analysis of the desktop application, the following data types must be supported:

1. **Bible Notes**
   - Verse-specific annotations
   - Color-coded highlights (6 colors)
   - Tag associations
   - Title and content fields

2. **Bookmarks**
   - Bible verse bookmarks
   - Publication page bookmarks
   - Publication paragraph bookmarks
   - Slot position for ordering

3. **User Marks (Highlighting)**
   - Color indexes: 1=Yellow, 2=Green, 3=Blue, 4=Pink, 5=Orange, 6=Purple
   - Start/end token positions
   - Block ranges for precise highlighting

4. **Tags**
   - System tags (Favorites)
   - User-defined tags
   - Tag-to-content mappings

5. **Input Fields**
   - Form field responses
   - Text tag/value pairs

6. **Playlists**
   - Media item collections
   - Playlist markers with timestamps
   - Thumbnail associations
   - Start/end actions

## Appendix B: File Format Specifications

### .jwlibrary File Structure
- ZIP archive containing:
  - `manifest.json` - Metadata about the backup
  - `userData.db` - SQLite database with all content
  - Media files (if playlists included)

### Manifest Schema
```json
{
  "name": "backup_name",
  "creationDate": "YYYY-MM-DD",
  "version": 1,
  "type": 0,
  "userDataBackup": {
    "deviceName": "Device Name",
    "databaseName": "userData.db",
    "hash": "sha256_hash",
    "schemaVersion": 14
  }
}
```

This PRD provides a comprehensive roadmap for building a modern, web-based version of JWLMerge that maintains the desktop version's functionality while leveraging web technologies for improved accessibility and user experience.