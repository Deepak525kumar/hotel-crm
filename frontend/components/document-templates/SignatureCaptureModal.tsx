"use client";

import { useEffect, useRef, useState } from "react";
import SignaturePad from "signature_pad";
import { Button, FormError, Modal } from "@/components/ui";
import { ApiError, documentTemplatesApi } from "@/lib/api";

export interface SignatureCaptureModalProps {
  open: boolean;
  onClose: () => void;
  instanceId: string;
  blockId: string;
  /** Label of the signature block being signed, shown in the modal title. */
  blockLabel: string;
  onSigned: () => void;
}

/**
 * Drawn-signature capture: a `<canvas>` driven directly by `signature_pad`'s
 * `SignaturePad` class (no React wrapper library — the class already owns
 * the canvas imperatively, wrapping it would just be an extra layer to keep
 * in sync). Confirm converts the canvas to a PNG Blob and uploads it via
 * `documentTemplatesApi.signBlock`.
 *
 * The disclosure copy below is mandatory, not decorative — this backend
 * records a drawn-image attestation (schema.prisma module header, "not a
 * legally-binding cryptographic e-signature"), and the UI must not imply
 * otherwise.
 */
export function SignatureCaptureModal({
  open,
  onClose,
  instanceId,
  blockId,
  blockLabel,
  onSigned,
}: SignatureCaptureModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The canvas only exists once `open` renders it, and its backing-store
  // size must be set in device pixels (not CSS pixels) for signature_pad to
  // capture at native resolution -- both reasons this can't just run once at
  // mount. Re-created on every open so a previous session's strokes/pad
  // instance never leak into a fresh sign attempt.
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext("2d")?.scale(ratio, ratio);

    const pad = new SignaturePad(canvas, { backgroundColor: "rgb(255, 255, 255)" });
    pad.addEventListener("endStroke", () => setIsEmpty(pad.isEmpty()));
    padRef.current = pad;
    setIsEmpty(true);
    setError(null);

    return () => {
      pad.off();
      padRef.current = null;
    };
  }, [open]);

  const onClear = () => {
    padRef.current?.clear();
    setIsEmpty(true);
  };

  const onConfirm = () => {
    const pad = padRef.current;
    const canvas = canvasRef.current;
    if (!pad || !canvas || pad.isEmpty()) {
      setError("Draw a signature before confirming.");
      return;
    }
    setError(null);
    setSubmitting(true);
    canvas.toBlob(async (blob) => {
      if (!blob) {
        setError("Could not capture the signature. Please try again.");
        setSubmitting(false);
        return;
      }
      try {
        await documentTemplatesApi.signBlock(instanceId, blockId, blob);
        setSubmitting(false);
        onSigned();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
        setSubmitting(false);
      }
    }, "image/png");
  };

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Sign: ${blockLabel}`}
      footer={
        <>
          <Button variant="outline" onClick={onClear} disabled={submitting}>
            Clear
          </Button>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onConfirm} loading={submitting} disabled={isEmpty}>
            Confirm signature
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-500">
          Draw your signature in the box below using a mouse, stylus, or finger.
        </p>
        <canvas
          ref={canvasRef}
          className="h-48 w-full touch-none rounded-md border border-gray-300 bg-white"
        />
        <p className="text-xs text-gray-500">
          Recorded for audit purposes; not a qualified electronic signature.
        </p>
        <FormError>{error}</FormError>
      </div>
    </Modal>
  );
}
