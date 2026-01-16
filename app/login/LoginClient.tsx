"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function LoginClient() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0F]">
      <div className="max-w-md w-full mx-4">
        <div className="bg-[#12121A] border border-[#1A1A24] rounded-lg shadow-2xl p-8 space-y-8">
          <div>
            <h2 className="text-3xl font-light text-white mb-2 tracking-wide">
              Sign In
            </h2>
            <p className="text-sm text-gray-500 font-light">
              Access your knowledge tree
            </p>
          </div>

          {registered && (
            <div className="bg-[#5D0E41]/20 border border-[#5D0E41]/30 text-gray-300 p-3 rounded-md text-sm font-light">
              Account created! Please sign in.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-[#FF204E]/20 border border-[#FF204E]/30 text-gray-300 p-3 rounded-md text-sm font-light">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-[#0A0A0F] border border-[#1A1A24] rounded-md text-white text-base placeholder-gray-600 focus:border-[#5D0E41] focus:ring-1 focus:ring-[#5D0E41] focus:outline-none font-light transition-all duration-200"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-[#0A0A0F] border border-[#1A1A24] rounded-md text-white text-base placeholder-gray-600 focus:border-[#5D0E41] focus:ring-1 focus:ring-[#5D0E41] focus:outline-none font-light transition-all duration-200"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#5D0E41] hover:bg-[#A0153E] text-white px-5 py-3 rounded-md text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 hover:shadow-lg"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>

            <p className="text-center text-sm text-gray-500 font-light">
              Don&apos;t have an account?{" "}
              <Link
                href="/register"
                className="text-[#A0153E] hover:text-[#FF204E] font-medium transition-colors"
              >
                Register
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
