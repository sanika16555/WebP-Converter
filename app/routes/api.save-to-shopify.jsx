import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { admin } = await authenticate.admin(request);

    const formData = await request.formData();
    const file = formData.get("file");
    const filename = formData.get("filename");

    if (!file || typeof file === "string") {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Step 1: Create a staged upload target
    const stagedResponse = await admin.graphql(`
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
      }
    `, {
      variables: {
        input: [{
          filename: filename || "converted.webp",
          mimeType: "image/webp",
          httpMethod: "POST",
          resource: "FILE",
        }]
      }
    });

    const stagedData = await stagedResponse.json();
    const stagedTarget = stagedData.data?.stagedUploadsCreate?.stagedTargets?.[0];

    if (!stagedTarget) {
      const errors = stagedData.data?.stagedUploadsCreate?.userErrors;
      return new Response(JSON.stringify({ error: "Failed to create upload target", details: errors }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Step 2: Upload the file to the staged target
    const uploadFormData = new FormData();
    stagedTarget.parameters.forEach(({ name, value }) => {
      uploadFormData.append(name, value);
    });
    uploadFormData.append("file", file);

    const uploadResponse = await fetch(stagedTarget.url, {
      method: "POST",
      body: uploadFormData,
    });

    if (!uploadResponse.ok) {
      return new Response(JSON.stringify({ error: "Failed to upload to staged target" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Step 3: Create the file in Shopify Files using the resourceUrl
    const fileCreateResponse = await admin.graphql(`
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
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
      }
    `, {
      variables: {
        files: [{
          originalSource: stagedTarget.resourceUrl,
          contentType: "IMAGE",
          filename: filename || "converted.webp",
        }]
      }
    });

    const fileData = await fileCreateResponse.json();
    const createdFile = fileData.data?.fileCreate?.files?.[0];
    const userErrors = fileData.data?.fileCreate?.userErrors;

    if (userErrors?.length > 0) {
      return new Response(JSON.stringify({ error: userErrors[0].message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      fileId: createdFile?.id,
      filesUrl: "https://admin.shopify.com/store/" + request.headers.get("X-Shopify-Shop-Domain")?.replace(".myshopify.com", "") + "/content/files",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Save to Shopify error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};