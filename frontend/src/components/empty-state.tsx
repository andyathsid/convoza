import Logo from "./logo";

interface EmptyStateProps {
  title?: string;
  description?: string;
}

export default function EmptyState({
  title = "No chat selected",
  description = "Pick a chat or start a new one...",
}: EmptyStateProps) {
  return (
    <div className="w-full h-full flex-1 flex items-center justify-center bg-muted/20">
      <div className="flex flex-col items-center gap-4">
        <Logo showText={false} className="opacity-50" />
        <div className="text-center">
          <h3 className="font-semibold text-lg">{title}</h3>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
      </div>
    </div>
  );
}
