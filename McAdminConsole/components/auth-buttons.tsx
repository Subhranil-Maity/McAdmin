"use client";

import { SignInButton, SignUpButton, Show, UserButton } from "@clerk/nextjs";

export function AuthButtons() {
  return (
    <div className="flex items-center gap-4">
      <Show when="signed-out">
        <SignInButton mode="modal" forceRedirectUrl="/">
          <button className="px-4 py-1.5 text-sm font-medium text-zinc-900 bg-white border border-zinc-200 rounded-md hover:bg-zinc-100 dark:bg-zinc-950 dark:text-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900 cursor-pointer">
            Sign In
          </button>
        </SignInButton>
        <SignUpButton mode="modal" forceRedirectUrl="/">
          <button className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 cursor-pointer">
            Sign Up
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
