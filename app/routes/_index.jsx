export default function Home() {
  return (
    <div
      style={{
        fontFamily: "Arial, sans-serif",
        minHeight: "100vh",
        background: "#f8fafc",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px",
      }}
    >
      <div
        style={{
          maxWidth: "800px",
          textAlign: "center",
          background: "white",
          padding: "50px",
          borderRadius: "20px",
          boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
        }}
      >
        <h1 style={{ fontSize: "48px" }}>
          ⚡ Shopify WebP Converter
        </h1>

        <p
          style={{
            fontSize: "20px",
            color: "#555",
            marginTop: "20px",
          }}
        >
          Convert JPG & PNG images into WebP with one click.
        </p>

        <p style={{ marginTop: "25px" }}>
          ✔ Upload images
          <br />
          ✔ Convert to WebP
          <br />
          ✔ Save directly to Shopify Files
          <br />
          ✔ Bulk conversion
          <br />
          ✔ Replace Shopify product images
        </p>

        <a
          href="/app"
          style={{
            display: "inline-block",
            marginTop: "40px",
            padding: "16px 36px",
            background: "#008060",
            color: "white",
            textDecoration: "none",
            borderRadius: "10px",
            fontSize: "18px",
            fontWeight: "bold",
          }}
        >
          Open Shopify App
        </a>

        <p
          style={{
            marginTop: "40px",
            color: "#777",
          }}
        >
          Built with React Router • Shopify App Bridge • Prisma • Sharp • Render
        </p>
      </div>
    </div>
  );
}