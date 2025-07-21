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
          <h2 className="text-xl font-semibold">Your Privacy is Protected</h2>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="flex items-start space-x-3">
            <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
              <Lock className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h3 className="font-medium">Client-Side Processing</h3>
              <p className="text-sm text-muted-foreground">
                Your JWL files are processed entirely in your browser. No data is sent to our servers.
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-purple-100">
              <Eye className="h-4 w-4 text-purple-600" />
            </div>
            <div>
              <h3 className="font-medium">No Data Collection</h3>
              <p className="text-sm text-muted-foreground">
                We don&apos;t store, analyze, or share any of your personal data or file contents.
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-orange-100">
              <Shield className="h-4 w-4 text-orange-600" />
            </div>
            <div>
              <h3 className="font-medium">Secure by Design</h3>
              <p className="text-sm text-muted-foreground">
                Built with privacy-first principles. Your data never leaves your device.
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