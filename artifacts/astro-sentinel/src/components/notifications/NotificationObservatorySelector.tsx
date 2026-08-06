import { Checkbox } from "@/components/ui/checkbox";

interface NotificationObservatorySelectorProps {
  selectedObservatories: string[];
  onChange: (observatories: string[]) => void;
}

const OBSERVATORIES = [
  "Swift BAT",
  "Fermi GBM",
  "Einstein Probe",
  "LIGO/Virgo/KAGRA",
  "IceCube",
  "CHIME"
];

export function NotificationObservatorySelector({ selectedObservatories, onChange }: NotificationObservatorySelectorProps) {
  const toggle = (obs: string, checked: boolean) => {
    if (checked) {
      onChange([...selectedObservatories, obs]);
    } else {
      onChange(selectedObservatories.filter((o) => o !== obs));
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      {OBSERVATORIES.map((obs) => (
        <div key={obs} className="flex items-center space-x-2">
          <Checkbox
            id={`obs-${obs}`}
            checked={selectedObservatories.includes(obs)}
            onCheckedChange={(c: boolean | "indeterminate") => toggle(obs, c === true)}
          />
          <label
            htmlFor={`obs-${obs}`}
            className="text-sm font-medium leading-none cursor-pointer"
          >
            {obs}
          </label>
        </div>
      ))}
    </div>
  );
}
