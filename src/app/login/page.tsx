"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatus("");

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/app");
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          router.replace("/app");
          router.refresh();
        } else {
          setStatus("Account created. Confirm your email, then sign in.");
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="authShell">
      <section className="authCard">
        <div className="authBrand">
          <div className="tensorMark">T</div>
          <div>
            <strong>TENSORRA</strong>
            <span>AI workspace</span>
          </div>
        </div>

        <div className="authCopy">
          <p className="eyebrow">{mode === "login" ? "WELCOME BACK" : "CREATE ACCOUNT"}</p>
          <h1>{mode === "login" ? "Continue to TENSORRA" : "Start with TENSORRA"}</h1>
          <p>One account for chats, memory and future AI agents.</p>
        </div>

        <form className="authForm" onSubmit={submit}>
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label>
            Password
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </label>
          <button className="primaryButton" disabled={loading} type="submit">
            {loading ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        {status ? <p className="authStatus">{status}</p> : null}

        <button className="textButton" onClick={() => setMode(mode === "login" ? "signup" : "login")}> 
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
}
