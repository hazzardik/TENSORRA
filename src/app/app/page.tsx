import { redirect } from "next/navigation";
import ChatApp from "@/components/chat-app";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TensorraAppPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims?.sub) {
    redirect("/login");
  }

  return <ChatApp />;
}
