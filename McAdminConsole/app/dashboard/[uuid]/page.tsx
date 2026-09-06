import { redirect } from "next/navigation";

export default async function InstanceIndexPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  redirect(`/dashboard/${uuid}/overview`);
}
