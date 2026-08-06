import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";

interface NotificationPrioritySelectorProps {
  priorityLevel: string;
  onChange: (level: string) => void;
}

const PRIORITIES = [
  {
    id: "critical_only",
    label: "Critical Only",
    desc: "Alerts with extremely high confidence or unique correlations.",
    icon: AlertCircle,
    color: "text-red-500",
  },
  {
    id: "critical_and_high",
    label: "Critical + High",
    desc: "Includes high SNR events and probable multi-messenger candidates.",
    icon: AlertTriangle,
    color: "text-amber-500",
  },
  {
    id: "all",
    label: "All Scientific Alerts",
    desc: "Every validated event detection across all observatories.",
    icon: Info,
    color: "text-blue-500",
  },
];

export function NotificationPrioritySelector({ priorityLevel, onChange }: NotificationPrioritySelectorProps) {
  return (
    <RadioGroup value={priorityLevel} onValueChange={onChange} className="space-y-3">
      {PRIORITIES.map((p) => {
        const Icon = p.icon;
        return (
          <div key={p.id} className="flex items-start space-x-3 rounded-md border border-transparent hover:bg-accent/30 p-2 -mx-2 transition-colors">
            <RadioGroupItem value={p.id} id={`priority-${p.id}`} className="mt-1" />
            <div className="space-y-1 leading-none">
              <label
                htmlFor={`priority-${p.id}`}
                className="flex items-center gap-2 text-sm font-medium leading-none cursor-pointer"
              >
                <Icon className={`w-3.5 h-3.5 ${p.color}`} />
                {p.label}
              </label>
              <p className="text-xs text-muted-foreground">{p.desc}</p>
            </div>
          </div>
        );
      })}
    </RadioGroup>
  );
}
