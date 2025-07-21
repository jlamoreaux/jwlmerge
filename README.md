# JWLMerge Web

A modern web application for merging JW Library backup files (.jwlibrary) with a focus on privacy, performance, and ease of use.

## Features

- 🔀 Merge multiple JW Library backup files
- 🎯 Selective merging (notes, bookmarks, underlining, tags, etc.)
- 🔒 Privacy-first design with client-side processing
- 📱 Works on all devices (desktop, tablet, mobile)
- ⚡ Fast processing with serverless functions
- 📊 Optional user accounts for backup history

## Tech Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS + shadcn/ui
- **Database**: Supabase (PostgreSQL)
- **File Storage**: Vercel Blob Storage
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

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your values
```

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
├── app/                    # Next.js app directory
│   ├── (auth)/            # Auth routes (login, register)
│   ├── (dashboard)/       # Protected dashboard routes
│   ├── api/               # API routes
│   └── page.tsx           # Home page
├── components/            # React components
│   ├── ui/               # shadcn/ui components
│   ├── features/         # Feature-specific components
│   └── shared/           # Shared components
├── lib/                   # Core logic
│   ├── actions/          # Server actions
│   ├── db/               # Database utilities
│   ├── merge/            # Merge logic
│   └── types/            # TypeScript types
├── hooks/                # Custom React hooks
└── stores/               # Zustand stores
```

## Coding Standards

Please refer to [CLAUDE.md](./CLAUDE.md) for detailed coding standards and guidelines.

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Vercel Blob Storage
BLOB_READ_WRITE_TOKEN=your_blob_token

