import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { cn } from "@/lib/utils";
import { shadcn } from "@clerk/ui/themes";
import { AuthButtons } from "@/components/auth-buttons";
import { NavbarLinks } from "@/components/navbar-links";
import Link from "next/link";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MC Admin",
  description: "Clerk User Management and Role Panel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={"dark " + cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-50">
        <ClerkProvider appearance={{theme: shadcn}}>
          <header className="h-16 flex items-center justify-between px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black shrink-0">
            <div className="flex items-center gap-6">
              <Link href="/" className="font-bold text-lg text-zinc-900 dark:text-zinc-50 hover:opacity-80 transition-opacity">
                MC Admin
              </Link>
              <NavbarLinks />
            </div>
            <AuthButtons />
          </header>
          <div className="flex-1 flex flex-col">
            {children}
          </div>
        </ClerkProvider>
      </body>
    </html>
  );
}

