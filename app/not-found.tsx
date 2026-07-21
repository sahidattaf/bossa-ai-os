import Link from "next/link";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function RootNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you're looking for doesn't exist."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/">Back to home</Link>
          </Button>
        }
        className="max-w-md"
      />
    </div>
  );
}
