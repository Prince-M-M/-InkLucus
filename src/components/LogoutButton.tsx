"use client";
import { logout } from "@/app/account/actions";

/** Logging out also clears books saved for offline reading on this device. */
export function LogoutButton() {
  return (
    <form
      action={logout}
      onSubmit={() => {
        if ("caches" in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }}
    >
      <button>Log out</button>
    </form>
  );
}
