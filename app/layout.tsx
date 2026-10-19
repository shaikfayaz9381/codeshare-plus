import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { appUrl } from "@/lib/config/env";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "CodeShare Plus bundles code snippets, notes, and files into one shareable link — with passwords, expiry dates, and download controls.";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: {
    default: "CodeShare Plus — share code, files, and ideas in one link",
    template: "%s · CodeShare Plus",
  },
  description,
  applicationName: "CodeShare Plus",
  openGraph: {
    type: "website",
    title: "CodeShare Plus",
    description,
    siteName: "CodeShare Plus",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "CodeShare Plus",
    description,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // next-themes writes the theme class on <html> before paint.
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" className="flex flex-1 flex-col">
            {children}
          </main>
          <SiteFooter />
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
