import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/auth";
import { FLASH_COOKIE } from "@/lib/form";
import { Toast } from "@/components/Toast";
import { LogoutButton } from "@/components/LogoutButton";
import { PwaRegister } from "@/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "InkLucus", template: "%s · InkLucus" },
  description: "Read, listen to and publish books in English, Shona, Ndebele and more.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};
export const viewport: Viewport = { themeColor: "#1c1917", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const flashPayload = (await cookies()).get(FLASH_COOKIE)?.value;
  const link = "whitespace-nowrap";
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
        <header className="border-b border-stone-200 dark:border-stone-800">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
            <Link href="/" className="font-bold">InkLucus</Link>
            <Link href="/browse" className="text-sm">Browse</Link>
            <Link href="/new" className="text-sm">New</Link>
            <Link href="/become-an-author" className="hidden text-sm sm:inline">Write with us</Link>
            <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {user ? (
                <>
                  {user.role === "AUTHOR" && <Link className={link} href="/author">Author</Link>}
                  {(user.role === "EDITOR" || user.role === "ADMIN") && <Link className={link} href="/editor">Editor</Link>}
                  {user.role === "ADMIN" && <Link className={link} href="/admin">Admin</Link>}
                  {(user.role === "ACCOUNTING" || user.role === "ADMIN") && <Link className={link} href="/accounting">Accounting</Link>}
                  <Link className={link} href="/dashboard">Dashboard</Link>
                  <Link className={link} href="/settings">Settings</Link>
                  <LogoutButton />
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
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-stone-200 py-6 text-sm text-stone-500 dark:border-stone-800">
          <div className="mx-auto flex max-w-6xl flex-wrap gap-x-5 gap-y-2 px-4">
            <span>© {new Date().getFullYear()} InkLucus</span>
            <Link href="/become-an-author">Write with us</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </div>
        </footer>
        <Toast payload={flashPayload} />
        <PwaRegister />
      </body>
    </html>
  );
}
