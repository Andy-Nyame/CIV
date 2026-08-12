import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { readR2Config } from "./config";

const globalForStorage = globalThis as unknown as {
  civR2Client?: S3Client;
};

function getStorageClient() {
  if (globalForStorage.civR2Client) return globalForStorage.civR2Client;

  const config = readR2Config();
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  if (process.env.NODE_ENV !== "production") {
    globalForStorage.civR2Client = client;
  }

  return client;
}

function assertManagedKey(key: string) {
  if (
    key.length < 1 ||
    key.length > 1024 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Invalid private object key.");
  }
}

export async function uploadObject(input: {
  key: string;
  body: Uint8Array;
  contentType: string;
  checksumSha256?: string;
}) {
  assertManagedKey(input.key);
  const config = readR2Config();
  await getStorageClient().send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: input.key,
      Body: input.body,
      ContentLength: input.body.byteLength,
      ContentType: input.contentType,
      CacheControl: "private, no-store",
      Metadata: input.checksumSha256
        ? { "civ-sha256": input.checksumSha256 }
        : undefined,
    }),
  );
}

export async function getObject(key: string) {
  assertManagedKey(key);
  const config = readR2Config();
  const result = await getStorageClient().send(
    new GetObjectCommand({ Bucket: config.bucketName, Key: key }),
  );

  if (!result.Body) throw new Error("Private object body is unavailable.");

  return {
    body: await result.Body.transformToByteArray(),
    contentType: result.ContentType,
  };
}

export async function deleteObject(key: string) {
  assertManagedKey(key);
  const config = readR2Config();
  await getStorageClient().send(
    new DeleteObjectCommand({ Bucket: config.bucketName, Key: key }),
  );
}

export async function objectExists(key: string) {
  assertManagedKey(key);
  const config = readR2Config();
  try {
    await getStorageClient().send(
      new HeadObjectCommand({ Bucket: config.bucketName, Key: key }),
    );
    return true;
  } catch (error) {
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    if (statusCode === 404) return false;
    throw error;
  }
}
