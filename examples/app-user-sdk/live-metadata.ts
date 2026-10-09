import { createSpaceCasClient } from "@unicas/space-client";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const cas = createSpaceCasClient({
  baseUrl: required("UNICAS_BASE_URL"),
  appId: required("UNICAS_APP_ID"),
  spaceId: required("UNICAS_SPACE_ID"),
  getToken: async () => required("UNICAS_CAPABILITY"),
});

const metadata = await cas.readMetadata(required("UNICAS_NODE_HASH"));
console.log(JSON.stringify(metadata, null, 2));
