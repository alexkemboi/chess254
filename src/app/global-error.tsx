"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#050506", color: "#f6f6f4", fontFamily: "system-ui", display: "grid", placeItems: "center", minHeight: "100vh", textAlign: "center" }}>
        <div>
          <h1>Something went wrong.</h1>
          <button onClick={reset} style={{ marginTop: 16, padding: "10px 18px", borderRadius: 999, border: 0, background: "#019c98", color: "#fff", fontWeight: 700 }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
