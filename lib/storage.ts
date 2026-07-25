import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

const endpoint = process.env.S3_ENDPOINT || undefined;
// Presigned URLs embed the endpoint host. Inside docker-compose the app talks
// to MinIO at http://minio:9000, which the host browser cannot reach — so
// presigning uses S3_PUBLIC_ENDPOINT (e.g. http://localhost:9000) when set.
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || endpoint;

// A single shared client. `forcePathStyle` is required for MinIO and any
// S3-compatible store addressed by a custom endpoint.
const globalForS3 = globalThis as unknown as {
  _s3?: S3Client;
  _s3Presign?: S3Client;
};

function makeClient(ep: string | undefined): S3Client {
  return new S3Client({
    endpoint: ep,
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: Boolean(ep),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    },
  });
}

export const s3: S3Client = globalForS3._s3 ?? makeClient(endpoint);
const s3Presign: S3Client =
  globalForS3._s3Presign ??
  (publicEndpoint === endpoint ? s3 : makeClient(publicEndpoint));

if (process.env.NODE_ENV !== "production") {
  globalForS3._s3 = s3;
  globalForS3._s3Presign = s3Presign;
}

export const BUCKET = process.env.S3_BUCKET || "shipsite";

/** Create the bucket if it does not exist (mainly for local MinIO). */
export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    } catch (err) {
      // Ignore "already owned by you" races; rethrow anything else.
      const name = (err as { name?: string })?.name || "";
      if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(name)) throw err;
    }
  }

  // Best-effort CORS for browser->S3 presigned POSTs. MinIO rejects this API
  // (NotImplemented) but allows cross-origin by default, so local dev works
  // without it. On AWS this needs s3:PutBucketCORS — if the IAM user lacks it,
  // apply the policy manually (documented in DEPLOY.md) and ignore this log.
  const origin = process.env.NEXT_PUBLIC_BASE_URL;
  if (origin) {
    try {
      await s3.send(
        new PutBucketCorsCommand({
          Bucket: BUCKET,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedMethods: ["POST"],
                AllowedOrigins: [origin, "http://localhost:3000"],
                AllowedHeaders: ["*"],
                ExposeHeaders: ["ETag"],
                MaxAgeSeconds: 3000,
              },
            ],
          },
        }),
      );
    } catch (err) {
      const name = (err as { name?: string })?.name || "";
      if (!/NotImplemented/.test(name)) {
        console.warn("[storage] could not set bucket CORS (set it manually):", name);
      }
    }
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export interface FetchedObject {
  body: Uint8Array;
  contentType: string;
}

/** Fetch an object's bytes, or null if it does not exist. */
export async function getObject(key: string): Promise<FetchedObject | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    const body = await res.Body!.transformToByteArray();
    return {
      body,
      contentType: res.ContentType || "application/octet-stream",
    };
  } catch (err) {
    const name = (err as { name?: string })?.name || "";
    if (/NoSuchKey|NotFound/.test(name)) return null;
    throw err;
  }
}

export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
}

/**
 * Presign a browser POST for one exact key. Conditions pin the key, the
 * content type, and a hard size range — the client cannot upload anything
 * except the declared HTML file within the plan's size cap.
 */
export async function presignUploadPost(
  key: string,
  maxBytes: number,
): Promise<PresignedUpload> {
  const { url, fields } = await createPresignedPost(s3Presign, {
    Bucket: BUCKET,
    Key: key,
    Conditions: [
      ["content-length-range", 1, maxBytes],
      ["eq", "$Content-Type", "text/html; charset=utf-8"],
    ],
    Fields: { "Content-Type": "text/html; charset=utf-8" },
    Expires: 900,
  });
  return { url, fields };
}

/** Object size in bytes, or null if the key does not exist. */
export async function headObject(key: string): Promise<{ size: number } | null> {
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { size: res.ContentLength ?? 0 };
  } catch (err) {
    const name = (err as { name?: string })?.name || "";
    if (/NotFound|NoSuchKey|404/.test(name)) return null;
    throw err;
  }
}

export interface StoredFile {
  name: string;
  size: number;
}

/** List files stored under a site prefix (names relative to the prefix). */
export async function listPrefix(prefix: string): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  let continuationToken: string | undefined;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of listed.Contents || []) {
      if (!obj.Key) continue;
      files.push({ name: obj.Key.slice(prefix.length), size: obj.Size || 0 });
    }
    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/** Delete every object under a site prefix. */
export async function deletePrefix(prefix: string): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const objects = (listed.Contents || [])
      .map((o) => o.Key)
      .filter((k): k is string => Boolean(k))
      .map((Key) => ({ Key }));

    if (objects.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: objects },
        }),
      );
    }
    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);
}
