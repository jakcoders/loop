import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser({ heartbeat: false });
  redirect(user ? "/app" : "/login");
}
