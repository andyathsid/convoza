"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Camera, X } from "lucide-react";

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

export default function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsReady(true);
      }
    } catch (err) {
      console.error("Camera access denied:", err);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    const animationFrame = requestAnimationFrame(() => void startCamera());
    return () => {
      cancelAnimationFrame(animationFrame);
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera_${Date.now()}.jpg`, { type: "image/jpeg" });
        setCaptured(URL.createObjectURL(blob));
        stopCamera();
        onCapture(file);
      },
      "image/jpeg",
      0.85
    );
  };

  const handleRetake = () => {
    setCaptured(null);
    startCamera();
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4">
      <div className="relative max-w-lg w-full">
        <Button
          variant="ghost"
          size="icon"
          className="absolute -top-12 right-0 text-white hover:text-white/80"
          onClick={() => {
            stopCamera();
            onClose();
          }}
        >
          <X className="h-6 w-6" />
        </Button>

        {captured ? (
          // Camera previews are local blob URLs, so framework image optimization cannot help.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={captured} alt="Captured" className="w-full rounded-lg" />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full rounded-lg"
          />
        )}

        <canvas ref={canvasRef} className="hidden" />

        <div className="flex justify-center mt-4 gap-4">
          {captured ? (
            <Button onClick={handleRetake} variant="outline" className="text-white border-white">
              Retake
            </Button>
          ) : (
            <Button
              onClick={handleCapture}
              disabled={!isReady}
              className="rounded-full w-14 h-14 p-0"
            >
              <Camera className="h-6 w-6" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
