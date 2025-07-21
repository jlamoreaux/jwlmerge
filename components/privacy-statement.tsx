import { Shield, Lock, Eye } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

export function PrivacyStatement() {
  return (
    <Card className="mx-auto mt-12 max-w-4xl">
      <CardContent className="p-6">
        <div className="mb-6 flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
            <Shield className="h-5 w-5 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold">Maximum Privacy Protection</h2>
        </div>

        <div className="mb-6 rounded-lg bg-green-50 p-4 border border-green-200">
          <p className="text-sm text-green-800">
            <strong>Secure Client-Side Processing:</strong> All file processing happens entirely in your browser.
            Your files never leave your device, ensuring maximum privacy and security.
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <div className="mb-3 flex items-center space-x-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
              <Lock className="h-4 w-4 text-green-600" />
            </div>
            <h3 className="font-medium">Client-Side Processing</h3>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Files processed entirely in your browser</li>
            <li>• No data sent to our servers</li>
            <li>• Maximum privacy protection</li>
            <li>• Works offline after initial load</li>
            <li>• All processing happens on your device</li>
          </ul>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="flex items-start space-x-3">
            <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-purple-100">
              <Eye className="h-4 w-4 text-purple-600" />
            </div>
            <div>
              <h3 className="font-medium">No Content Analysis</h3>
              <p className="text-sm text-muted-foreground">
                We never read, analyze, or learn from your file contents, regardless of processing mode.
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-orange-100">
              <Shield className="h-4 w-4 text-orange-600" />
            </div>
            <div>
              <h3 className="font-medium">Open Source</h3>
              <p className="text-sm text-muted-foreground">
                Complete transparency - you can review our code and verify our privacy practices.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-lg bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            <strong>Open Source:</strong> This application is completely open source. You can review the code
            and verify our privacy claims at any time.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}