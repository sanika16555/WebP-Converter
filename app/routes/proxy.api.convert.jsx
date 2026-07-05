/**
 * App Proxy route — accessible via:
 * https://your-store.myshopify.com/apps/webp-converter/api/convert
 *
 * Shopify validates the proxy signature automatically.
 * This allows the Liquid theme extension to call the convert API
 * without CORS issues since it runs under the store's own domain.
 */
import sharp from "sharp";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Validate the request is from Shopify's App Proxy
  try {
    await authenticate.public.appProxy(request);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return new Response(
        JSON.stringify({ error: "No file uploaded or invalid format" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const convertedBuffer = await sharp(buffer)
      .webp({ quality: 80 })
      .toBuffer();

    return new Response(convertedBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Content-Disposition": 'attachment; filename="converted.webp"',
        // Allow the storefront origin
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Proxy conversion error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to convert image." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
