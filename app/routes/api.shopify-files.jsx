import { authenticate } from "../shopify.server";

// GET - fetch all JPG/PNG files from Shopify Files
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query getFiles($cursor: String) {
      files(first: 50, after: $cursor, query: "media_type:Image") {
        edges {
          cursor
          node {
            id
            fileStatus
            createdAt
            ... on MediaImage {
              id
              image {
                url
                width
                height
              }
              mimeType
              originalSource {
                url
                fileSize
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `);

  const data = await response.json();
  const edges = data.data?.files?.edges || [];

  // Filter only JPG/PNG files (not already WebP)
  const imageFiles = edges
    .filter(({ node }) => {
      const mime = node.mimeType || "";
      return mime === "image/jpeg" || mime === "image/png" || mime === "image/jpg";
    })
    .map(({ node }) => ({
      id: node.id,
      url: node.image?.url,
      mimeType: node.mimeType,
      fileSize: node.originalSource?.fileSize,
      width: node.image?.width,
      height: node.image?.height,
    }));

  return new Response(JSON.stringify({ files: imageFiles }), {
    headers: { "Content-Type": "application/json" },
  });
};

// POST - delete old file after replacement
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const { fileId } = await request.json();

  const response = await admin.graphql(`
    mutation fileDelete($fileIds: [ID!]!) {
      fileDelete(fileIds: $fileIds) {
        deletedFileIds
        userErrors {
          field
          message
        }
      }
    }
  `, {
    variables: { fileIds: [fileId] }
  });

  const data = await response.json();
  return new Response(JSON.stringify(data.data), {
    headers: { "Content-Type": "application/json" },
  });
};