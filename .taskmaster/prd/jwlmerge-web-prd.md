# Product Requirements Document: JWLMerge Web

## Executive Summary
JWLMerge Web is a modern web application that brings the desktop JWLMerge functionality to the browser, enabling users to merge JW Library backup files without installing software. The application prioritizes privacy, ease of use and performance. It runs entirely in the browser: there is no backend, no database and no account system, and backup files are never uploaded anywhere.

## Product Overview

### Vision
Create a zero-friction web tool that allows JW Library users to merge their backup files from any device with a modern, intuitive interface while maintaining the privacy-focused approach of the desktop application.

### Key Differentiators
- **No Installation Required**: Works in any modern browser
- **Privacy-First**: Everything is processed on the user's own device; files are never uploaded
- **Modern UX**: Simplified workflow compared to desktop version
- **Cross-Platform**: Works on any OS including mobile devices
- **No Account Needed**: Nothing to sign up for, nothing stored about the user

## Technical Architecture

### Frontend Stack
- **Build tool**: Vite (React single-page app; no framework runtime)
- **UI Library**: Tailwind CSS + shadcn/ui components
- **State Management**: Zustand for complex state, React Context for simple state
- **File Handling**: react-dropzone for drag-and-drop
- **Analytics**: none currently (Cloudflare Web Analytics is available if wanted)

### Backend Stack
None. The application is served as static assets from Cloudflare Workers.
There are no API routes, no serverless functions, no database and no file
storage — `wrangler.jsonc` declares an assets directory and nothing else.

### Architecture Decisions

1. **Client-Side Only Processing**
   - Every step runs in the browser: validation, manifest reading, and the
     merge itself
   - Merging happens in a Web Worker so a large merge does not freeze the page
   - SQLite runs in the browser via sql.js (WebAssembly); ZIP handling via JSZip

2. **No Persistence**
   - Nothing about the user or their files is stored anywhere
   - This is what makes the privacy claim verifiable rather than a promise:
     there is no server that *could* retain anything

3. **File Processing Flow**
   ```
   Browser reads files → Web Worker merges → Blob → Browser saves
   ```

## Core Features

### Phase 1: MVP (Essential Features)

1. **File Selection & Validation**
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
   - One-click download (saved straight from the browser)

### Phase 2: Enhanced Features

1. **Advanced Tools**
   - Remove notes by tag
   - Remove underlining by color
   - Bible notes export (CSV/Excel)
   - Preview backup contents

2. **Batch Operations**
   - Save merge presets (stored locally in the browser)
   - Apply saved configurations
   - Merge several sets in sequence

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

## User Flow

There is one flow, and it needs no account:

1. Land on homepage
2. Drag multiple .jwlibrary files
3. Configure merge options
4. Click "Merge Files"
5. Wait for processing (in the browser)
6. Save merged file

## Data Storage

None. The application has no database. Nothing about a user, their files or
their merges is persisted anywhere — the merged file exists only in the
browser's memory until the user saves it.

## Analytics & Metrics

### Key Metrics (if analytics is added)
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
   - Conversion funnel (select files → merge → save)
   - Drop-off points
   - Feature discovery rates
   - Return user percentage

## Security & Privacy

1. **Data Handling**
   - Files are read into browser memory and never uploaded
   - Nothing is persisted: no server, no database, no temporary storage
   - Closing the tab discards everything

2. **No Accounts**
   - There is no sign-in, no session and no user record
   - Nothing to breach, and nothing to hand over

3. **Compliance**
   - No personal data is collected or processed, so there is nothing to
     export or delete
   - Clear privacy statement shown in the app

## Performance Requirements

1. **Response Times**
   - Page load: < 2s (FCP)
   - File reading: progress reported as each file is read
   - Merge operation: < 30s for typical files
   - Download initiation: < 1s

2. **Scalability**
   - Static hosting: concurrent users cost nothing to serve
   - Handle files up to 100MB, subject to the device's available memory

## Success Criteria

1. **Adoption Metrics**
   - 1000+ merges per week within 3 months
   - 4.5+ user satisfaction score

2. **Technical Metrics**
   - 99.9% uptime
   - < 0.1% merge failure rate
   - < 3s average merge time

## Development Phases

### Phase 1: MVP (8 weeks)
- Core merging functionality
- Basic UI with file management
- Essential error handling

### Phase 2: Enhanced Tools (4 weeks)
- Remove notes by tag, underlining by colour
- Bible notes export
- Backup content preview
- Enhanced UI/UX

## Risk Mitigation

1. **Large File Handling**
   - Warn before a merge the device may not have memory for
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