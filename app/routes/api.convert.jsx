import sharp from "sharp";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // 1. Parse the incoming multipart form data using the standard Web API
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return new Response("No file uploaded or invalid format", { status: 400 });
    }

    // 2. Read the file into an ArrayBuffer and then a Node.js Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Process the image using Sharp
    // The requirement states quality should not reduce more than 20% (so quality = 80)
    const convertedBuffer = await sharp(buffer)
      .webp({ quality: 80 })
      .toBuffer();

    // 4. Return the converted WebP image
    return new Response(convertedBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Content-Disposition": 'attachment; filename="converted.webp"',
      },
    });
  } catch (error) {
    console.error("Conversion error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to convert image." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
