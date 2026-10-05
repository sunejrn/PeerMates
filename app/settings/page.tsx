"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthButton } from "@/components/auth/AuthButton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { useAppSettings, type ThemeChoice } from "@/hooks/useAppSettings";

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors cursor-pointer ${
        checked ? "bg-violet-600" : "bg-muted"
      } border border-border`}
    >
      <span
        className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow transition-all ${
          checked ? "left-[1.4rem]" : "left-1"
        }`}
      />
    </button>
  );
}

function SettingRow({
  title,
  desc,
  control,
}: {
  title: string;
  desc: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { settings, loaded, update, reset } = useAppSettings();
  const [bugName, setBugName] = useState("");
  const [bugTitle, setBugTitle] = useState("");
  const [bugDesc, setBugDesc] = useState("");
  const [bugBusy, setBugBusy] = useState(false);
  const [showBugForm, setShowBugForm] = useState(false);

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bugBusy) return;
    setBugBusy(true);
    try {
      const res = await fetch("/api/report-bug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bugName, title: bugTitle, description: bugDesc }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not send the report.");
      toast.success("Bug report sent — thank you!");
      setBugName("");
      setBugTitle("");
      setBugDesc("");
      setShowBugForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the report.");
    } finally {
      setBugBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b border-border/80 bg-background/80 px-4 sm:px-6 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link href="/" className="text-lg font-bold tracking-tight">
            PeerMates
          </Link>
          <nav className="flex items-center gap-1 text-sm" aria-label="Primary">
            <Link
              href="/rooms"
              className="rounded-lg px-3 min-h-11 flex items-center text-muted-foreground hover:text-foreground"
            >
              All Rooms
            </Link>
            <Link
              href="/settings"
              aria-current="page"
              className="rounded-lg bg-muted px-3 min-h-11 flex items-center font-medium"
            >
              Settings
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <AuthButton />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 sm:px-6 py-8">
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Saved on this device instantly. Defaults are ON unless noted.
          </p>
        </div>

        {!loaded ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Spinner className="shrink-0" /> Loading settings…
          </div>
        ) : (
          <div className="space-y-6">
            {/* General */}
            <Card className="px-4 sm:px-5">
              <h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                General
              </h2>
              <div className="divide-y divide-border">
                <SettingRow
                  title="Notifications"
                  desc="Toast alerts for file transfers, promotions, and room events."
                  control={
                    <Toggle
                      checked={settings.notifications}
                      onChange={(v) => update({ notifications: v })}
                      label="Enable notifications"
                    />
                  }
                />
                <SettingRow
                  title="Appearance"
                  desc="Follow your system, or force light / dark."
                  control={
                    <div className="flex rounded-lg border border-border bg-muted p-1" role="radiogroup" aria-label="Appearance">
                      {(["system", "light", "dark"] as ThemeChoice[]).map((t) => (
                        <button
                          key={t}
                          type="button"
                          role="radio"
                          aria-checked={settings.theme === t}
                          onClick={() => update({ theme: t })}
                          className={`min-h-9 rounded-lg px-3 text-xs font-medium capitalize cursor-pointer ${
                            settings.theme === t
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  }
                />
                <SettingRow
                  title="Delete my rooms automatically"
                  desc="When ON, rooms vanish from All Rooms 30 days after your last visit. When OFF, they stay until you delete them."
                  control={
                    <Toggle
                      checked={settings.autoDeleteRooms}
                      onChange={(v) => update({ autoDeleteRooms: v })}
                      label="Delete rooms automatically after 30 days"
                    />
                  }
                />
              </div>
            </Card>

            {/* Watch party */}
            <Card className="px-4 sm:px-5">
              <h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Watch party
              </h2>
              <div className="divide-y divide-border">
                <SettingRow
                  title="Live chat"
                  desc="When OFF, the Live Chat tab shows “Host disabled live chat on this room.” instead of messages."
                  control={
                    <Toggle
                      checked={settings.liveChatEnabled}
                      onChange={(v) => update({ liveChatEnabled: v })}
                      label="Enable live chat"
                    />
                  }
                />
                <SettingRow
                  title="Autoplay on join"
                  desc="Try to start playback automatically when you join (browsers may still require one tap)."
                  control={
                    <Toggle
                      checked={settings.autoplayDefault}
                      onChange={(v) => update({ autoplayDefault: v })}
                      label="Autoplay on join"
                    />
                  }
                />
                <SettingRow
                  title="Low-Data Mode default"
                  desc="Start new rooms with Data Saver already on (lowest HLS quality, hidden avatars)."
                  control={
                    <Toggle
                      checked={settings.dataSaverDefault}
                      onChange={(v) => update({ dataSaverDefault: v })}
                      label="Low-Data Mode default"
                    />
                  }
                />
              </div>
            </Card>

            {/* Report a bug */}
            <Card className="px-4 sm:px-5 pb-4">
              <h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Report a bug
              </h2>
              <p className="py-2 text-xs leading-relaxed text-muted-foreground">
                Found something broken? Tell the owner — your report is emailed
                directly to the team.
              </p>
              {!showBugForm ? (
                <Button onClick={() => setShowBugForm(true)} variant="outline" className="min-h-11">
                  Report a bug
                </Button>
              ) : (
                <form onSubmit={handleReport} className="space-y-3 py-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="bug-name">
                      Your name
                    </label>
                    <Input
                      id="bug-name"
                      value={bugName}
                      onChange={(e) => setBugName(e.target.value)}
                      placeholder="e.g. Ada"
                      className="h-11"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="bug-title">
                      Bug title
                    </label>
                    <Input
                      id="bug-title"
                      value={bugTitle}
                      onChange={(e) => setBugTitle(e.target.value)}
                      placeholder="e.g. MP4 never plays on my phone"
                      className="h-11"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="bug-desc">
                      Description
                    </label>
                    <textarea
                      id="bug-desc"
                      value={bugDesc}
                      onChange={(e) => setBugDesc(e.target.value)}
                      placeholder="What happened, what did you expect, steps to reproduce…"
                      rows={4}
                      required
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={bugBusy} className="min-h-11 flex-1">
                      {bugBusy ? (
                        <span className="flex items-center gap-2">
                          <Spinner /> Sending…
                        </span>
                      ) : (
                        "Send report"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowBugForm(false)}
                      className="min-h-11"
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </Card>

            <div className="flex justify-end">
              <Button variant="outline" onClick={reset} className="min-h-11 text-xs">
                Reset to defaults
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
