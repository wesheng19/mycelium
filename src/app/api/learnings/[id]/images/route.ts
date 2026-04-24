import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, learnings } from "@/lib/db";
import {
  EXT_BY_MIME,
  IMAGE_MAX_BYTES,
  bytesToDownloadedImage,
} from "@/lib/images/fetch";
import { commitImage, imageVaultPath, type StoredImage } from "@/lib/images/store";
import { attachToBookEntry, attachToNote } from "@/lib/images/attach";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILES_PER_REQUEST = 10;
const COMMIT_CONCURRENCY = 3;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const expected = process.env.INGEST_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "INGEST_SECRET not configured" },
      { status: 500 }
    );
  }
  if (req.headers.get("x-ingest-secret") !== expected) return unauthorized();

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  if (!db) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 500 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 }
    );
  }

  const files: File[] = [];
  for (const value of formData.getAll("file")) {
    if (value instanceof File) files.push(value);
  }
  if (files.length === 0) {
    return NextResponse.json(
      { error: "No files in request (use field name `file`)." },
      { status: 400 }
    );
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Too many files — cap is ${MAX_FILES_PER_REQUEST} per request.` },
      { status: 400 }
    );
  }

  const rows = await db
    .select()
    .from(learnings)
    .where(eq(learnings.id, id))
    .limit(1);
  const entry = rows[0];
  if (!entry || !entry.markdownPath) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  // Convert + validate every file before committing anything.
  const candidates: { file: File; bytes: Uint8Array; contentType: string }[] =
    [];
  for (const file of files) {
    if (file.size > IMAGE_MAX_BYTES) {
      return NextResponse.json(
        {
          error: `File "${file.name}" exceeds 2 MB limit.`,
        },
        { status: 400 }
      );
    }
    const ct = (file.type || "").toLowerCase();
    if (!EXT_BY_MIME[ct]) {
      return NextResponse.json(
        {
          error: `File "${file.name}" has unsupported type "${ct || "unknown"}". Supported: PNG, JPEG, GIF, WebP, AVIF.`,
        },
        { status: 415 }
      );
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    candidates.push({ file, bytes: buf, contentType: ct });
  }

  // Commit images to the vault with bounded concurrency.
  const now = new Date();
  const stored: (StoredImage | null)[] = new Array(candidates.length).fill(null);
  for (let i = 0; i < candidates.length; i += COMMIT_CONCURRENCY) {
    const slice = candidates.slice(i, i + COMMIT_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async ({ file, bytes, contentType }) => {
        const dl = bytesToDownloadedImage({ bytes, contentType });
        if (!dl) return null;
        const path = imageVaultPath(now, dl.hash, dl.ext);
        const ok = await commitImage(path, dl.bytes);
        if (!ok) return null;
        return {
          hash: dl.hash,
          vaultPath: path,
          alt: stripExt(file.name),
          sourceUrl: "",
        } satisfies StoredImage;
      })
    );
    for (let j = 0; j < results.length; j++) {
      stored[i + j] = results[j];
    }
  }

  const seen = new Set<string>();
  const successful: StoredImage[] = [];
  for (const s of stored) {
    if (!s || seen.has(s.hash)) continue;
    seen.add(s.hash);
    successful.push(s);
  }

  if (successful.length === 0) {
    return NextResponse.json(
      { error: "All image commits failed." },
      { status: 502 }
    );
  }

  const ok =
    entry.source === "book"
      ? await attachToBookEntry(entry.markdownPath, entry.id, successful)
      : await attachToNote(entry.markdownPath, successful);

  if (!ok) {
    return NextResponse.json(
      {
        error:
          "Images uploaded but failed to inject into the vault file. They are still committed under images/.",
        attached: successful.map((s) => s.vaultPath),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    attached: successful.map((s) => ({ vaultPath: s.vaultPath, alt: s.alt })),
  });
}

function stripExt(name: string): string {
  return name.replace(/\.[^./\\]+$/, "").trim().slice(0, 200);
}
