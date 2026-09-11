import { redirect } from "next/navigation";

export default function LegacyConsolePage() {
  redirect("/dashboard");
}
