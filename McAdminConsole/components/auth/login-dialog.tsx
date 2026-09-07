"use client";

import React, { useState } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, User, Lock, Loader2, AlertCircle, Sparkles } from "lucide-react";

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
  const { login, register, isFirstRun } = useAuth();
  const [tab, setTab] = useState<"login" | "register">(isFirstRun ? "register" : "login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanUsername = username.trim();
    if (cleanUsername.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (tab === "register" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      if (tab === "login") {
        await login(cleanUsername, password);
      } else {
        await register(cleanUsername, password);
      }
      onOpenChange(false);
      setUsername("");
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-zinc-950 border-zinc-800 text-zinc-50 p-6 shadow-2xl">
        <DialogHeader className="space-y-2 text-center items-center">
          <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-200">
            <Shield className="w-6 h-6 text-zinc-300" />
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight">
            {tab === "login" ? "Sign in to McAdmin" : "Create an Account"}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            {isFirstRun && tab === "register"
              ? "First-time setup: This initial account will receive Superuser privileges."
              : tab === "login"
              ? "Enter your username and password to access server management."
              : "Register a local account to manage Minecraft instances."}
          </DialogDescription>
        </DialogHeader>

        {isFirstRun && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium">
            <Sparkles className="w-4 h-4 shrink-0 text-amber-400" />
            <span>Initial host setup detected: creating primary superuser.</span>
          </div>
        )}

        {/* Tab switcher */}
        <div className="grid grid-cols-2 p-1 rounded-xl bg-zinc-900 border border-zinc-800/80 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setTab("login");
              setError(null);
            }}
            className={`py-1.5 rounded-lg transition-all cursor-pointer ${
              tab === "login"
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("register");
              setError(null);
            }}
            className={`py-1.5 rounded-lg transition-all cursor-pointer ${
              tab === "register"
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Register
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Username</label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <Input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                className="pl-9 bg-zinc-900/80 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="pl-9 bg-zinc-900/80 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500"
              />
            </div>
          </div>

          {tab === "register" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">Confirm Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="pl-9 bg-zinc-900/80 border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500"
                />
              </div>
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl font-semibold bg-zinc-100 text-zinc-950 hover:bg-white active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : tab === "login" ? (
              "Sign In"
            ) : (
              "Create Account"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
