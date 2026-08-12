"use client";

import Image from "next/image";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";

import {
  removeSignatureAction,
  saveSignatureAction,
} from "@/features/profile/actions";
import {
  validateSignatureDimensions,
  validateSignatureFileDescriptor,
} from "@/features/profile/signature";
import { initialProfileFormState } from "@/features/profile/types";

type SignatureMode = "draw" | "upload";
type SavedSignature = {
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  updatedAt: Date;
} | null;

export function SignatureWorkspace({
  savedSignature,
  savedSignatureUrl,
}: {
  savedSignature: SavedSignature;
  savedSignatureUrl: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const [mode, setMode] = useState<SignatureMode>("draw");
  const [localMessage, setLocalMessage] = useState<string>();
  const [uploadPreview, setUploadPreview] = useState<string>();
  const [uploadFile, setUploadFile] = useState<File>();
  const [uploadDetails, setUploadDetails] = useState<string>();
  const [saveState, saveAction, savePending] = useActionState(
    saveSignatureAction,
    initialProfileFormState,
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeSignatureAction,
    initialProfileFormState,
  );

  useEffect(
    () => () => {
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    },
    [uploadPreview],
  );

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * event.currentTarget.width,
      y: ((event.clientY - bounds.top) / bounds.height) * event.currentTarget.height,
    };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const position = point(event);
    const ink = getComputedStyle(document.documentElement)
      .getPropertyValue("--brand-navy")
      .trim();
    event.currentTarget.setPointerCapture(event.pointerId);
    context.strokeStyle = ink;
    context.lineWidth = 5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(position.x, position.y);
    drawingRef.current = true;
    setLocalMessage(undefined);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const position = point(event);
    context.lineTo(position.x, position.y);
    context.stroke();
    hasInkRef.current = true;
  }

  function stopDrawing(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.currentTarget.getContext("2d")?.closePath();
    drawingRef.current = false;
  }

  function clearDrawing() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    hasInkRef.current = false;
    setLocalMessage("Drawing cleared.");
  }

  function submitFile(file: File) {
    const formData = new FormData();
    formData.set("image", file);
    startTransition(() => saveAction(formData));
  }

  function saveDrawing() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInkRef.current) {
      setLocalMessage("Draw your signature before saving.");
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        setLocalMessage("CIV could not prepare this drawing.");
        return;
      }
      submitFile(new File([blob], "drawn-signature.png", { type: "image/png" }));
    }, "image/png");
  }

  async function chooseUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const fileError = validateSignatureFileDescriptor(file);
    if (fileError) {
      event.target.value = "";
      setLocalMessage(fileError);
      return;
    }

    try {
      const bitmap = await createImageBitmap(file);
      const dimensionError = validateSignatureDimensions(bitmap.width, bitmap.height);
      const dimensions = `${bitmap.width} × ${bitmap.height}`;
      bitmap.close();
      if (dimensionError) {
        event.target.value = "";
        setLocalMessage(dimensionError);
        return;
      }
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
      setUploadPreview(URL.createObjectURL(file));
      setUploadFile(file);
      setUploadDetails(`${file.type.replace("image/", "").toUpperCase()} · ${dimensions}`);
      setLocalMessage("Signature preview ready.");
    } catch {
      event.target.value = "";
      setLocalMessage("CIV could not read this image. Choose another file.");
    }
  }

  function removeUploadPreview() {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadPreview(undefined);
    setUploadFile(undefined);
    setUploadDetails(undefined);
    setLocalMessage("Upload preview removed.");
  }

  const status = saveState.message ?? removeState.message ?? localMessage;
  const statusSuccess = Boolean(saveState.success || removeState.success);

  return (
    <div className="grid gap-5">
      {savedSignature && savedSignatureUrl ? (
        <div className="grid gap-3 rounded-xl border border-border bg-page p-4">
          <div className="relative min-h-40 overflow-hidden rounded-lg bg-white">
            <Image
              alt="Your saved personal signature"
              src={savedSignatureUrl}
              fill
              unoptimized
              className="object-contain p-3"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium text-muted">
              {savedSignature.mimeType.replace("image/", "").toUpperCase()} · {savedSignature.width} × {savedSignature.height}
            </p>
            <form action={removeAction}>
              <button
                disabled={removePending}
                className="min-h-10 rounded-lg border border-danger px-3 text-sm font-semibold text-danger hover:bg-hover disabled:cursor-wait disabled:opacity-70"
              >
                {removePending ? "Removing…" : "Remove signature"}
              </button>
            </form>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">No personal signature is saved.</p>
      )}

      <div className="inline-flex w-fit rounded-lg border border-border bg-page p-1" aria-label="Signature input method">
        {(["draw", "upload"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={`min-h-10 rounded-md px-4 text-sm font-semibold ${
              mode === option ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text"
            }`}
            aria-pressed={mode === option}
            onClick={() => {
              setMode(option);
              setLocalMessage(undefined);
            }}
          >
            {option === "draw" ? "Draw Signature" : "Upload Signature"}
          </button>
        ))}
      </div>

      {mode === "draw" ? (
        <div className="grid gap-3">
          <canvas
            ref={canvasRef}
            width={1200}
            height={360}
            className="aspect-[10/3] w-full touch-none rounded-xl border border-border bg-white"
            aria-label="Signature drawing area. Use pointer or touch to draw. Image upload is available as an accessible alternative."
            role="img"
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={clearDrawing} className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text hover:bg-hover">
              Clear
            </button>
            <button type="button" onClick={saveDrawing} disabled={savePending} className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white hover:bg-civ-blue-hover disabled:cursor-wait disabled:opacity-70">
              {savePending ? "Saving…" : savedSignature ? "Replace signature" : "Save Signature"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="signature-upload">
            Signature image
            <input id="signature-upload" className="min-h-12 rounded-lg border border-border bg-surface px-3 py-2 font-normal text-text file:mr-3 file:rounded-md file:border-0 file:bg-active file:px-3 file:py-2 file:font-semibold file:text-link" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseUpload} aria-describedby="signature-upload-help" />
          </label>
          <p id="signature-upload-help" className="text-sm leading-6 text-muted">PNG, JPEG, or WebP. Maximum 1 MB. SVG files are not accepted.</p>
          {uploadPreview ? (
            <div className="grid gap-3 rounded-xl border border-border bg-page p-4">
              <div className="relative min-h-40 overflow-hidden rounded-lg bg-white">
                <Image alt="Selected signature preview" src={uploadPreview} fill unoptimized className="object-contain p-3" />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted">{uploadDetails}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={removeUploadPreview} className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold text-text hover:bg-hover">Remove preview</button>
                  <button type="button" disabled={!uploadFile || savePending} onClick={() => uploadFile && submitFile(uploadFile)} className="min-h-10 rounded-lg bg-civ-blue px-3 text-sm font-semibold text-white hover:bg-civ-blue-hover disabled:cursor-wait disabled:opacity-70">
                    {savePending ? "Saving…" : savedSignature ? "Replace signature" : "Save Signature"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {status ? (
        <p className={`text-sm leading-6 ${statusSuccess ? "text-success" : "text-danger"}`} role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
      <p className="rounded-lg border border-border bg-page px-4 py-3 text-sm leading-6 text-muted">
        CIV stores this personal asset privately. Future issued documents will capture an immutable copy or reference so later profile changes cannot alter document history.
      </p>
    </div>
  );
}
