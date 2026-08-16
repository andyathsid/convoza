"use client";

import { z } from "zod";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Send, Mic, Pause, Play, Trash2, Square, Smile } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import ChatReplyBar from "./chat-reply-bar";
import AttachmentMenu from "./attachment-menu";
import MediaComposer, { type PendingMedia } from "./media-composer";
import { useChatStore } from "@/stores/chat-store";
import { useUIStore } from "@/stores/ui-store";
import { useTheme } from "@/components/theme-provider";
import EmojiPicker, { Theme, type EmojiClickData } from "emoji-picker-react";
import { useEnterToSend } from "@/hooks/use-enter-to-send";
import { useAuth } from "@/stores/use-auth";
import { validateStorageUpload } from "@/lib/upload";

interface Props {
  chatId: string;
}

type RecordedAudio = {
  blob: Blob;
  contentType: "audio/webm" | "audio/mp4" | "audio/ogg";
  extension: "webm" | "m4a" | "ogg";
};

const AUDIO_RECORDING_FORMATS = [
  { recorderMimeType: "audio/webm;codecs=opus", contentType: "audio/webm", extension: "webm" },
  { recorderMimeType: "audio/webm", contentType: "audio/webm", extension: "webm" },
  { recorderMimeType: "audio/mp4;codecs=mp4a.40.2", contentType: "audio/mp4", extension: "m4a" },
  { recorderMimeType: "audio/mp4", contentType: "audio/mp4", extension: "m4a" },
  { recorderMimeType: "audio/ogg;codecs=opus", contentType: "audio/ogg", extension: "ogg" },
  { recorderMimeType: "audio/ogg", contentType: "audio/ogg", extension: "ogg" },
] as const;

function getAudioRecordingFormat(): (typeof AUDIO_RECORDING_FORMATS)[number] | null {
  const audio = document.createElement("audio");
  return AUDIO_RECORDING_FORMATS.find(({ recorderMimeType }) => {
    return MediaRecorder.isTypeSupported(recorderMimeType)
      && audio.canPlayType(recorderMimeType) !== "";
  }) ?? null;
}

