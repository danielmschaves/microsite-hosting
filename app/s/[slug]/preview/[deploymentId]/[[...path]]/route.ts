import { servePreview, handlePreviewPasswordSubmit } from "@/lib/previewServing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Path-based preview-deployment serving. The actual logic lives in
// lib/previewServing.ts, shared with the host-based route (CD-20,
// app/mbhost/[[...path]]/route.ts) so a {deploymentId}.<previewApex> visitor
// gets byte-identical behavior to this URL.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; deploymentId: string; path?: string[] }> },
) {
  const { slug, deploymentId, path } = await params;
  return servePreview(req, {
    slug,
    deploymentId,
    path: path || [],
    publicPath: new URL(req.url).pathname,
  });
}

// POST — password-form submission for "password"/"hybrid" access modes.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; deploymentId: string; path?: string[] }> },
) {
  const { slug, deploymentId } = await params;
  const publicPath = new URL(req.url).pathname;
  return handlePreviewPasswordSubmit(req, {
    slug,
    deploymentId,
    publicPath,
    cookiePath: `/s/${slug}/preview/${deploymentId}`,
  });
}
