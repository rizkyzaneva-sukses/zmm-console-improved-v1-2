import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  // Kalau sudah login, langsung ke orders
  if (session) redirect("/orders");
  return <>{children}</>;
}
