"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function UploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [ttl, setTtl] = useState("7d");
  const [slug, setSlug] = useState("");
  const [viewers, setViewers] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pickFile(f: File | null) {
    setError(null);
    setResult(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".html") && f.type !== "text/html") {
      setError("Only .html files are accepted.");
      return;
    }
    setFile(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose an HTML file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("ttl", ttl);
      if (slug.trim()) body.set("slug", slug.trim());
      if (viewers.trim()) body.set("viewers", viewers.trim());

      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed.");
      } else {
        setResult({ url: data.url });
        setFile(null);
        setSlug("");
        setViewers("");
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    } catch {
      setError("Network error during upload.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div
        className={
          "dropzone" +
          (dragging ? " drag" : "") +
          (file ? " has-file" : "")
        }
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pickFile(e.dataTransfer.files?.[0] ?? null);
        }}
      >
        {file ? (
          <>
            <strong>{file.name}</strong>
            <div className="sub">{(file.size / 1024).toFixed(1)} KB</div>
          </>
        ) : (
          <>Drag an .html file here, or click to browse</>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".html,text/html"
        style={{ display: "none" }}
        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
      />

      <div className="row">
        <div style={{ flex: "none", width: "100%", maxWidth: 200 }}>
          <label>Expires after</label>
          <select value={ttl} onChange={(e) => setTtl(e.target.value)}>
            <option value="24h">24 hours</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
          </select>
        </div>
        <div>
          <label>Custom slug (optional)</label>
          <input
            type="text"
            placeholder="auto-generated if blank"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </div>
      </div>

      <label>Allowed viewer emails (optional, comma-separated)</label>
      <input
        type="text"
        placeholder="teammate@example.com, other@example.com"
        value={viewers}
        onChange={(e) => setViewers(e.target.value)}
      />

      <div style={{ marginTop: 16 }}>
        <button className="btn" type="submit" disabled={busy || !file}>
          {busy ? "Uploading…" : "Upload & get link"}
        </button>
      </div>

      {error && <div className="notice err">{error}</div>}
      {result && (
        <div className="notice ok">
          Live at{" "}
          <a href={result.url} target="_blank" rel="noreferrer">
            {result.url}
          </a>
        </div>
      )}
    </form>
  );
}
