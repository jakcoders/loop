"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Mode = "login" | "register";

export default function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "login" ? { email, password } : { name, email, password }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Something went wrong");
        setFieldErrors(data.fieldErrors ?? {});
        setBusy(false);
        return;
      }
      router.push("/app");
      router.refresh();
    } catch {
      setError("Network error — please try again");
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-lg border border-[#2A3040] bg-[#0B0D12] px-3.5 py-2.5 text-sm text-[#F5F7FA] placeholder-[#5B6476] outline-none transition focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/30";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] text-2xl font-bold shadow-lg shadow-[#6366F1]/25">
            ∞
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {mode === "login" ? "Sign in to Loop" : "Create your Loop account"}
          </h1>
          <p className="mt-1.5 text-sm text-[#8A93A6]">
            One backend. Every client. Stay in the loop.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-2xl border border-[#1E2432] bg-[#141821] p-6 shadow-xl"
        >
          {mode === "register" && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#8A93A6]">
                Full name
              </label>
              <input
                className={input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                required
              />
              {fieldErrors.name && (
                <p className="mt-1 text-xs text-[#EF4444]">{fieldErrors.name[0]}</p>
              )}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#8A93A6]">
              Email
            </label>
            <input
              className={input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@team.com"
              required
            />
            {fieldErrors.email && (
              <p className="mt-1 text-xs text-[#EF4444]">{fieldErrors.email[0]}</p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#8A93A6]">
              Password
            </label>
            <input
              className={input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
              required
            />
            {fieldErrors.password && (
              <p className="mt-1 text-xs text-[#EF4444]">{fieldErrors.password[0]}</p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/10 px-3 py-2 text-xs text-[#FCA5A5]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[#6366F1] py-2.5 text-sm font-semibold text-white transition hover:bg-[#5558E6] disabled:opacity-50"
          >
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>

          <p className="text-center text-xs text-[#8A93A6]">
            {mode === "login" ? (
              <>
                New to Loop?{" "}
                <Link href="/register" className="text-[#A5B4FC] hover:underline">
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Link href="/login" className="text-[#A5B4FC] hover:underline">
                  Sign in
                </Link>
              </>
            )}
          </p>
        </form>

        {mode === "login" && (
          <div className="mt-4 rounded-xl border border-[#1E2432] bg-[#141821]/60 p-4 text-xs text-[#8A93A6]">
            <p className="mb-1 font-semibold text-[#A5B4FC]">Demo accounts</p>
            <p>
              <span className="font-mono text-[#C7CEDD]">ada@loop.app</span> or{" "}
              <span className="font-mono text-[#C7CEDD]">grace@loop.app</span> — password{" "}
              <span className="font-mono text-[#C7CEDD]">loopdemo123</span>
            </p>
            <p className="mt-1.5">
              Tip: open a second browser (or incognito) with the other account to watch
              messages arrive live.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
