import sharp from "sharp";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const { imageUrl, filename, fileId } = await request.json();

  try {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) throw new Error("Failed to download image");
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    const webpBuffer = await sharp(imageBuffer).webp({ quality: 80 }).toBuffer();
    const webpBlob = new Blob([webpBuffer], { type: "image/webp" });

    const stagedResponse = await admin.graphql(`
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters { name value }
          }
          userErrors { field message }
        }
      }
    `, {
      variables: {
        input: [{
          filename: filename,
          mimeType: "image/webp",
          httpMethod: "POST",
          resource: "FILE",
        }]
      }
    });

    const stagedData = await stagedResponse.json();
    const stagedTarget = stagedData.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!stagedTarget) throw new Error("Failed to create staged upload");

    const uploadFormData = new FormData();
    stagedTarget.parameters.forEach(({ name, value }) => uploadFormData.append(name, value));
    uploadFormData.append("file", webpBlob, filename);

    const uploadResponse = await fetch(stagedTarget.url, { method: "POST", body: uploadFormData });
    if (!uploadResponse.ok) throw new Error("Failed to upload to staged target");

    const fileCreateResponse = await admin.graphql(`
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
            ... on MediaImage {
              image { url }
            }
          }
          userErrors { field message }
        }
      }
    `, {
      variables: {
        files: [{
          originalSource: stagedTarget.resourceUrl,
          contentType: "IMAGE",
          filename: filename,
        }]
      }
    });

    const fileData = await fileCreateResponse.json();
    const userErrors = fileData.data?.fileCreate?.userErrors;
    if (userErrors?.length > 0) throw new Error(userErrors[0].message);

    await admin.graphql(`
      mutation fileDelete($fileIds: [ID!]!) {
        fileDelete(fileIds: $fileIds) {
          deletedFileIds
          userErrors { field message }
        }
      }
    `, { variables: { fileIds: [fileId] } });

    return new Response(JSON.stringify({
      success: true,
      originalSizeKB: (imageBuffer.length / 1024).toFixed(1),
      convertedSizeKB: (webpBuffer.length / 1024).toFixed(1),
      savedPct: Math.round((1 - webpBuffer.length / imageBuffer.length) * 100),
    }), { headers: { "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};