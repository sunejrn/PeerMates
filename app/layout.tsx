import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { ThemeApplier } from "@/components/settings/ThemeApplier";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/* fonts */
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* metadata */
export const metadata: Metadata = {
  title: "PeerMates - Real-Time Synchronized Watch Parties",
  description:
    "Watch videos together in real-time with frame-accurate sync, live chat, and presence.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PeerMates",
  },
  icons: {
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#333333" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "h-full antialiased",
        geistSans.variable,
        geistMono.variable,
        inter.variable,
        "font-sans"
      )}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground antialiased selection:bg-foreground selection:text-background">
        <ThemeApplier />
        <ServiceWorkerRegister />
        <QueryProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </QueryProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
