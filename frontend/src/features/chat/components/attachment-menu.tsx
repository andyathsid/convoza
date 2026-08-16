"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Image as ImageIcon, Camera, FileUp, Paperclip, Headphones } from "lucide-react";
import { validateStorageUpload } from "@/lib/upload";
import { toast } from "sonner";

interface PendingMedia {
  file: File;
  preview: string;
  mediaType: "image" | "video" | "audio" | "document";
  caption: string;
}

interface Props {
  onFilesAdded: (media: PendingMedia[]) => void;
  disabled?: boolean;
}

const MENU_ITEMS = [
  { label: "Photos & Videos", icon: ImageIcon, color: "bg-purple-500", input: "photo" },
  { label: "Camera", icon: Camera, color: "bg-pink-500", input: "camera" },
  { label: "Audio", icon: Headphones, color: "bg-orange-500", input: "audio" },
  { label: "Documents", icon: FileUp, color: "bg-blue-500", input: "document" },
] as const;

export default function AttachmentMenu({ onFilesAdded, disabled }: Props) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const processFiles = (
    files: FileList | File[],
    mediaType: "image" | "video" | "audio" | "document"
  ) => {
    const result: PendingMedia[] = [];
    const isMediaImage = mediaType === "image";

    Array.from(files).forEach((file) => {
      const actualType = isMediaImage && file.type.startsWith("video/") ? "video" : mediaType;
      const validationError = validateStorageUpload(actualType, file);
      if (validationError) {
        toast.error(`${file.name}: ${validationError}`);
        return;
      }
      result.push({
        file,
        preview: URL.createObjectURL(file),
        mediaType: actualType,
        caption: "",
      });
    });

    if (result.length > 0) onFilesAdded(result);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files, "image");
    e.target.value = "";
  };

  const handleDocumentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files, "document");
    e.target.value = "";
  };

  const handleAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files, "audio");
    e.target.value = "";
  };

  const openFilePicker = (input: (typeof MENU_ITEMS)[number]["input"]) => {
    const inputRefs = {
      photo: photoInputRef,
      camera: cameraInputRef,
      audio: audioInputRef,
      document: documentInputRef,
    };
    inputRefs[input].current?.click();
  };

  return (
    <>
      <input
        type="file"
        ref={photoInputRef}
        onChange={handlePhotoChange}
        accept="image/*,video/*"
        multiple
        className="hidden"
      />
      <input
        type="file"
        ref={cameraInputRef}
        onChange={handlePhotoChange}
        accept="image/*"
        capture="environment"
        className="hidden"
      />
      <input
        type="file"
        ref={documentInputRef}
        onChange={handleDocumentChange}
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
        multiple
        className="hidden"
      />
      <input
        type="file"
        ref={audioInputRef}
        onChange={handleAudioChange}
        accept="audio/*"
        multiple
        className="hidden"
      />

      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
              >
                <Paperclip className="h-5 w-5" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Attach</TooltipContent>
        </Tooltip>

        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-52 p-2"
        >
          <div className="flex flex-col gap-1">
            {MENU_ITEMS.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => openFilePicker(item.input)}
                className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-left"
              >
                <div
                  className={`${item.color} rounded-full p-2 text-white transition-transform group-hover:scale-110`}
                >
                  <item.icon className="h-4 w-4" />
                </div>
                <span className="text-sm text-foreground">
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
