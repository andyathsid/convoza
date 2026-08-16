import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import {  inter } from "@/fonts/inter";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/features/auth";
import { Toaster } from "@/components/ui/sonner";

const description = "Convoza is a real-time chat application.";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "Convoza",
  title: {
    default: "Convoza",
    template: "%s | Convoza",
  },
  description,
  openGraph: {
    type: "website",
    title: "Convoza",
    description,
    siteName: "Convoza",
  },
  twitter: {
    card: "summary",
    title: "Convoza",
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="h-full antialiased">
        <ThemeProvider defaultTheme="light">
          <AuthProvider>
            {children}
          </AuthProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
