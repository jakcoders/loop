import { redirect } from "next/navigation";
import LoopApp from "@/components/LoopApp";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <LoopApp me={user} />;
}
