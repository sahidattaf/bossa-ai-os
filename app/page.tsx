import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listTenants } from "@/lib/tenancy/tenants";

export default function RootPage() {
  const tenants = listTenants();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-6 text-foreground">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Hospitality OS</h1>
        <p className="mt-2 text-muted-foreground">
          One platform, isolated workspaces. Choose an organization to open its dashboard.
        </p>
      </div>
      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        {tenants.map((tenant) => (
          <Card key={tenant.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
                  {tenant.branding.logoInitials}
                </span>
                {tenant.name}
              </CardTitle>
              <CardDescription>{tenant.productKpi.label} · {tenant.currency}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href={`/${tenant.slug}/dashboard`}>Open dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
