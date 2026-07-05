import { useState, useCallback } from "react";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { ok: true };
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export default function Index() {
  const [files, setFiles] = useState([]);
  const [isConverting, setIsConverting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const processFiles = useCallback((newRawFiles) => {
    const newFiles = Array.from(newRawFiles)
      .filter((f) => /\.(jpe?g|png)$/i.test(f.name))
      .map((file) => ({
        id: Math.random().toString(36).substring(7),
        originalFile: file,
        originalURL: URL.createObjectURL(file),
        originalSize: (file.size / 1024).toFixed(1),
        // Conversion result fields
        convertedSize: null,
        status: "pending",
        error: null,
        // Shopify save result fields (replaces local download)
        shopifyFileUrl: null,
        updatedProducts: [],
      }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleFileInput = (e) => {
    if (e.target.files?.length) processFiles(e.target.files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files);
  };

  const convertFile = async (fileObj) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === fileObj.id ? { ...f, status: "converting", error: null } : f
      )
    );

    try {
      const formData = new FormData();
      formData.append("file", fileObj.originalFile);

      const response = await fetch("/api/convert", {
        method: "POST",
        body: formData,
      });

      // API now returns JSON (not a blob)
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? `Server error: ${response.status}`);
      }

      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileObj.id
            ? {
                ...f,
                status: "done",
                convertedSize: result.convertedSizeKB,
                shopifyFileUrl: result.shopifyFileUrl,
                updatedProducts: result.updatedProducts ?? [],
              }
            : f
        )
      );
    } catch (err) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileObj.id
            ? { ...f, status: "error", error: err.message }
            : f
        )
      );
    }
  };

  const handleConvertAll = async () => {
    setIsConverting(true);
    const pending = files.filter(
      (f) => f.status === "pending" || f.status === "error"
    );
    await Promise.all(pending.map((f) => convertFile(f)));
    setIsConverting(false);
  };

  const handleClear = () => setFiles([]);

  const completedFiles = files.filter((f) => f.status === "done");
  const totalOrigKB = completedFiles.reduce(
    (a, f) => a + parseFloat(f.originalSize),
    0
  );
  const totalConvKB = completedFiles.reduce(
    (a, f) => a + parseFloat(f.convertedSize ?? 0),
    0
  );
  const savedPct =
    totalOrigKB > 0
      ? Math.round((1 - totalConvKB / totalOrigKB) * 100)
      : 0;
  const allDone =
    files.length > 0 && files.every((f) => f.status === "done");

  return (
    <>
      <style>{`
        .wc-root {
          min-height: 100vh;
          background: #f7f6f3;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          padding: 32px 24px;
          box-sizing: border-box;
          color: #1a1a1a;
        }
        .wc-header {
          max-width: 860px;
          margin: 0 auto 36px;
        }
        .wc-header h1 {
          font-size: 28px;
          font-weight: 700;
          margin: 0 0 6px;
          letter-spacing: -0.5px;
        }
        .wc-header p {
          margin: 0;
          font-size: 15px;
          color: #6b7280;
        }
        .wc-card {
          max-width: 860px;
          margin: 0 auto 20px;
          background: #fff;
          border-radius: 16px;
          border: 1px solid #e5e3de;
          box-shadow: 0 1px 4px rgba(0,0,0,0.05);
          overflow: hidden;
        }
        .wc-dropzone {
          padding: 48px 32px;
          text-align: center;
          border: 2px dashed #d1cfc8;
          border-radius: 14px;
          margin: 20px;
          cursor: pointer;
          transition: all 0.2s;
          background: #faf9f7;
        }
        .wc-dropzone.dragging {
          border-color: #3a3a3a;
          background: #f0ede8;
        }
        .wc-dropzone:hover {
          border-color: #aaa9a3;
          background: #f3f1ec;
        }
        .wc-drop-icon {
          font-size: 40px;
          margin-bottom: 12px;
          display: block;
          opacity: 0.5;
        }
        .wc-dropzone h2 {
          font-size: 17px;
          font-weight: 600;
          margin: 0 0 6px;
          color: #2d2d2d;
        }
        .wc-dropzone p {
          font-size: 13px;
          color: #9ca3af;
          margin: 0 0 20px;
        }
        .wc-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          transition: all 0.15s;
        }
        .wc-btn-primary {
          background: #1a1a1a;
          color: #fff;
        }
        .wc-btn-primary:hover:not(:disabled) { background: #333; }
        .wc-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
        .wc-btn-secondary {
          background: #f0ede8;
          color: #3a3a3a;
          border: 1px solid #ddd8d0;
        }
        .wc-btn-secondary:hover:not(:disabled) { background: #e8e3dc; }
        .wc-btn-ghost {
          background: transparent;
          color: #6b7280;
          border: 1px solid #e5e3de;
          padding: 6px 14px;
          font-size: 13px;
        }
        .wc-btn-ghost:hover { background: #f5f3ef; color: #1a1a1a; }
        .wc-toolbar {
          max-width: 860px;
          margin: 0 auto 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .wc-toolbar-left {
          font-size: 14px;
          color: #6b7280;
          font-weight: 500;
        }
        .wc-toolbar-right { display: flex; gap: 10px; }
        .wc-stats {
          max-width: 860px;
          margin: 0 auto 20px;
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 12px;
        }
        .wc-stat-card {
          background: #fff;
          border: 1px solid #e5e3de;
          border-radius: 12px;
          padding: 16px 20px;
          text-align: center;
        }
        .wc-stat-card .val {
          font-size: 26px;
          font-weight: 700;
          color: #1a1a1a;
          line-height: 1;
          margin-bottom: 4px;
        }
        .wc-stat-card .val.green { color: #059669; }
        .wc-stat-card .lbl {
          font-size: 12px;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .wc-file-list {
          max-width: 860px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .wc-file-row {
          background: #fff;
          border: 1px solid #e5e3de;
          border-radius: 14px;
          padding: 16px 20px;
          display: flex;
          align-items: flex-start;
          gap: 16px;
          transition: box-shadow 0.2s;
        }
        .wc-file-row:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .wc-thumb {
          width: 60px;
          height: 60px;
          object-fit: cover;
          border-radius: 8px;
          border: 1px solid #e5e3de;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .wc-file-info {
          flex: 1;
          min-width: 0;
        }
        .wc-file-name {
          font-size: 14px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 3px;
        }
        .wc-file-meta {
          font-size: 12px;
          color: #9ca3af;
        }
        .wc-status-badge {
          font-size: 12px;
          font-weight: 500;
          padding: 3px 10px;
          border-radius: 20px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .badge-pending { background: #f3f4f6; color: #6b7280; }
        .badge-converting { background: #eff6ff; color: #3b82f6; }
        .badge-done { background: #ecfdf5; color: #059669; }
        .badge-error { background: #fef2f2; color: #dc2626; }
        .wc-arrow {
          font-size: 18px;
          color: #d1cfc8;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .wc-savings {
          font-size: 12px;
          font-weight: 600;
          color: #059669;
          white-space: nowrap;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .wc-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid #bfdbfe;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          display: inline-block;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .wc-empty {
          text-align: center;
          padding: 60px 20px;
          color: #c0bcb5;
        }
        .wc-empty-icon { font-size: 48px; display: block; margin-bottom: 12px; }
        .wc-empty p { font-size: 15px; margin: 0; }

        /* ── New: Shopify save confirmation block ── */
        .wc-saved-block {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
          flex-shrink: 0;
          max-width: 260px;
        }
        .wc-saved-tag {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: #ecfdf5;
          color: #059669;
          font-size: 12px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 20px;
          border: 1px solid #a7f3d0;
          white-space: nowrap;
          text-decoration: none;
        }
        .wc-saved-tag:hover {
          background: #d1fae5;
        }
        .wc-products-updated {
          font-size: 11px;
          color: #6b7280;
          line-height: 1.5;
        }
        .wc-products-updated strong {
          color: #374151;
          font-weight: 600;
          display: block;
          margin-bottom: 2px;
        }
        .wc-product-pill {
          display: inline-block;
          background: #f3f4f6;
          color: #374151;
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 10px;
          margin: 2px 2px 0 0;
          border: 1px solid #e5e7eb;
        }
        .wc-no-match {
          font-size: 11px;
          color: #9ca3af;
          margin-top: 1px;
        }
      `}</style>

      <div className="wc-root">
        <div className="wc-header">
          <h1>⚡ WebP Converter</h1>
          <p>
            Bulk convert JPG &amp; PNG product images to high-quality WebP —
            saves directly to your Shopify Files library and auto-updates matching product images.
          </p>
        </div>

        {/* Drop Zone */}
        <div className="wc-card">
          <div
            className={`wc-dropzone${isDragging ? " dragging" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() =>
              document.getElementById("wc-file-input").click()
            }
          >
            <span className="wc-drop-icon">🖼️</span>
            <h2>Drop images here</h2>
            <p>Supports JPG, JPEG &amp; PNG — multiple files at once</p>
            <button
              className="wc-btn wc-btn-primary"
              onClick={(e) => {
                e.stopPropagation();
                document.getElementById("wc-file-input").click();
              }}
            >
              Browse Files
            </button>
          </div>
        </div>

        <input
          id="wc-file-input"
          type="file"
          accept=".jpg,.jpeg,.png,image/jpeg,image/png"
          multiple
          style={{ display: "none" }}
          onChange={handleFileInput}
        />

        {/* Toolbar */}
        {files.length > 0 && (
          <div className="wc-toolbar">
            <span className="wc-toolbar-left">
              {files.length} image{files.length > 1 ? "s" : ""} loaded
              &nbsp;·&nbsp; {completedFiles.length} converted
            </span>
            <div className="wc-toolbar-right">
              <button
                className="wc-btn wc-btn-secondary"
                onClick={handleClear}
                disabled={isConverting}
              >
                Clear All
              </button>
              <button
                className="wc-btn wc-btn-primary"
                onClick={handleConvertAll}
                disabled={isConverting || allDone}
              >
                {isConverting ? (
                  <>
                    <span className="wc-spinner" /> Converting &amp; Saving…
                  </>
                ) : (
                  "Convert & Save to Shopify"
                )}
              </button>
            </div>
          </div>
        )}

        {/* Stats */}
        {completedFiles.length > 0 && (
          <div className="wc-stats">
            <div className="wc-stat-card">
              <div className="val">{completedFiles.length}</div>
              <div className="lbl">Saved to Shopify</div>
            </div>
            <div className="wc-stat-card">
              <div className="val">{totalOrigKB.toFixed(0)} KB</div>
              <div className="lbl">Original size</div>
            </div>
            <div className="wc-stat-card">
              <div className="val green">{savedPct}% saved</div>
              <div className="lbl">{totalConvKB.toFixed(0)} KB after</div>
            </div>
          </div>
        )}

        {/* File List */}
        {files.length === 0 ? (
          <div className="wc-empty">
            <span className="wc-empty-icon">📂</span>
            <p>
              No images uploaded yet. Drop some files above to get started.
            </p>
          </div>
        ) : (
          <div className="wc-file-list">
            {files.map((file) => (
              <div className="wc-file-row" key={file.id}>
                <img
                  className="wc-thumb"
                  src={file.originalURL}
                  alt="preview"
                />

                <div className="wc-file-info">
                  <div className="wc-file-name">
                    {file.originalFile.name}
                  </div>
                  <div className="wc-file-meta">
                    {file.originalSize} KB &nbsp;·&nbsp;{" "}
                    {file.originalFile.type}
                  </div>
                </div>

                {file.status === "pending" && (
                  <span className="wc-status-badge badge-pending">
                    Pending
                  </span>
                )}

                {file.status === "converting" && (
                  <span className="wc-status-badge badge-converting">
                    <span className="wc-spinner" /> &nbsp;Saving…
                  </span>
                )}

                {file.status === "error" && (
                  <span
                    className="wc-status-badge badge-error"
                    title={file.error}
                  >
                    Failed
                  </span>
                )}

                {file.status === "done" && (
                  <>
                    <span className="wc-arrow">→</span>
                    <span className="wc-savings">
                      {file.convertedSize} KB
                      <br />
                      (
                      {Math.round(
                        (1 - file.convertedSize / file.originalSize) * 100
                      )}
                      % smaller)
                    </span>

                    {/* ── Shopify save confirmation (replaces Download button) ── */}
                    <div className="wc-saved-block">
                      {/* Link opens Shopify Files section in a new tab */}
                      <a
                        className="wc-saved-tag"
                        href={file.shopifyFileUrl ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View file in Shopify Files"
                      >
                        ✓ Saved to Shopify Files
                      </a>

                      {/* Product replacement summary */}
                      {file.updatedProducts.length > 0 ? (
                        <div className="wc-products-updated">
                          <strong>
                            🔄 Updated {file.updatedProducts.length} product
                            {file.updatedProducts.length > 1 ? "s" : ""}
                          </strong>
                          {file.updatedProducts.map((p) => (
                            <span key={p.id} className="wc-product-pill">
                              {p.title}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="wc-no-match">
                          No matching product images found
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
