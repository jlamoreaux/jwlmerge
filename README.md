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

- **Build tool**: Vite (React SPA — no framework runtime, no server)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS + shadcn/ui
- **Merge engine**: sql.js (SQLite via WebAssembly) + JSZip, in a Web Worker
- **Hosting**: Cloudflare Workers static assets
- **Package Manager**: Bun

Everything the app needs is served from its own origin. sql.js, JSZip and the
Inter font are all bundled or vendored at build time, so a merge works offline
and is not broken by a blocked CDN or a strict Content-Security-Policy.

## Getting Started

### Prerequisites

- Bun (latest version)
- Node.js 22.12+

Node 22.12 is the intersection of what the toolchain needs: Vite 8 requires
`^20.19.0 || >=22.12.0` and Wrangler 4 requires `>=22.0.0`. Building alone works
on Node 20.19+, but deploying does not, so the single number to install is
22.12.

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
├── index.html                  # Page shell; holds the no-JS fallback copy
├── src/
│   ├── main.tsx                # React entry point
│   ├── App.tsx                 # The whole UI is one page
│   └── globals.css
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
│   ├── favicon.svg
│   ├── vendor/                 # generated: sql.js + JSZip, copied at build time
│   └── workers/
│       └── merge-worker.js     # The merge engine (SQLite + ZIP)
├── scripts/
│   └── copy-vendor.mjs         # Populates public/vendor/ from node_modules
├── wrangler.jsonc              # Cloudflare Workers static-asset config
├── vite.config.ts
└── tests/                      # Bun tests, including end-to-end merge tests
```

## Deployment

The app is hosted on **Cloudflare Workers** as static assets. There is no
Worker script — `wrangler.jsonc` declares only an `assets` directory, and
Cloudflare serves the built files from the edge. `not_found_handling` is set to
`single-page-application` so refreshes and deep links reach the app rather than
a 404.

```bash
# Build and deploy
bun run deploy

# Build and serve the Worker locally, exactly as Cloudflare will
bun run cf-preview
```

`bun run deploy` runs the build first, so `dist/` is always current. Deploying
needs a Cloudflare account with Workers enabled; `wrangler login` once, then
the command above.

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
