"use client";

import { useState } from "react";
import { useAuth } from "@/stores/use-auth";
import { useTheme } from "@/components/theme-provider";
import Logo from "./logo";
import { Button } from "./ui/button";
import { Moon, Sun } from "lucide-react";
import AvatarWithBadge from "./avatar-with-badge";
import { SettingsPopover } from "./settings-popover";

const AsideBar = () => {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <aside className="h-full w-11 shrink-0 bg-primary/85 shadow-sm hidden lg:flex flex-col">
      <div className="w-full h-full px-1 pt-3 pb-6 flex flex-col items-center justify-between">
        <Logo
          url="/chat"
          imgClass="size-7 justify-center bg-transparent p-1"
          iconClass="text-white"
          textClass="text-white"
          showText={false}
        />

        <div className="flex flex-col items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-white hover:bg-white/10 hover:text-white"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
            <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:-rotate-0" />
          </Button>

          <button
            className="rounded-full p-0 cursor-pointer"
            onClick={() => setSettingsOpen(true)}
          >
            <AvatarWithBadge
              name={user?.username || "U"}
              src={user?.avatar || ""}
              size="h-8 w-8"
            />
          </button>
        </div>
      </div>

      <SettingsPopover open={settingsOpen} onOpenChange={setSettingsOpen} />
    </aside>
  );
};

export default AsideBar;
