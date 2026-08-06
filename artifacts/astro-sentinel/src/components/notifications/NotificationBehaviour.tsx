import { Checkbox } from "@/components/ui/checkbox";

interface BehaviourState {
  aiSummary: boolean;
  correlation: boolean;
  localization: boolean;
  digest: boolean;
  instant: boolean;
}

interface NotificationBehaviourProps {
  behaviour: BehaviourState;
  onChange: (b: BehaviourState) => void;
}

const BEHAVIOURS = [
  { id: "aiSummary" as const, label: "Receive AI Scientific Summary", desc: "Include GPT-4 generated event analysis" },
  { id: "correlation" as const, label: "Receive Correlation Alerts", desc: "Notify if a multi-messenger correlation is detected" },
  { id: "localization" as const, label: "Receive Localization Updates", desc: "Send follow-up alerts when sky maps are updated" },
  { id: "digest" as const, label: "Receive Daily Digest", desc: "Get a daily summary email of all events" },
  { id: "instant" as const, label: "Instant Notifications", desc: "Send alerts immediately upon detection" },
];

export function NotificationBehaviour({ behaviour, onChange }: NotificationBehaviourProps) {
  const toggle = (id: keyof BehaviourState, checked: boolean) => {
    onChange({
      ...behaviour,
      [id]: checked,
    });
  };

  return (
    <div className="space-y-3">
      {BEHAVIOURS.map((b) => (
        <div key={b.id} className="flex items-start space-x-3 rounded-md border border-transparent hover:bg-accent/30 p-2 -mx-2 transition-colors">
          <Checkbox
            id={`behaviour-${b.id}`}
            checked={behaviour[b.id]}
            onCheckedChange={(c: boolean | "indeterminate") => toggle(b.id, c === true)}
            className="mt-1"
          />
          <div className="space-y-1 leading-none">
            <label
              htmlFor={`behaviour-${b.id}`}
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              {b.label}
            </label>
            <p className="text-xs text-muted-foreground">{b.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
