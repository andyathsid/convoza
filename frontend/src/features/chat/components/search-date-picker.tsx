"use client";

import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { CalendarSearch, ChevronLeft, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface SearchDateRange {
  from: Date;
  to?: Date;
}

interface SearchDatePickerProps {
  value?: SearchDateRange;
  onChange: (value?: SearchDateRange) => void;
}

export default function SearchDatePicker({
  value,
  onChange,
}: SearchDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [today] = useState(() => startOfDay(new Date()));
  const [visibleMonth, setVisibleMonth] = useState<Date>(() =>
    startOfMonth(value?.from ?? today)
  );

  const days = useMemo(() => {
    const monthStart = startOfMonth(visibleMonth);
    const monthEnd = endOfMonth(visibleMonth);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [visibleMonth]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={value ? "secondary" : "ghost"}
          size="icon"
          className={cn(
            "h-12 w-12 rounded-full border border-border/70 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            value && "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15"
          )}
          aria-label={
            value ? "Change date range filter" : "Filter messages by date range"
          }
        >
          <CalendarSearch className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        className="z-[99999] w-64 gap-0 rounded-xl bg-popover p-2 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
      >
        <div className="mb-3 flex h-8 items-center justify-between pl-2">
          <p className="font-semibold tracking-tight">
            {format(visibleMonth, "MMMM yyyy")}
          </p>
          <div className="flex items-center gap-0.5">
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="rounded-full text-muted-foreground"
                onClick={() => onChange(undefined)}
                aria-label="Clear date range"
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-muted-foreground"
              onClick={() => setVisibleMonth((current) => subMonths(current, 1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-muted-foreground"
              onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
              disabled={
                isSameMonth(visibleMonth, today) || isAfter(visibleMonth, today)
              }
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 pb-1.5">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="text-center text-xs font-medium text-muted-foreground"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-y-1">
          {days.map((day) => {
            const isCurrentMonth = isSameMonth(day, visibleMonth);
            const isRangeStart = value ? isSameDay(day, value.from) : false;
            const isRangeEnd = value?.to ? isSameDay(day, value.to) : false;
            const isInRange = value?.to
              ? isAfter(day, value.from) && isBefore(day, value.to)
              : false;
            const isSelected = isRangeStart || isRangeEnd;
            const isFuture = isAfter(day, today);

            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => {
                  if (!value || value.to) {
                    onChange({ from: day });
                    return;
                  }

                  const from = isBefore(day, value.from) ? day : value.from;
                  const to = isBefore(day, value.from) ? value.from : day;
                  onChange({ from, to });
                  setOpen(false);
                }}
                disabled={isFuture}
                className={cn(
                  "mx-auto flex size-7 items-center justify-center rounded-full text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-25",
                  !isCurrentMonth && "text-muted-foreground/35",
                  isToday(day) && !isSelected && "text-primary",
                  isInRange && "rounded-none bg-primary/15 text-primary",
                  isSelected && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                )}
                aria-pressed={isSelected}
                aria-disabled={isFuture}
                aria-label={format(day, "MMMM d, yyyy")}
              >
                {format(day, "d")}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
