import { redirect } from "next/navigation";

export default function LegacyOverviewPage() {
  redirect("/dashboard");
}
