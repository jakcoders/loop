import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser({ heartbeat: false });
  if (user) redirect("/app");
  return <AuthForm mode="login" />;
}
