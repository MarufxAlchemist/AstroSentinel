import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NotificationPreferences } from "./NotificationPreferences";
import { BellRing } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ReactNode, useState } from "react";

export function NotificationCenter({ trigger }: { trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger || (
          <button className="p-1.5 rounded hover:bg-accent hover:text-foreground text-muted-foreground transition-colors" title="Notification Center">
            <BellRing className="w-3.5 h-3.5" />
          </button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md lg:max-w-lg flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b border-border bg-muted/20 shrink-0">
          <SheetTitle className="text-lg">Research Notification Center</SheetTitle>
          <SheetDescription>
            Manage your real-time astrophysical alert subscriptions.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1 px-6 py-6">
          <NotificationPreferences />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
