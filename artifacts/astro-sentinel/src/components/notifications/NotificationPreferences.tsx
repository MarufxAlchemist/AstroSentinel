import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/AuthContext";
import { NotificationChannelCard } from "./NotificationChannelCard";
import { NotificationEventSelector } from "./NotificationEventSelector";
import { NotificationPrioritySelector } from "./NotificationPrioritySelector";
import { NotificationBehaviour } from "./NotificationBehaviour";
import { NotificationObservatorySelector } from "./NotificationObservatorySelector";
import type { NotificationPreferences as NotificationPreferencesType } from "@workspace/api-zod";
import { Loader2, AlertTriangle } from "lucide-react";

export function NotificationPreferences() {
  const { toast } = useToast();
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const { data: prefs, isLoading, isError, refetch, isRefetching } = useQuery<NotificationPreferencesType>({
    queryKey: ["notificationPreferences", token],
    queryFn: async () => {
      if (!token) throw new Error("Not authenticated");
      const res = await fetch("/api/notifications/preferences", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to fetch preferences");
      return res.json();
    },
    enabled: !!token,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });

  const updateMutation = useMutation({
    mutationFn: async (newPrefs: NotificationPreferencesType) => {
      const res = await fetch("/api/notifications/preferences", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(newPrefs),
      });
      if (!res.ok) throw new Error("Failed to update preferences");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notificationPreferences"] });
      toast({
        title: "Preferences saved",
        description: "Your notification preferences have been updated.",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not save preferences. Please try again.",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notifications/preferences", { 
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to delete subscription");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notificationPreferences"] });
      toast({
        title: "Subscription deleted",
        description: "You will no longer receive alerts.",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not delete subscription.",
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notifications/preferences/toggle", { 
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to toggle subscription");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["notificationPreferences"] });
      toast({
        title: data.isActive ? "Subscription Started" : "Subscription Stopped",
        description: data.isActive 
          ? "You will now receive alerts in your email." 
          : "Alerts have been paused.",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not toggle subscription. Make sure you have saved preferences first.",
      });
    },
  });

  // Local state for the form
  const [formData, setFormData] = useState<NotificationPreferencesType | null>(null);

  useEffect(() => {
    if (prefs) setFormData(prefs);
  }, [prefs]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">Failed to load preferences.</p>
        <Button variant="outline" size="sm" disabled={isRefetching} onClick={() => refetch()}>
          {isRefetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Try again
        </Button>
      </div>
    );
  }

  if (!formData) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }


  const handleChannelToggle = (id: string, selected: boolean) => {
    if (selected) {
      setFormData({ ...formData, channels: [...formData.channels, id] });
    } else {
      setFormData({ ...formData, channels: formData.channels.filter((c) => c !== id) });
    }
  };

  return (
    <div className="space-y-8 pb-8">
      {/* 1. Research Email */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">1. Primary Contact</h3>
          <p className="text-xs text-muted-foreground">Where should we send alerts?</p>
        </div>
        <div className="max-w-md">
          <Input
            type="email"
            placeholder="researcher@university.edu"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="text-sm"
          />
        </div>
      </section>

      {/* 2. Channels */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">2. Notification Channels</h3>
          <p className="text-xs text-muted-foreground">Select how you want to be notified.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <NotificationChannelCard
            id="email"
            name="Email"
            description="Detailed HTML event reports"
            icon="mail"
            enabled={true}
            selected={formData.channels.includes("email")}
            onToggle={handleChannelToggle}
          />
          <NotificationChannelCard
            id="telegram"
            name="Telegram"
            description="Instant mobile push alerts"
            icon="telegram"
            enabled={true}
            comingSoon={true}
            selected={formData.channels.includes("telegram")}
            onToggle={handleChannelToggle}
          />
          <NotificationChannelCard
            id="discord"
            name="Discord"
            description="Post to a Discord channel"
            icon="discord"
            enabled={true}
            comingSoon={true}
            selected={formData.channels.includes("discord")}
            onToggle={handleChannelToggle}
          />
          <NotificationChannelCard
            id="webhook"
            name="Webhook"
            description="POST to your custom API"
            icon="webhook"
            enabled={true}
            comingSoon={true}
            selected={formData.channels.includes("webhook")}
            onToggle={handleChannelToggle}
          />
        </div>
      </section>

      {/* 3. Event Types */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">3. Target Event Types</h3>
          <p className="text-xs text-muted-foreground">Choose which astrophysical events trigger an alert.</p>
        </div>
        <NotificationEventSelector
          selectedEvents={formData.eventTypes}
          onChange={(events) => setFormData({ ...formData, eventTypes: events })}
        />
      </section>

      {/* 4. Priority Level */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">4. Priority Filter</h3>
          <p className="text-xs text-muted-foreground">Filter alerts by scientific significance.</p>
        </div>
        <NotificationPrioritySelector
          priorityLevel={formData.priorityLevel}
          onChange={(level) => setFormData({ ...formData, priorityLevel: level as any })}
        />
      </section>

      {/* 5. Observatories */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">5. Observatories</h3>
          <p className="text-xs text-muted-foreground">Listen only to specific instruments.</p>
        </div>
        <NotificationObservatorySelector
          selectedObservatories={formData.observatories}
          onChange={(observatories) => setFormData({ ...formData, observatories })}
        />
      </section>

      {/* 6. Behaviour */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">6. Notification Behaviour</h3>
          <p className="text-xs text-muted-foreground">Customize alert content and timing.</p>
        </div>
        <NotificationBehaviour
          behaviour={formData.behaviour}
          onChange={(behaviour) => setFormData({ ...formData, behaviour })}
        />
      </section>

      {/* Save Button */}
      <div className="pt-4 border-t border-border flex justify-end">
        <Button
          disabled={updateMutation.isPending}
          onClick={() => updateMutation.mutate(formData)}
        >
          {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Preferences
        </Button>
      </div>

      {/* 7. Danger Zone */}
      <section className="pt-8 border-t border-destructive/20 mt-8">
        <div>
          <h3 className="text-sm font-semibold text-destructive">Danger Zone</h3>
          <p className="text-xs text-muted-foreground mt-1 mb-4">Manage your subscription status or permanently delete it.</p>
          <div className="flex gap-4">
            <Button
              variant={formData.isActive ? "secondary" : "default"}
              disabled={toggleMutation.isPending}
              onClick={() => toggleMutation.mutate()}
            >
              {toggleMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {formData.isActive ? "Stop Subscription" : "Start Subscription"}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (confirm("Are you sure you want to delete your notification subscription?")) {
                  deleteMutation.mutate();
                }
              }}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Subscription
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