const ChatFooter = ({ chatId }: Props) => {
  const messageSchema = z.object({
    message: z.string().optional(),
  });

  const { sendMessage, isSending, signalTyping, stopTyping } = useChatStore();
  const currentUserId = useAuth((state) => state.user?.id);
  const { replyTo, setReplyTo } = useUIStore();
  const { theme } = useTheme();

  const [emojiOpen, setEmojiOpen] = useState(false);

  // Pending media files (multi-file with per-file captions)
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedAudioRef = useRef<RecordedAudio | null>(null);
  const cancellingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordedDurationMsRef = useRef(0);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const [hasText, setHasText] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaFocusedRef = useRef(false);

  const form = useForm({
    resolver: zodResolver(messageSchema),
    defaultValues: { message: "" },
  });
  const messageField = form.register("message");

  // Watch input value for mic/send toggle
  const messageValue = form.watch("message");
  useEffect(() => {
    const containsText = !!messageValue?.trim();
    setHasText(containsText);
    if (containsText && textareaFocusedRef.current && currentUserId) {
      signalTyping(chatId, currentUserId);
    } else {
      stopTyping();
    }
  }, [chatId, currentUserId, messageValue, signalTyping, stopTyping]);

  useEffect(() => {
    return () => stopTyping();
  }, [chatId, currentUserId, stopTyping]);

  // Recording timer
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => {
        const activeSegmentMs = recordingStartedAtRef.current === null
          ? 0
          : performance.now() - recordingStartedAtRef.current;
        setRecordingDuration(
          Math.floor((recordedDurationMsRef.current + activeSegmentMs) / 1000)
        );
      }, 250);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording, isPaused]);

  // Audio preview playback tracking
  useEffect(() => {
    const audio = audioPreviewRef.current;
    if (!audio) return;
    const onEnded = () => {
      setIsPlayingPreview(false);
      setCurrentTime(0);
    };
    const onTimeUpdate = () => {
      if (!isSeeking) setCurrentTime(audio.currentTime);
    };
    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setAudioDuration(audio.duration);
      }
      setCurrentTime(0);
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [audioUrl, isSeeking]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // --- Emoji picker ---
  const handleEmojiClick = (emojiData: EmojiClickData) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const current = form.getValues("message") || "";
    const next = current.slice(0, start) + emojiData.emoji + current.slice(end);
    form.setValue("message", next, { shouldValidate: true });
    // Set cursor position without stealing focus: popover stays open for
    // multi-select. Focus will land on the textarea when popover closes.
    requestAnimationFrame(() => {
      const pos = start + emojiData.emoji.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  // --- Media handling ---
  const handleFilesAdded = (newMedia: PendingMedia[]) => {
    setPendingMedia((prev) => [...prev, ...newMedia]);
    // Clear text input when media is added: caption is per-file
    form.reset();
  };

  const handleRemoveMedia = (index: number) => {
    setPendingMedia((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const pendingMediaRef = useRef(pendingMedia);
  pendingMediaRef.current = pendingMedia;

  const handleUpdateCaption = (index: number, caption: string) => {
    setPendingMedia((prev) => {
      const next = prev.map((item, i) => (i === index ? { ...item, caption } : item));
      pendingMediaRef.current = next;
      return next;
    });
  };

  const handleReorder = (fromIndex: number, toIndex: number) => {
    setPendingMedia((prev) => {
      const newMedia = [...prev];
      const [moved] = newMedia.splice(fromIndex, 1);
      newMedia.splice(toIndex, 0, moved);
      return newMedia;
    });
  };

  const clearPendingMedia = () => {
    pendingMedia.forEach((m) => URL.revokeObjectURL(m.preview));
    setPendingMedia([]);
  };

  // --- Audio recording ---
  const startRecording = async () => {
    try {
      if (typeof MediaRecorder === "undefined") {
        throw new Error("MediaRecorder is unavailable");
      }
      const recordingFormat = getAudioRecordingFormat();
      if (!recordingFormat) {
        throw new Error("No supported audio recording format");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: recordingFormat.recorderMimeType,
      });
      const recordedMimeType = mediaRecorder.mimeType || recordingFormat.recorderMimeType;
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      recordedAudioRef.current = null;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        if (cancellingRef.current) {
          cancellingRef.current = false;
          return;
        }
        const blob = new Blob(chunksRef.current, {
          type: recordedMimeType,
        });
        if (blob.size === 0) {
          toast.error("No audio was recorded");
          return;
        }
        recordedAudioRef.current = {
          blob,
          contentType: recordingFormat.contentType,
          extension: recordingFormat.extension,
        };
        setAudioDuration(Math.max(recordedDurationMsRef.current / 1000, 0.1));
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
      };

      // Periodic chunks avoid relying on track shutdown to produce the only data event.
      mediaRecorder.start(250);
      recordedDurationMsRef.current = 0;
      recordingStartedAtRef.current = performance.now();
      setIsRecording(true);
      setIsPaused(false);
      setRecordingDuration(0);
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (
        error instanceof DOMException
        && (error.name === "NotAllowedError" || error.name === "NotFoundError")
      ) {
        toast.error("Microphone access denied");
      } else {
        console.error("Audio recording unavailable:", error);
        toast.error("Audio recording is not supported in this browser");
      }
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      if (recordingStartedAtRef.current !== null) {
        recordedDurationMsRef.current += performance.now() - recordingStartedAtRef.current;
        recordingStartedAtRef.current = null;
      }
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      recordingStartedAtRef.current = performance.now();
      setIsPaused(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      if (recordingStartedAtRef.current !== null) {
        recordedDurationMsRef.current += performance.now() - recordingStartedAtRef.current;
        recordingStartedAtRef.current = null;
      }
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
    }
  };

  const togglePreviewPlayback = async () => {
    const audio = audioPreviewRef.current;
    if (!audio) return;
    if (isPlayingPreview) {
      audio.pause();
      setIsPlayingPreview(false);
    } else {
      try {
        await audio.play();
        setIsPlayingPreview(true);
      } catch (error) {
        // Playback failures are actionable UI state, not background promise errors.
        console.error("Recorded audio preview failed:", error);
        setIsPlayingPreview(false);
        toast.error("This browser could not play the recorded audio");
      }
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      cancellingRef.current = true;
      mediaRecorderRef.current.stop();
    } else {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      audioPreviewRef.current = null;
    }
    setIsRecording(false);
    setIsPaused(false);
    setAudioUrl(null);
    setRecordingDuration(0);
    setIsPlayingPreview(false);
    setCurrentTime(0);
    setAudioDuration(0);
    chunksRef.current = [];
    recordedAudioRef.current = null;
    recordingStartedAtRef.current = null;
    recordedDurationMsRef.current = 0;
  };

  const sendAudioMessage = async () => {
    const recording = recordedAudioRef.current;
    if (!audioUrl || !recording) return;
    const file = new File(
      [recording.blob],
      `audio_${Date.now()}.${recording.extension}`,
      { type: recording.contentType },
    );
    const validationError = validateStorageUpload("audio", file);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const currentReplyTo = replyTo;
    const urlToRevoke = audioUrl;

    // Reset footer UI immediately
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      audioPreviewRef.current = null;
    }
    setIsRecording(false);
    setIsPaused(false);
    setAudioUrl(null);
    setRecordingDuration(0);
    setIsPlayingPreview(false);
    setCurrentTime(0);
    setAudioDuration(0);
    chunksRef.current = [];
    recordedAudioRef.current = null;
    recordingStartedAtRef.current = null;
    recordedDurationMsRef.current = 0;
    setReplyTo(null);

    try {
      await sendMessage({
        chatId,
        file,
        mediaType: "audio",
        localPreview: urlToRevoke,
        replyToId: currentReplyTo?.id,
        replyTo: currentReplyTo || undefined,
      });
    } finally {
      URL.revokeObjectURL(urlToRevoke);
    }
  };

  // --- Submit ---
  const onSubmit = async (values: { message?: string }) => {
    const text = values.message?.trim();
    if (!text && pendingMedia.length === 0) {
      toast.error("Please enter a message or select a file");
      return;
    }

    const currentReplyTo = replyTo;
    stopTyping();

    // Capture state before reset: use ref for pendingMedia so the latest
    // caption flush from media-preview-bar is included synchronously.
    const mediaToSend = [...pendingMediaRef.current];
    const textToSend = text;

    // Immediate reset - don't wait for delivery
    form.reset();
    clearPendingMedia();
    setReplyTo(null);

    if (mediaToSend.length > 0) {
      // Send media: per-file captions are included, no separate text message
      await sendMessage({
        chatId,
        files: mediaToSend.map((m) => ({
          file: m.file,
          mediaType: m.mediaType,
          caption: m.caption || undefined,
        })),
        replyToId: currentReplyTo?.id,
        replyTo: currentReplyTo || undefined,
      });
    } else if (textToSend) {
      // Send standalone text message
      await sendMessage({
        chatId,
        content: textToSend,
        replyToId: currentReplyTo?.id,
        replyTo: currentReplyTo || undefined,
      });
    }
  };

  const showRecordingUI = isRecording || audioUrl !== null;
  const hasMedia = pendingMedia.length > 0;

  const handleMediaSend = useCallback(() => {
    void form.handleSubmit(onSubmit)();
  }, [form, onSubmit]);

  const handleSubmitForm = useCallback(() => {
    form.handleSubmit(onSubmit)();
  }, [form, onSubmit]);
  const handleKeyDown = useEnterToSend(handleSubmitForm);

  return (
    <TooltipProvider>
      <div className="sticky bottom-0 bg-card border-t border-border">
        {replyTo && (
          <ChatReplyBar replyTo={replyTo} onCancel={() => setReplyTo(null)} />
        )}

        {hasMedia ? (
          <MediaComposer
            media={pendingMedia}
            onRemove={handleRemoveMedia}
            onUpdateCaption={handleUpdateCaption}
            onReorder={handleReorder}
            onFilesAdded={handleFilesAdded}
            onSend={handleMediaSend}
            isSending={isSending}
          />
        ) : (
          <form
            onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
            className="flex items-center gap-2 p-2"
          >
            {showRecordingUI ? (
              <>
                {/* Audio preview element */}
                {audioUrl && <audio ref={audioPreviewRef} src={audioUrl} preload="metadata" />}

                {/* Trash - cancel */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={cancelRecording}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Cancel</TooltipContent>
                </Tooltip>

                {/* Play/Pause preview */}
                {audioUrl && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void togglePreviewPlayback()}
                      >
                        {isPlayingPreview ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{isPlayingPreview ? "Pause" : "Play"}</TooltipContent>
                  </Tooltip>
                )}

                {/* Recording duration / progress display */}
                <div className="flex-1 flex items-center gap-2 px-2">
                  {isRecording && !audioUrl && (
                    <div className="flex items-center gap-2 flex-1">
                      <div className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                      <span className="text-sm tabular-nums">{formatDuration(recordingDuration)}</span>
                      <span className="text-xs text-muted-foreground">
                        {isPaused ? "Paused" : "Recording..."}
                      </span>
                    </div>
                  )}
                  {audioUrl && (
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
                        {formatDuration(Math.floor(currentTime))}
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={audioDuration || 0}
                        step={0.1}
                        value={currentTime}
                        onMouseDown={() => setIsSeeking(true)}
                        onTouchStart={() => setIsSeeking(true)}
                        onMouseUp={(e) => {
                          setIsSeeking(false);
                          const val = parseFloat((e.target as HTMLInputElement).value);
                          if (audioPreviewRef.current) audioPreviewRef.current.currentTime = val;
                        }}
                        onTouchEnd={(e) => {
                          setIsSeeking(false);
                          const val = parseFloat((e.target as HTMLInputElement).value);
                          if (audioPreviewRef.current) audioPreviewRef.current.currentTime = val;
                        }}
                        onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
                        className="flex-1 h-1 accent-primary cursor-pointer"
                      />
                      <span className="text-xs tabular-nums text-muted-foreground w-10">
                        {formatDuration(Math.floor(audioDuration))}
                      </span>
                    </div>
                  )}
                </div>

                {/* Pause/Resume recording */}
                {isRecording && !audioUrl && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={isPaused ? resumeRecording : pauseRecording}
                      >
                        {isPaused ? <Mic className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{isPaused ? "Resume" : "Pause"}</TooltipContent>
                  </Tooltip>
                )}

                {/* Stop recording / Send audio */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      disabled={isSending}
                      onClick={audioUrl ? sendAudioMessage : stopRecording}
                    >
                      {audioUrl ? <Send className="h-4 w-4" /> : <Square className="h-3.5 w-3.5" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{audioUrl ? "Send" : "Stop"}</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <>
                <AttachmentMenu
                  onFilesAdded={handleFilesAdded}
                  // disabled={isSending}
                />

                <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="icon-sm">
                      <Smile className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  {createPortal(
                    <PopoverContent
                      align="start"
                      side="top"
                      className="w-auto p-0 border-0"
                    >
                      <EmojiPicker
                        theme={theme === "dark" ? Theme.DARK : Theme.LIGHT}
                        onEmojiClick={handleEmojiClick}
                        width={350}
                        height={400}
                      />
                    </PopoverContent>,
                    document.body
                  )}
                </Popover>

                <Textarea
                  data-testid="chat-message-input"
                  placeholder="Type new message"
                  className="flex-1 min-h-10 max-h-40 resize-none"
                  rows={1}
                  {...messageField}
                  ref={(el) => {
                    messageField.ref(el);
                    textareaRef.current = el;
                  }}
                  onFocus={() => {
                    textareaFocusedRef.current = true;
                    const value = form.getValues("message");
                    if (value?.trim() && currentUserId) {
                      signalTyping(chatId, currentUserId);
                    }
                  }}
                  onBlur={(event) => {
                    messageField.onBlur(event);
                    textareaFocusedRef.current = false;
                    stopTyping();
                  }}
                  onKeyDown={handleKeyDown}
                />

                {hasText ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button type="submit" size="icon-sm">
                        <Send className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Send</TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-sm" onClick={startRecording}>
                        <Mic className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Voice message</TooltipContent>
                  </Tooltip>
                )}
              </>
            )}
          </form>
        )}
      </div>
    </TooltipProvider>
  );
};

export default ChatFooter;