# Database URL (for migrations)
DATABASE_URL=your_database_url
```

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
<!-- TASKMASTER_EXPORT_START -->
> 🎯 **Taskmaster Export** - 2025-07-21 01:32:15 UTC
> 📋 Export: with subtasks • Status filter: none
> 🔗 Powered by [Task Master](https://task-master.dev?utm_source=github-readme&utm_medium=readme-export&utm_campaign=jwlmerge-web&utm_content=task-export-link)

| Project Dashboard |  |
| :-                |:-|
| Task Progress     | ░░░░░░░░░░░░░░░░░░░░ 0% |
| Done | 0 |
| In Progress | 0 |
| Pending | 10 |
| Deferred | 0 |
| Cancelled | 0 |
|-|-|
| Subtask Progress | ░░░░░░░░░░░░░░░░░░░░ 0% |
| Completed | 0 |
| In Progress | 0 |
| Pending | 51 |


| ID | Title | Status | Priority | Dependencies | Complexity |
| :- | :-    | :-     | :-       | :-           | :-         |
| 1 | Initialize Project and Core Dependencies | ○&nbsp;pending | high | None | ● 2 |
| 1.1 | Design and Implement User Authentication Database Schema | ○&nbsp;pending | -            | None | N/A |
| 1.2 | Develop User Registration API Endpoint | ○&nbsp;pending | -            | 1 | N/A |
| 1.3 | Implement User Login API Endpoint and JWT Generation | ○&nbsp;pending | -            | 1, 2 | N/A |
| 1.4 | Create Authentication Middleware for Protected Routes | ○&nbsp;pending | -            | 3 | N/A |
| 1.5 | Develop a 'Get Current User' Protected Endpoint | ○&nbsp;pending | -            | 4 | N/A |
| 2 | Build Homepage and File Upload Component | ○&nbsp;pending | high | 1 | ● 4 |
| 2.1 | Design and Implement User Database Schema | ○&nbsp;pending | -            | None | N/A |
| 2.2 | Develop User Registration API Endpoint | ○&nbsp;pending | -            | 1 | N/A |
| 2.3 | Develop User Login API Endpoint and JWT Generation | ○&nbsp;pending | -            | 1 | N/A |
| 2.4 | Implement Authentication Middleware for Protected Routes | ○&nbsp;pending | -            | 3 | N/A |
| 3 | Implement Client-Side File Validation and Metadata Parsing | ○&nbsp;pending | high | 2 | ● 6 |
| 3.1 | Design and Implement User Database Schema | ○&nbsp;pending | -            | None | N/A |
| 3.2 | Create User Registration API Endpoint | ○&nbsp;pending | -            | 1 | N/A |
| 3.3 | Create User Login API Endpoint and JWT Generation | ○&nbsp;pending | -            | 1 | N/A |
| 3.4 | Implement Authentication Middleware for Protected Routes | ○&nbsp;pending | -            | 3 | N/A |
| 3.5 | Implement Password Reset Flow | ○&nbsp;pending | -            | 1 | N/A |
| 4 | Create File Management UI with Data Type Toggles | ○&nbsp;pending | high | 3 | ● 5 |
| 4.1 | Design and Implement User Database Schema | ○&nbsp;pending | -            | None | N/A |
| 4.2 | Develop User Registration API Endpoint | ○&nbsp;pending | -            | 1 | N/A |
| 4.3 | Develop User Login API Endpoint | ○&nbsp;pending | -            | 1 | N/A |
| 4.4 | Implement Authentication Middleware for Protected Routes | ○&nbsp;pending | -            | 3 | N/A |
| 5 | Develop Global Merge Configuration Panel | ○&nbsp;pending | high | 4 | ● 4 |
| 5.1 | Design and Implement User Database Schema | ○&nbsp;pending | -            | None | N/A |
| 5.2 | Develop User Registration API Endpoint | ○&nbsp;pending | -            | 1 | N/A |
| 5.3 | Develop User Login Endpoint and JWT Generation | ○&nbsp;pending | -            | 1 | N/A |
| 5.4 | Implement Authentication Middleware for Protected Routes | ○&nbsp;pending | -            | 3 | N/A |
| 6 | Configure Backend Infrastructure (Vercel & Supabase) | ○&nbsp;pending | high | 1 | ● 3 |
| 6.1 | Design and Create User Database Schema | ○&nbsp;pending | -            | None | N/A |
| 6.2 | Implement Secure Password Hashing Service | ○&nbsp;pending | -            | None | N/A |
| 6.3 | Develop User Registration API Endpoint | ○&nbsp;pending | -            | 1, 2 | N/A |
| 6.4 | Develop User Login API Endpoint and JWT Generation | ○&nbsp;pending | -            | 1, 2 | N/A |
| 7 | Implement Core Merging Logic in a Serverless Function | ○&nbsp;pending | high | 6 | ● 8 |
| 7.1 | Design and Implement User Database Schema | ○&nbsp;pending | -            | None | N/A |
| 7.2 | Develop User Registration API Endpoint | ○&nbsp;pending | -            | 1 | N/A |
| 7.3 | Develop User Login API Endpoint | ○&nbsp;pending | -            | 1, 2 | N/A |
| 7.4 | Implement Authentication Middleware for Protected Routes | ○&nbsp;pending | -            | 3 | N/A |
| 7.5 | Create a Protected 'Get User Profile' Endpoint | ○&nbsp;pending | -            | 4 | N/A |
| 7.6 | Implement 'Forgot Password' Request Flow | ○&nbsp;pending | -            | 1 | N/A |
| 7.7 | Implement 'Reset Password' Confirmation Flow | ○&nbsp;pending | -            | 6 | N/A |
| 7.8 | Implement Logout Functionality | ○&nbsp;pending | -            | 4 | N/A |
| 8 | Integrate Frontend with Backend Merge Flow | ○&nbsp;pending | high | 5, 7 | ● 7 |
| 8.1 | Design and Implement User Database Schema | ○&nbsp;pending | -            | None | N/A |
| 8.2 | Implement Secure Password Hashing Service | ○&nbsp;pending | -            | 1 | N/A |
| 8.3 | Develop API Endpoint for User Registration | ○&nbsp;pending | -            | 1, 2 | N/A |
| 8.4 | Develop API Endpoint for User Login | ○&nbsp;pending | -            | 1, 2 | N/A |
| 8.5 | Implement JWT Generation and Validation Middleware | ○&nbsp;pending | -            | None | N/A |
| 8.6 | Create Frontend Login and Registration UI | ○&nbsp;pending | -            | 3, 4 | N/A |
| 9 | Implement Result Download and Error Handling | ○&nbsp;pending | high | 8 | ● 4 |
| 9.1 | Design and Set Up User Database Schema | ○&nbsp;pending | -            | None | N/A |
| 9.2 | Develop User Registration API Endpoint | ○&nbsp;pending | -            | 1 | N/A |
| 9.3 | Implement User Login API Endpoint | ○&nbsp;pending | -            | 1 | N/A |
| 9.4 | Create Authentication Middleware | ○&nbsp;pending | -            | 3 | N/A |
| 9.5 | Implement 'Get User Profile' Protected Endpoint | ○&nbsp;pending | -            | 4 | N/A |
| 10 | Finalize UI/UX Polish and Deploy MVP | ○&nbsp;pending | medium | 9 | ● 5 |
| 10.1 | Design and Implement User Database Schema | ○&nbsp;pending | -            | None | N/A |
| 10.2 | Develop User Registration API Endpoint | ○&nbsp;pending | -            | 1 | N/A |
| 10.3 | Develop User Login API Endpoint and JWT Generation | ○&nbsp;pending | -            | 1 | N/A |
| 10.4 | Create Authentication Middleware for Protected Routes | ○&nbsp;pending | -            | 3 | N/A |
| 10.5 | Build Frontend Registration and Login Forms | ○&nbsp;pending | -            | None | N/A |
| 10.6 | Integrate Frontend Forms with Authentication API | ○&nbsp;pending | -            | 2, 3, 5 | N/A |

> 📋 **End of Taskmaster Export** - Tasks are synced from your project using the `sync-readme` command.
<!-- TASKMASTER_EXPORT_END -->
