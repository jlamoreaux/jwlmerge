'use client';

import { PrivacyStatement } from '@/components/privacy-statement';
import { FileUploadZone } from '@/components/upload/file-upload-zone';

export default function Home() {
  const handleFilesSelected = (files: File[]) => {
    // TODO: Implement file processing logic
    if (files.length > 0) {
      // Files will be processed here
    }
  };

  return (
    <main className="min-h-screen">
      {/* Hero Section */}
      <section className="px-6 py-12 md:py-20">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mb-6 text-4xl font-bold tracking-tight md:text-6xl">
            JWL Merge Web
          </h1>
          <p className="mb-8 text-lg text-muted-foreground md:text-xl">
            Merge and manage your JWL library files with ease. Process files securely in your browser with complete privacy.
          </p>
        </div>
      </section>

      {/* Upload Section */}
      <section className="px-6 pb-12">
        <div className="mx-auto max-w-4xl">
          <FileUploadZone onFilesSelected={handleFilesSelected} />
        </div>
      </section>

      {/* Privacy Section - Below the fold */}
      <section className="px-6 pb-20">
        <PrivacyStatement />
      </section>
    </main>
  );
}