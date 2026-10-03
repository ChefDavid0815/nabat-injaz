'use client';
export default function ErrorBoundary({ reset }: { reset: () => void }) {
  return (
    <section className="panel empty">
      <h1>This record could not open.</h1>
      <p>Your changes are stored. Try again, or return to your collection.</p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
