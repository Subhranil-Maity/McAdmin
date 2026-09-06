import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();

  if (!user) {
    redirect("/");
  }

  return (
    <div className="flex-1 w-full flex flex-col bg-zinc-950 text-zinc-50 min-h-[calc(100vh-4rem)]">
      {children}
    </div>
  );
}
