import { Checkbox } from "@/components/ui/checkbox";

interface NotificationEventSelectorProps {
  selectedEvents: string[];
  onChange: (events: string[]) => void;
}

const EVENT_TYPES = [
  { id: "GRB", label: "Gamma-Ray Bursts (GRB)", desc: "Short and long duration gamma-ray flashes" },
  { id: "GW", label: "Gravitational Waves (GW)", desc: "Compact binary coalescences (LVK)" },
  { id: "FRB", label: "Fast Radio Bursts (FRB)", desc: "Millisecond-duration radio pulses" },
  { id: "Neutrinos", label: "Neutrinos", desc: "High-energy astrophysical neutrinos (IceCube)" },
  { id: "Einstein Probe", label: "Einstein Probe", desc: "Soft X-ray transients and flares" },
];

export function NotificationEventSelector({ selectedEvents, onChange }: NotificationEventSelectorProps) {
  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      onChange([...selectedEvents, id]);
    } else {
      onChange(selectedEvents.filter((e) => e !== id));
    }
  };

  return (
    <div className="space-y-3">
      {EVENT_TYPES.map((et) => (
        <div key={et.id} className="flex items-start space-x-3 rounded-md border border-transparent hover:bg-accent/30 p-2 -mx-2 transition-colors">
          <Checkbox
            id={`event-${et.id}`}
            checked={selectedEvents.includes(et.id)}
            onCheckedChange={(c: boolean | "indeterminate") => toggle(et.id, c === true)}
            className="mt-1"
          />
          <div className="space-y-1 leading-none">
            <label
              htmlFor={`event-${et.id}`}
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              {et.label}
            </label>
            <p className="text-xs text-muted-foreground">{et.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
