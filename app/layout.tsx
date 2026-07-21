import type { Metadata } from "next";

import { Toaster } from "@/components/ui/toaster";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Hospitality OS",
    template: "%s · Hospitality OS",
  },
  description:
    "Multi-tenant Hospitality OS — the executive dashboard for BOSSA Asado i Mar, Papai Since 1933, and future hospitality tenants.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" className="dark" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
