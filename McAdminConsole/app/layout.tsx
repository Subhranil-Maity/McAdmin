import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { cn } from "@/lib/utils";
import { shadcn } from "@clerk/ui/themes";
import { AuthButtons } from "@/components/auth-buttons";
import { currentUser } from "@clerk/nextjs/server";
import { getUserRole, canAccessManageUser } from "@/types/roles";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await currentUser();
  const role = user ? getUserRole(user.publicMetadata) : null;
  const canManage = role ? canAccessManageUser(role) : false;

  return (
    <html
      lang="en"
      className={"dark " + cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-50">
        <ClerkProvider appearance={{theme: shadcn}}>
          <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-black">
            <div className="flex items-center gap-6">
              <Link href="/" className="font-bold text-lg text-zinc-900 dark:text-zinc-50 hover:opacity-80 transition-opacity">
                MC Admin
              </Link>
              {user && (
                <nav className="flex items-center gap-4">
                  <Link
                    href="/dashboard"
                    className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors"
                  >
                    Dashboard
                  </Link>
                  {canManage && (
                    <Link
                      href="/manageuser"
                      className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors"
                    >
                      Manage Users
                    </Link>
                  )}
                </nav>
              )}
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

