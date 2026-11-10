export const metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <article className="mx-auto max-w-2xl space-y-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold">Privacy policy</h1>
      <p className="text-stone-500">Template. Have this reviewed before launch.</p>
      <p>We store your name, email, date of birth, purchases, wallet history, reading progress, wishlist, likes, reviews and comments to run the service. Your date of birth is used only to show age-appropriate books.</p>
      <p>Payments are handled by our payment providers (Paynow, Stripe). We never see or store your card or mobile money PIN.</p>
      <p>We use one essential cookie to keep you logged in, and a short-lived cookie for on-screen notifications. No advertising trackers.</p>
      <p>If your account is deleted, your personal details, comments and reviews are removed. Purchase records are kept anonymously for accounting.</p>
    </article>
  );
}
