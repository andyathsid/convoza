"use client";

import { useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, X } from "lucide-react";

interface AudioRecorderProps {
  onRecord: (file: File) => void;
  onCancel: () => void;
}

export default function AudioRecorder({ onRecord, onCancel }: AudioRecorderProps) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `audio_${Date.now()}.webm`, { type: "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        onRecord(file);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  }, [onRecord]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [isRecording]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-muted/50 rounded-lg">
      {!isRecording ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </Button>
          <Button
            variant="destructive"
            size="icon"
            className="rounded-full"
            onClick={startRecording}
          >
            <Mic className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Tap to record</span>
        </>
      ) : (
        <>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (timerRef.current) clearInterval(timerRef.current);
              if (mediaRecorderRef.current) {
                mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
              }
              setIsRecording(false);
              onCancel();
            }}
          >
            <X className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-mono">{formatDuration(duration)}</span>
          </div>
          <Button
            variant="default"
            size="icon"
            className="rounded-full"
            onClick={stopRecording}
          >
            <Square className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}
