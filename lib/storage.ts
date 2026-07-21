import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT || undefined;

// A single shared client. `forcePathStyle` is required for MinIO and any
// S3-compatible store addressed by a custom endpoint.
const globalForS3 = globalThis as unknown as { _s3?: S3Client };

export const s3: S3Client =
  globalForS3._s3 ??
  new S3Client({
    endpoint,
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: Boolean(endpoint),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForS3._s3 = s3;
}

export const BUCKET = process.env.S3_BUCKET || "shipsite";

/** Create the bucket if it does not exist (mainly for local MinIO). */
export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return;
  } catch {
    // fall through to create
  }
  try {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  } catch (err) {
    // Ignore "already owned by you" races; rethrow anything else.
    const name = (err as { name?: string })?.name || "";
    if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(name)) throw err;
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
