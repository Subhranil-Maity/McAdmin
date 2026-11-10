import { Outlet } from "react-router";
import { AuthProvider } from "@/lib/auth/auth-context";
import { AppShell } from "@/components/app-shell";

/**
 * Root layout: the <html>/<body> shell, fonts and metadata now live in
 * index.html and app/main.tsx.
 */
export default function RootLayout() {
  return (
    <AuthProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </AuthProvider>
  );
}
