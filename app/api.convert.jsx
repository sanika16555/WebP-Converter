import sharp from "sharp";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // ── 1. Auth ──────────────────────────────────────────────────────────────
    const { admin } = await authenticate.admin(request);

    // ── 2. Parse upload ──────────────────────────────────────────────────────
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return new Response(
        JSON.stringify({ error: "No file uploaded or invalid format" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const originalName = file.name; // e.g. "shoe-red.jpg"
    const baseName = originalName.replace(/\.[^.]+$/, ""); // e.g. "shoe-red"
    const webpName = `${baseName}.webp`;

    // ── 3. Sharp conversion (unchanged) ─────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const convertedBuffer = await sharp(buffer)
      .webp({ quality: 80 })
      .toBuffer();

    const convertedSizeKB = (convertedBuffer.byteLength / 1024).toFixed(1);
    const originalSizeKB = (buffer.byteLength / 1024).toFixed(1);

    // ── 4. Stage the upload with Shopify ─────────────────────────────────────
    // Shopify requires a pre-signed URL before you can upload a file to their CDN.
    const stagedResponse = await admin.graphql(
      `#graphql
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          input: [
            {
              filename: webpName,
              mimeType: "image/webp",
              resource: "FILE",
              fileSize: String(convertedBuffer.byteLength),
              httpMethod: "POST",
            },
          ],
        },
      }
    );

    const stagedJson = await stagedResponse.json();
    const stagedData = stagedJson.data?.stagedUploadsCreate;

    if (stagedData?.userErrors?.length > 0) {
      throw new Error(
        `Staged upload error: ${stagedData.userErrors.map((e) => e.message).join(", ")}`
      );
    }

    const target = stagedData?.stagedTargets?.[0];
    if (!target) {
      throw new Error("No staged upload target returned from Shopify.");
    }

    // ── 5. POST the buffer to Shopify's S3 pre-signed URL ────────────────────
    // Shopify returns multipart/form-data parameters that must be sent exactly.
    const uploadForm = new FormData();
    for (const param of target.parameters) {
      uploadForm.append(param.name, param.value);
    }
    // The file field must come last per S3 multipart requirements.
    uploadForm.append(
      "file",
      new Blob([convertedBuffer], { type: "image/webp" }),
      webpName
    );

    const uploadResponse = await fetch(target.url, {
      method: "POST",
      body: uploadForm,
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      throw new Error(`S3 upload failed (${uploadResponse.status}): ${errText}`);
    }

    // ── 6. Register the file in Shopify Files (fileCreate) ───────────────────
    const fileCreateResponse = await admin.graphql(
      `#graphql
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            alt
            createdAt
            ... on MediaImage {
              image {
                url
              }
            }
            ... on GenericFile {
              url
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          files: [
            {
              alt: webpName,
              contentType: "IMAGE",
              originalSource: target.resourceUrl,
            },
          ],
        },
      }
    );

    const fileCreateJson = await fileCreateResponse.json();
    const fileCreateData = fileCreateJson.data?.fileCreate;

    if (fileCreateData?.userErrors?.length > 0) {
      throw new Error(
        `fileCreate error: ${fileCreateData.userErrors.map((e) => e.message).join(", ")}`
      );
    }

    // The CDN URL may not be immediately available (Shopify processes async),
    // so we return the resourceUrl as the canonical reference for now.
    const savedFile = fileCreateData?.files?.[0];
    const shopifyFileUrl =
      savedFile?.image?.url || savedFile?.url || target.resourceUrl;

    // ── 7. Find products with matching filename in their media ───────────────
    // We search for products that have an image whose src contains the base name.
    // Shopify doesn't support filtering media by filename directly, so we do a
    // broader products query and filter client-side on the baseName.
    const productsResponse = await admin.graphql(
      `#graphql
      query findProductsWithImage($query: String!) {
        products(first: 50, query: $query) {
          edges {
            node {
              id
              title
              media(first: 20) {
                edges {
                  node {
                    id
                    mediaContentType
                    ... on MediaImage {
                      id
                      image {
                        url
                        originalSrc: url
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      {
        variables: {
          // Broad search — we refine by filename below
          query: "media_type:image",
        },
      }
    );

    const productsJson = await productsResponse.json();
    const allProducts = productsJson.data?.products?.edges ?? [];

    // Filter: find products that have a media image whose URL contains the base filename
    const matchingProducts = [];

    for (const { node: product } of allProducts) {
      const mediaEdges = product.media?.edges ?? [];
      for (const { node: media } of mediaEdges) {
        if (media.mediaContentType !== "IMAGE") continue;
        const imageUrl = media.image?.url ?? "";

        // Match on baseName (case-insensitive) in the image CDN URL
        // e.g. CDN URL contains "shoe-red" from the original upload filename
        if (imageUrl.toLowerCase().includes(baseName.toLowerCase())) {
          matchingProducts.push({
            productId: product.id,
            productTitle: product.title,
            oldMediaId: media.id,
            oldImageUrl: imageUrl,
          });
        }
      }
    }

    // ── 8. Replace matching product images with the new WebP ─────────────────
    const updatedProducts = [];

    for (const match of matchingProducts) {
      try {
        // Step 8a: Stage a new upload for the product media
        const productStagedResponse = await admin.graphql(
          `#graphql
          mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
            stagedUploadsCreate(input: $input) {
              stagedTargets {
                url
                resourceUrl
                parameters {
                  name
                  value
                }
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              input: [
                {
                  filename: webpName,
                  mimeType: "image/webp",
                  resource: "IMAGE",
                  fileSize: String(convertedBuffer.byteLength),
                  httpMethod: "POST",
                },
              ],
            },
          }
        );

        const productStagedJson = await productStagedResponse.json();
        const productTarget =
          productStagedJson.data?.stagedUploadsCreate?.stagedTargets?.[0];

        if (!productTarget) continue;

        // Step 8b: Upload the buffer again for the product media stage
        const productUploadForm = new FormData();
        for (const param of productTarget.parameters) {
          productUploadForm.append(param.name, param.value);
        }
        productUploadForm.append(
          "file",
          new Blob([convertedBuffer], { type: "image/webp" }),
          webpName
        );

        const productUploadRes = await fetch(productTarget.url, {
          method: "POST",
          body: productUploadForm,
        });

        if (!productUploadRes.ok) continue;

        // Step 8c: Delete the old media and create new media on the product
        // Shopify does not support in-place image replacement via GraphQL;
        // the correct pattern is: productDeleteMedia then productCreateMedia.
        const deleteResponse = await admin.graphql(
          `#graphql
          mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
            productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
              deletedMediaIds
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              productId: match.productId,
              mediaIds: [match.oldMediaId],
            },
          }
        );

        const deleteJson = await deleteResponse.json();
        const deleteErrors =
          deleteJson.data?.productDeleteMedia?.userErrors ?? [];

        if (deleteErrors.length > 0) {
          console.warn(
            `Could not delete old media for ${match.productTitle}:`,
            deleteErrors
          );
          continue;
        }

        // Step 8d: Create the new WebP media on the product
        const createMediaResponse = await admin.graphql(
          `#graphql
          mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
            productCreateMedia(productId: $productId, media: $media) {
              media {
                id
                mediaContentType
                status
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              productId: match.productId,
              media: [
                {
                  originalSource: productTarget.resourceUrl,
                  mediaContentType: "IMAGE",
                  alt: webpName,
                },
              ],
            },
          }
        );

        const createMediaJson = await createMediaResponse.json();
        const createMediaErrors =
          createMediaJson.data?.productCreateMedia?.userErrors ?? [];

        if (createMediaErrors.length === 0) {
          updatedProducts.push({
            id: match.productId,
            title: match.productTitle,
          });
        } else {
          console.warn(
            `productCreateMedia errors for ${match.productTitle}:`,
            createMediaErrors
          );
        }
      } catch (productErr) {
        // Non-fatal: log and continue with other products
        console.error(
          `Failed to update product ${match.productTitle}:`,
          productErr
        );
      }
    }

    // ── 9. Return JSON result to the frontend ────────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        webpName,
        shopifyFileUrl,
        convertedSizeKB,
        originalSizeKB,
        updatedProducts, // array of { id, title }
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Conversion/upload error:", error);
    return new Response(
      JSON.stringify({ error: error.message ?? "Failed to convert image." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
