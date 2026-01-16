"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NotFound() {
  const router = useRouter();

  useEffect(() => {
    const timeout = setTimeout(() => {
      router.push("/");
    }, 4000);

    return () => clearTimeout(timeout);
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0F]">
      <div className="max-w-md w-full mx-4 text-center">
        <div className="bg-[#12121A] border border-[#1A1A24] rounded-lg shadow-2xl p-8 space-y-6">
          <h1 className="text-6xl font-light text-[#A0153E] tracking-wide">
            404
          </h1>

          <p className="text-lg text-gray-300 font-light">Page not found</p>

          <p className="text-sm text-gray-500 font-light">
            You will be redirected to the homepage shortly.
          </p>

          <div className="pt-4">
            <Link
              href="/"
              className="text-sm text-[#A0153E] hover:text-[#FF204E] transition-colors font-medium"
            >
              Go now →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
