"use client";

import { useState } from "react";
import { Moon, MoreVertical, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/features/auth";
import AvatarWithBadge from "@/components/avatar-with-badge";
import { SettingsPopover } from "@/features/account";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AsideBarPopover() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Open chat menu"
          >
            <MoreVertical className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[99999] min-w-48">
          <DropdownMenuItem
            className="gap-3 px-2 py-2"
            onSelect={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              {theme === "light" ? (
                <Moon className="size-4" />
              ) : (
                <Sun className="size-4" />
              )}
            </span>
            {theme === "light" ? "Dark mode" : "Light mode"}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-3 px-2 py-2"
            onSelect={() => setSettingsOpen(true)}
          >
            <AvatarWithBadge
              name={user?.username || "U"}
              src={user?.avatar || ""}
              size="h-5 w-5"
            />
            Profile
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SettingsPopover open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
