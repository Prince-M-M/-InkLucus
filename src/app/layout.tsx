import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { logout } from "./actions";
import "./globals.css";

export const metadata: Metadata = { title: "Bookplatform", description: "Read, listen to and publish books in many languages." };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
        <header className="border-b border-stone-200 dark:border-stone-800">
          <nav className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-3">
            <Link href="/" className="font-bold">Bookplatform</Link>
            <Link href="/browse" className="text-sm">Browse</Link>
            <Link href="/become-an-author" className="hidden text-sm sm:inline">Write with us</Link>
            <div className="ml-auto flex items-center gap-4 text-sm">
              {user ? (
                <>
                  {user.role === "AUTHOR" && <Link href="/author">Author</Link>}
                  {(user.role === "EDITOR" || user.role === "ADMIN") && <Link href="/editor">Editor</Link>}
                  <Link href="/dashboard">Dashboard</Link>
                  <form action={logout}><button>Log out</button></form>
                </>
              ) : (
                <>
                  <Link href="/login">Log in</Link>
                  <Link href="/register" className="rounded-md bg-stone-900 px-3 py-1.5 text-white dark:bg-stone-100 dark:text-stone-900">Sign up</Link>
                </>
              )}
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
