# JWLMerge Web

A modern web application for merging JW Library backup files (.jwlibrary) with a focus on privacy, performance, and ease of use.

## Features

- 🔀 Merge multiple JW Library backup files
- 🎯 Selective merging (notes, bookmarks, underlining, tags, etc.)
- 🔒 Your backups never leave your device
- 📱 Works on all devices (desktop, tablet, mobile)
- 🛫 Works offline once the page has loaded

## Architecture

**Everything runs in the browser.** There is no backend, no database, and no
account system. Your backup files are read, merged and saved entirely on your
own device — they are never uploaded anywhere, so there is nothing to store and
nothing to sign in to.

A merge works like this:

1. You pick two or more `.jwlibrary` files. The browser reads them locally.
2. A Web Worker (`public/workers/merge-worker.js`) unzips each archive and
   opens its `userData.db` with [sql.js](https://sql.js.org) — SQLite compiled
   to WebAssembly.
3. The worker merges the databases: deduplicating locations, notes, highlights
   and tags, and remapping every foreign key so each record stays attached to
   its own content.
4. The merged database is re-zipped with a fresh manifest and handed back as a
   Blob, which the page saves to your downloads.

The work happens in a Worker so that a large merge does not freeze the page.

## Tech Stack

- **Framework**: Next.js 15 with App Router (static, no server routes)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS + shadcn/ui
- **Merge engine**: sql.js (SQLite via WebAssembly) + JSZip, in a Web Worker
- **Deployment**: Vercel
- **Package Manager**: Bun

## Getting Started

### Prerequisites

- Bun (latest version)
- Node.js 18+ (for compatibility)

### Installation

```bash
# Clone the repository
git clone [repository-url]
cd jwlmerge-web

# Install dependencies
bun install
```

No environment variables or external services are required.

### Development

```bash
# Start the development server
bun dev

# Run type checking
bun type-check

# Run linting
bun lint

# Run tests
bun test
```

### Building

```bash
# Create a production build
bun run build

# Start the production server
bun start
```

## Project Structure

```
jwlmerge-web/
├── app/                        # Next.js app directory
│   ├── layout.tsx
│   └── page.tsx                # The whole UI is one page
├── components/
│   ├── ui/                     # shadcn/ui primitives
│   ├── upload/                 # File picker and metadata display
│   ├── file-management/        # Selected-file list and controls
│   └── merge/                  # Merge configuration, progress, action button
├── lib/
│   ├── merge/                  # Merge entry point and orchestration
│   ├── workers/                # Web Worker client
│   ├── validation/             # .jwlibrary structure and manifest checks
│   ├── types/                  # Shared TypeScript types
│   └── utils/                  # Device capability and file size helpers
├── public/
│   └── workers/
│       └── merge-worker.js     # The merge engine (SQLite + ZIP)
└── tests/                      # Bun tests, including end-to-end merge tests
```

## Coding Standards

Please refer to [CLAUDE.md](./CLAUDE.md) for detailed coding standards and guidelines.

## Environment Variables

None. The app has no backend and no external services, so it builds and runs
with no configuration.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Original JWLMerge desktop application for inspiration
- The JW Library backup file format documentation
- All contributors and testers
