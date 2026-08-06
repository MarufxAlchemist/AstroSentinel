import { Check, Mail, MessageSquare, Webhook, MonitorSmartphone, X } from "lucide-react";

interface NotificationChannelCardProps {
  id: string;
  name: string;
  description: string;
  icon: "mail" | "telegram" | "discord" | "slack" | "teams" | "webhook";
  enabled: boolean;
  comingSoon?: boolean;
  selected?: boolean;
  onToggle?: (id: string, selected: boolean) => void;
}

const icons = {
  mail: Mail,
  telegram: MessageSquare,
  discord: MessageSquare,
  slack: MessageSquare,
  teams: MonitorSmartphone,
  webhook: Webhook,
};

export function NotificationChannelCard({
  id,
  name,
  description,
  icon,
  enabled,
  comingSoon,
  selected,
  onToggle,
}: NotificationChannelCardProps) {
  const Icon = icons[icon] || Mail;

  return (
    <div
      className={`relative flex items-start gap-4 rounded-lg border p-4 transition-colors ${
        !enabled || comingSoon
          ? "opacity-60 bg-muted/30 cursor-not-allowed border-border"
          : selected
          ? "border-primary bg-primary/5 cursor-pointer hover:bg-primary/10"
          : "border-border cursor-pointer hover:border-primary/50 hover:bg-accent/50"
      }`}
      onClick={() => {
        if (enabled && !comingSoon && onToggle) {
          onToggle(id, !selected);
        }
      }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background border border-border">
        <Icon className={`h-5 w-5 ${selected && !comingSoon ? "text-primary" : "text-muted-foreground"}`} />
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium leading-none">{name}</h4>
          {comingSoon && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-muted-foreground border border-border">
              Coming Soon
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {selected && !comingSoon && (
        <div className="absolute right-4 top-4 text-primary">
          <Check className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
