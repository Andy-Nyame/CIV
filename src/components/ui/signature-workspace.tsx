"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from "react";

import {
  validateSignatureDimensions,
  validateSignatureFileDescriptor,
} from "@/features/profile/signature";

type SignatureMode = "draw" | "upload";

export function SignatureWorkspace() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const [mode, setMode] = useState<SignatureMode>("draw");
  const [message, setMessage] = useState<string>();
  const [uploadPreview, setUploadPreview] = useState<string>();
  const [uploadDetails, setUploadDetails] = useState<string>();

  useEffect(
    () => () => {
      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    },
    [uploadPreview],
  );

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;

    const position = point(event);
    const ink = getComputedStyle(document.documentElement)
      .getPropertyValue("--brand-navy")
      .trim();
    canvas.setPointerCapture(event.pointerId);
    context.strokeStyle = ink;
    context.lineWidth = 5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(position.x, position.y);
    drawingRef.current = true;
    setMessage(undefined);
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
    event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.getContext("2d")?.closePath();
    drawingRef.current = false;
  }

  function clearDrawing() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    hasInkRef.current = false;
    setMessage("Drawing cleared.");
  }

  async function chooseUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileError = validateSignatureFileDescriptor(file);
    if (fileError) {
      event.target.value = "";
      setMessage(fileError);
      return;
    }

    try {
      const bitmap = await createImageBitmap(file);
      const dimensionError = validateSignatureDimensions(bitmap.width, bitmap.height);
      const dimensions = `${bitmap.width} × ${bitmap.height}`;
      bitmap.close();
      if (dimensionError) {
        event.target.value = "";
        setMessage(dimensionError);
        return;
      }

      if (uploadPreview) URL.revokeObjectURL(uploadPreview);
      setUploadPreview(URL.createObjectURL(file));
      setUploadDetails(`${file.type.replace("image/", "").toUpperCase()} · ${dimensions}`);
      setMessage("Signature preview ready. It has not been uploaded or saved.");
    } catch {
      event.target.value = "";
      setMessage("CIV could not read this image. Choose another file.");
    }
  }

  function removeUploadPreview() {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadPreview(undefined);
    setUploadDetails(undefined);
    setMessage("Upload preview removed.");
  }

  return (
    <div className="grid gap-5">
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
              setMessage(undefined);
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
            aria-label="Signature drawing area. Use a pointer, touch, mouse, or trackpad to draw. Image upload is available as an accessible alternative."
            role="img"
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={clearDrawing}
              className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-text hover:bg-hover"
            >
              Clear
            </button>
            <button
              type="button"
              disabled
              aria-describedby="signature-storage-note"
              className="min-h-11 rounded-lg bg-civ-blue px-4 text-sm font-semibold text-white opacity-55"
            >
              Save Signature
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4">
          <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="signature-upload">
            Signature image
            <input
              id="signature-upload"
              className="min-h-12 rounded-lg border border-border bg-surface px-3 py-2 font-normal text-text file:mr-3 file:rounded-md file:border-0 file:bg-active file:px-3 file:py-2 file:font-semibold file:text-link"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={chooseUpload}
              aria-describedby="signature-upload-help signature-storage-note"
            />
          </label>
          <p id="signature-upload-help" className="text-sm leading-6 text-muted">
            PNG, JPEG, or WebP. Maximum 1 MB. SVG files are not accepted.
          </p>
          {uploadPreview ? (
            <div className="grid gap-3 rounded-xl border border-border bg-page p-4">
              <div className="relative min-h-40 overflow-hidden rounded-lg bg-white">
                <Image
                  alt="Selected signature preview"
                  src={uploadPreview}
                  fill
                  unoptimized
                  className="object-contain p-3"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted">{uploadDetails}</p>
                <button
                  type="button"
                  onClick={removeUploadPreview}
                  className="min-h-10 rounded-lg border border-border px-3 text-sm font-semibold text-text hover:bg-hover"
                >
                  Remove preview
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {message ? (
        <p className="text-sm leading-6 text-muted" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      <p id="signature-storage-note" className="rounded-lg border border-border bg-page px-4 py-3 text-sm leading-6 text-muted">
        Private signature storage has not been configured. Drawing and upload previews stay on this device and are not saved by CIV yet.
      </p>
    </div>
  );
}
