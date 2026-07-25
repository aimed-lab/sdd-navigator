// Temporary placeholder so the app builds. Real pages (Explore / Collaborate /
// Promote landing) are scaffolded later — this only proves the shell renders.
export default function Home() {
  return (
    <section className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-24 text-center">
      <span className="inline-block px-4 py-1 rounded-full bg-primary-container/10 text-primary font-label-sm uppercase tracking-widest">
        Shell scaffold
      </span>
      <h1 className="mt-6 font-display-lg text-display-lg text-on-background">
        Explore. Collaborate. Promote.
      </h1>
      <p className="mt-6 font-body-lg text-body-lg text-secondary max-w-2xl mx-auto">
        App shell is live — shared nav, footer, auth, tokens, and the Explore API
        path. Individual pages come next.
      </p>
    </section>
  );
}
