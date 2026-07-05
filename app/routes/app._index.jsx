import { useState, useCallback, useEffect } from "react";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { ok: true };
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
export function ErrorBoundary() { return boundary.error(useRouteError()); }

export default function Index() {
  const [tab, setTab] = useState("upload"); // "upload" | "shopify"
  const [files, setFiles] = useState([]);
  const [isConverting, setIsConverting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [shopifyFiles, setShopifyFiles] = useState([]);
  const [loadingShopifyFiles, setLoadingShopifyFiles] = useState(false);
  const [convertingIds, setConvertingIds] = useState({});

  // Load Shopify Files when tab switches
  useEffect(() => {
    if (tab === "shopify") loadShopifyFiles();
  }, [tab]);

  const loadShopifyFiles = async () => {
    setLoadingShopifyFiles(true);
    try {
      const res = await fetch("/api/shopify-files");
      const data = await res.json();
      setShopifyFiles(data.files || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingShopifyFiles(false);
    }
  };

  const handleConvertShopifyFile = async (file) => {
    setConvertingIds((prev) => ({ ...prev, [file.id]: "converting" }));
    try {
      const urlParts = file.url?.split("/") || [];
      const rawFilename = urlParts[urlParts.length - 1]?.split("?")[0] || "image";
      const baseName = rawFilename.replace(/\.[^.]+$/, "");
      const webpFilename = `${baseName}.webp`;

      const res = await fetch("/api/converturl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: file.url, filename: webpFilename, fileId: file.id }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setConvertingIds((prev) => ({ ...prev, [file.id]: "done" }));
      setShopifyFiles((prev) => prev.filter((f) => f.id !== file.id));
    } catch (e) {
      setConvertingIds((prev) => ({ ...prev, [file.id]: "error:" + e.message }));
    }
  };

  const handleConvertAllShopifyFiles = async () => {
    for (const file of shopifyFiles) {
      if (!convertingIds[file.id]) {
        await handleConvertShopifyFile(file);
      }
    }
  };

  // Upload tab logic
  const processFiles = useCallback((newRawFiles) => {
    const newFiles = Array.from(newRawFiles)
      .filter((f) => /\.(jpe?g|png)$/i.test(f.name))
      .map((file) => ({
        id: Math.random().toString(36).substring(7),
        originalFile: file,
        originalURL: URL.createObjectURL(file),
        originalSize: (file.size / 1024).toFixed(1),
        convertedBlob: null,
        convertedURL: null,
        convertedSize: null,
        status: "pending",
        error: null,
        savedToShopify: false,
        savingToShopify: false,
        shopifyError: null,
      }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleFileInput = (e) => { if (e.target.files?.length) processFiles(e.target.files); };
  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files); };

  const convertFile = async (fileObj) => {
    setFiles((prev) => prev.map((f) => f.id === fileObj.id ? { ...f, status: "converting", error: null } : f));
    try {
      const formData = new FormData();
      formData.append("file", fileObj.originalFile);
      const response = await fetch("/api/convert", { method: "POST", body: formData });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const blob = await response.blob();
      setFiles((prev) => prev.map((f) => f.id === fileObj.id
        ? { ...f, convertedBlob: blob, convertedURL: URL.createObjectURL(blob), convertedSize: (blob.size / 1024).toFixed(1), status: "done" }
        : f));
    } catch (err) {
      setFiles((prev) => prev.map((f) => f.id === fileObj.id ? { ...f, status: "error", error: err.message } : f));
    }
  };

  const handleConvertAll = async () => {
    setIsConverting(true);
    await Promise.all(files.filter((f) => f.status === "pending" || f.status === "error").map((f) => convertFile(f)));
    setIsConverting(false);
  };

  const handleSaveToShopify = async (fileObj) => {
    setFiles((prev) => prev.map((f) => f.id === fileObj.id ? { ...f, savingToShopify: true, shopifyError: null } : f));
    try {
      const baseName = fileObj.originalFile.name.replace(/\.[^.]+$/, "");
      const webpFilename = `${baseName}.webp`;
      const formData = new FormData();
      formData.append("file", fileObj.convertedBlob, webpFilename);
      formData.append("filename", webpFilename);
      const response = await fetch("/api/save-to-shopify", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || "Failed to save");
      setFiles((prev) => prev.map((f) => f.id === fileObj.id ? { ...f, savingToShopify: false, savedToShopify: true } : f));
    } catch (err) {
      setFiles((prev) => prev.map((f) => f.id === fileObj.id ? { ...f, savingToShopify: false, shopifyError: err.message } : f));
    }
  };

  const handleSaveAllToShopify = async () => {
    await Promise.all(files.filter((f) => f.status === "done" && !f.savedToShopify).map((f) => handleSaveToShopify(f)));
  };

  const completedFiles = files.filter((f) => f.status === "done");
  const totalOrigKB = completedFiles.reduce((a, f) => a + parseFloat(f.originalSize), 0);
  const totalConvKB = completedFiles.reduce((a, f) => a + parseFloat(f.convertedSize), 0);
  const savedPct = totalOrigKB > 0 ? Math.round((1 - totalConvKB / totalOrigKB) * 100) : 0;
  const allDone = files.length > 0 && files.every((f) => f.status === "done");
  const allSaved = completedFiles.length > 0 && completedFiles.every((f) => f.savedToShopify);

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        .wc-root { min-height: 100vh; background: #f7f6f3; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 32px 24px; color: #1a1a1a; }
        .wc-header { max-width: 900px; margin: 0 auto 24px; }
        .wc-header h1 { font-size: 28px; font-weight: 700; margin: 0 0 6px; }
        .wc-header p { margin: 0; font-size: 15px; color: #6b7280; }
        .wc-tabs { max-width: 900px; margin: 0 auto 24px; display: flex; gap: 4px; background: #ede9e2; padding: 4px; border-radius: 10px; width: fit-content; }
        .wc-tab { padding: 8px 20px; border-radius: 7px; border: none; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.15s; background: transparent; color: #6b7280; }
        .wc-tab.active { background: #fff; color: #1a1a1a; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .wc-card { max-width: 900px; margin: 0 auto 20px; background: #fff; border-radius: 16px; border: 1px solid #e5e3de; box-shadow: 0 1px 4px rgba(0,0,0,0.05); overflow: hidden; }
        .wc-dropzone { padding: 48px 32px; text-align: center; border: 2px dashed #d1cfc8; border-radius: 14px; margin: 20px; cursor: pointer; transition: all 0.2s; background: #faf9f7; }
        .wc-dropzone.dragging { border-color: #3a3a3a; background: #f0ede8; }
        .wc-dropzone:hover { border-color: #aaa; background: #f3f1ec; }
        .wc-drop-icon { font-size: 40px; margin-bottom: 12px; display: block; opacity: 0.5; }
        .wc-dropzone h2 { font-size: 17px; font-weight: 600; margin: 0 0 6px; }
        .wc-dropzone p { font-size: 13px; color: #9ca3af; margin: 0 0 20px; }
        .wc-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; transition: all 0.15s; }
        .wc-btn-primary { background: #1a1a1a; color: #fff; }
        .wc-btn-primary:hover:not(:disabled) { background: #333; }
        .wc-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
        .wc-btn-secondary { background: #f0ede8; color: #3a3a3a; border: 1px solid #ddd8d0; }
        .wc-btn-secondary:hover:not(:disabled) { background: #e8e3dc; }
        .wc-btn-shopify { background: #008060; color: #fff; }
        .wc-btn-shopify:hover:not(:disabled) { background: #006e52; }
        .wc-btn-shopify:disabled { opacity: 0.45; cursor: not-allowed; }
        .wc-btn-ghost { background: transparent; color: #6b7280; border: 1px solid #e5e3de; padding: 6px 14px; font-size: 13px; }
        .wc-btn-ghost:hover { background: #f5f3ef; color: #1a1a1a; }
        .wc-toolbar { max-width: 900px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .wc-toolbar-left { font-size: 14px; color: #6b7280; font-weight: 500; }
        .wc-toolbar-right { display: flex; gap: 10px; flex-wrap: wrap; }
        .wc-stats { max-width: 900px; margin: 0 auto 20px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
        .wc-stat-card { background: #fff; border: 1px solid #e5e3de; border-radius: 12px; padding: 16px 20px; text-align: center; }
        .wc-stat-card .val { font-size: 26px; font-weight: 700; color: #1a1a1a; line-height: 1; margin-bottom: 4px; }
        .wc-stat-card .val.green { color: #059669; }
        .wc-stat-card .lbl { font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; }
        .wc-file-list { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
        .wc-file-row { background: #fff; border: 1px solid #e5e3de; border-radius: 14px; padding: 16px 20px; display: flex; align-items: center; gap: 16px; transition: box-shadow 0.2s; flex-wrap: wrap; }
        .wc-file-row:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .wc-thumb { width: 60px; height: 60px; object-fit: cover; border-radius: 8px; border: 1px solid #e5e3de; flex-shrink: 0; }
        .wc-file-info { flex: 1; min-width: 0; }
        .wc-file-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 3px; }
        .wc-file-meta { font-size: 12px; color: #9ca3af; }
        .wc-status-badge { font-size: 12px; font-weight: 500; padding: 3px 10px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; }
        .badge-pending { background: #f3f4f6; color: #6b7280; }
        .badge-converting { background: #eff6ff; color: #3b82f6; }
        .badge-done { background: #ecfdf5; color: #059669; }
        .badge-error { background: #fef2f2; color: #dc2626; }
        .badge-saved { background: #ecfdf5; color: #059669; font-weight: 600; }
        .wc-arrow { font-size: 18px; color: #d1cfc8; flex-shrink: 0; }
        .wc-savings { font-size: 12px; font-weight: 600; color: #059669; white-space: nowrap; flex-shrink: 0; }
        .wc-spinner { width: 16px; height: 16px; border: 2px solid #bfdbfe; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block; }
        .wc-spinner-sm { width: 14px; height: 14px; border: 2px solid #a7f3d0; border-top-color: #059669; border-radius: 50%; animation: spin 0.7s linear infinite; display: inline-block; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .wc-empty { text-align: center; padding: 60px 20px; color: #c0bcb5; }
        .wc-empty-icon { font-size: 48px; display: block; margin-bottom: 12px; }
        .wc-empty p { font-size: 15px; margin: 0; }
        .wc-shopify-error { font-size: 12px; color: #dc2626; margin-top: 4px; }
        .wc-info-banner { max-width: 900px; margin: 0 auto 16px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 12px 16px; font-size: 13px; color: #166534; }
      `}</style>

      <div className="wc-root">
        <div className="wc-header">
          <h1>⚡ WebP Converter</h1>
          <p>Convert JPG & PNG images to WebP — up to 80% smaller, same visual quality.</p>
        </div>

        {/* Tabs */}
        <div className="wc-tabs">
          <button className={`wc-tab${tab === "upload" ? " active" : ""}`} onClick={() => setTab("upload")}>
            📤 Upload & Convert
          </button>
          <button className={`wc-tab${tab === "shopify" ? " active" : ""}`} onClick={() => setTab("shopify")}>
            ☁ Convert Shopify Files
          </button>
        </div>

        {/* ============ UPLOAD TAB ============ */}
        {tab === "upload" && (
          <>
            <div className="wc-card">
              <div className={`wc-dropzone${isDragging ? " dragging" : ""}`}
                onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                onClick={() => document.getElementById("wc-file-input").click()}>
                <span className="wc-drop-icon">🖼️</span>
                <h2>Drop images here</h2>
                <p>Supports JPG, JPEG & PNG — multiple files at once</p>
                <button className="wc-btn wc-btn-primary" onClick={(e) => { e.stopPropagation(); document.getElementById("wc-file-input").click(); }}>
                  Browse Files
                </button>
              </div>
            </div>

            <input id="wc-file-input" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" multiple style={{ display: "none" }} onChange={handleFileInput} />

            {files.length > 0 && (
              <div className="wc-toolbar">
                <span className="wc-toolbar-left">{files.length} image{files.length > 1 ? "s" : ""} loaded · {completedFiles.length} converted</span>
                <div className="wc-toolbar-right">
                  <button className="wc-btn wc-btn-secondary" onClick={() => setFiles([])} disabled={isConverting}>Clear All</button>
                  {allDone && !allSaved && (
                    <button className="wc-btn wc-btn-shopify" onClick={handleSaveAllToShopify}>☁ Save All to Shopify</button>
                  )}
                  <button className="wc-btn wc-btn-primary" onClick={handleConvertAll} disabled={isConverting || allDone}>
                    {isConverting ? <><span className="wc-spinner" /> Converting…</> : "Convert to WebP"}
                  </button>
                </div>
              </div>
            )}

            {completedFiles.length > 0 && (
              <div className="wc-stats">
                <div className="wc-stat-card"><div className="val">{completedFiles.length}</div><div className="lbl">Converted</div></div>
                <div className="wc-stat-card"><div className="val">{totalOrigKB.toFixed(0)} KB</div><div className="lbl">Original size</div></div>
                <div className="wc-stat-card"><div className="val green">{savedPct}% saved</div><div className="lbl">{totalConvKB.toFixed(0)} KB after</div></div>
              </div>
            )}

            {files.length === 0 ? (
              <div className="wc-empty"><span className="wc-empty-icon">📂</span><p>No images uploaded yet. Drop some files above.</p></div>
            ) : (
              <div className="wc-file-list">
                {files.map((file) => (
                  <div className="wc-file-row" key={file.id}>
                    <img className="wc-thumb" src={file.originalURL} alt="preview" />
                    <div className="wc-file-info">
                      <div className="wc-file-name">{file.originalFile.name}</div>
                      <div className="wc-file-meta">{file.originalSize} KB · {file.originalFile.type}</div>
                      {file.shopifyError && <div className="wc-shopify-error">⚠ {file.shopifyError}</div>}
                    </div>
                    {file.status === "pending" && <span className="wc-status-badge badge-pending">Pending</span>}
                    {file.status === "converting" && <span className="wc-status-badge badge-converting"><span className="wc-spinner" /> Converting</span>}
                    {file.status === "error" && <span className="wc-status-badge badge-error">Failed</span>}
                    {file.status === "done" && (
                      <>
                        <span className="wc-arrow">→</span>
                        <span className="wc-savings">{file.convertedSize} KB<br />({Math.round((1 - file.convertedSize / file.originalSize) * 100)}% smaller)</span>
                        <span className="wc-status-badge badge-done">✓ WebP</span>
                        {file.savedToShopify ? (
                          <span className="wc-status-badge badge-saved">☁ Saved</span>
                        ) : file.savingToShopify ? (
                          <span className="wc-status-badge badge-converting"><span className="wc-spinner-sm" /> Saving…</span>
                        ) : (
                          <button className="wc-btn wc-btn-shopify" onClick={() => handleSaveToShopify(file)}>☁ Save to Shopify</button>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ============ SHOPIFY FILES TAB ============ */}
        {tab === "shopify" && (
          <>
            <div className="wc-info-banner">
              ℹ️ These are JPG/PNG images already in your Shopify Files. Converting will replace each original with a WebP version.
            </div>

            <div className="wc-toolbar">
              <span className="wc-toolbar-left">
                {loadingShopifyFiles ? "Loading files…" : `${shopifyFiles.length} JPG/PNG file${shopifyFiles.length !== 1 ? "s" : ""} found`}
              </span>
              <div className="wc-toolbar-right">
                <button className="wc-btn wc-btn-secondary" onClick={loadShopifyFiles} disabled={loadingShopifyFiles}>↻ Refresh</button>
                {shopifyFiles.length > 0 && (
                  <button className="wc-btn wc-btn-shopify" onClick={handleConvertAllShopifyFiles} disabled={loadingShopifyFiles}>
                    ⚡ Convert All to WebP
                  </button>
                )}
              </div>
            </div>

            {loadingShopifyFiles ? (
              <div className="wc-empty"><span className="wc-spinner" style={{ width: 32, height: 32, borderWidth: 3 }} /></div>
            ) : shopifyFiles.length === 0 ? (
              <div className="wc-empty">
                <span className="wc-empty-icon">✅</span>
                <p>No JPG/PNG files found. All images are already WebP!</p>
              </div>
            ) : (
              <div className="wc-file-list">
                {shopifyFiles.map((file) => {
                  const status = convertingIds[file.id];
                  const urlParts = file.url?.split("/") || [];
                  const rawName = urlParts[urlParts.length - 1]?.split("?")[0] || "image";
                  const sizeKB = file.fileSize ? (file.fileSize / 1024).toFixed(1) : "?";

                  return (
                    <div className="wc-file-row" key={file.id}>
                      <img className="wc-thumb" src={file.url} alt="preview" crossOrigin="anonymous" />
                      <div className="wc-file-info">
                        <div className="wc-file-name">{rawName}</div>
                        <div className="wc-file-meta">{sizeKB} KB · {file.mimeType} · {file.width}×{file.height}</div>
                      </div>

                      {!status && (
                        <button className="wc-btn wc-btn-shopify" onClick={() => handleConvertShopifyFile(file)}>
                          ⚡ Convert & Replace
                        </button>
                      )}
                      {status === "converting" && (
                        <span className="wc-status-badge badge-converting"><span className="wc-spinner" /> Converting…</span>
                      )}
                      {status === "done" && (
                        <span className="wc-status-badge badge-saved">✓ Replaced with WebP</span>
                      )}
                      {status?.startsWith("error:") && (
                        <span className="wc-status-badge badge-error" title={status.replace("error:", "")}>Failed</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}