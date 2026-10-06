"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthButton } from "@/components/auth/AuthButton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { useAppSettings, type ThemeChoice, type ChatFontSize } from "@/hooks/useAppSettings";
import { getRoomHistory, clearRoomHistory } from "@/lib/rooms/history";

const REGION_OPTIONS: { code: string; label: string }[] = [
  { code: "", label: "Auto (from locale)" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "IN", label: "India" },
  { code: "NG", label: "Nigeria" },
  { code: "KE", label: "Kenya" },
  { code: "ZA", label: "South Africa" },
  { code: "BR", label: "Brazil" },
  { code: "JP", label: "Japan" },
];

const NICKNAME_KEY = "syncme_nickname";

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
        className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-none transition-all ${
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

function SelectControl({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: { code: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="min-h-11 max-w-44 cursor-pointer truncate rounded-lg border border-input bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
    >
      {options.map((o) => (
        <option key={o.code || "auto"} value={o.code}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function SettingsPage() {
  const { settings, loaded, update, reset } = useAppSettings();
  const [bugName, setBugName] = useState("");
  const [bugTitle, setBugTitle] = useState("");
  const [bugDesc, setBugDesc] = useState("");
  const [bugBusy, setBugBusy] = useState(false);
  const [showBugForm, setShowBugForm] = useState(false);
  const [nickname, setNickname] = useState("");
  const [nicknameSaved, setNicknameSaved] = useState<string | null>(null);

  // Profile nickname lives under the same key the room join gate reads,
  // so a name saved here is already filled in when joining rooms.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(NICKNAME_KEY);
      setNickname(saved || "");
      setNicknameSaved(saved || null);
    } catch {
      // storage blocked
    }
  }, [loaded]);

  const handleSaveNickname = () => {
    const clean = nickname.trim().slice(0, 24);
    if (!clean) {
      toast.error("Enter a nickname first.");
      return;
    }
    try {
      window.localStorage.setItem(NICKNAME_KEY, clean);
    } catch {
      toast.error("Could not save on this browser.");
      return;
    }
    setNicknameSaved(clean);
    toast.success(`Nickname saved — you'll join rooms as “${clean}”.`);
  };

  const handleExportData = () => {
    try {
      const payload = {
        exportedAt: new Date().toISOString(),
        settings,
        rooms: getRoomHistory(),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "peermates-data.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success("Your PeerMates data was downloaded.");
    } catch {
      toast.error("Export failed on this browser.");
    }
  };

  const handleClearHistory = () => {
    clearRoomHistory();
    toast.success("Room history cleared.");
  };

  const handleClearAllData = () => {
    try {
      const doomed: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && (k.startsWith("peermates:") || k.startsWith("syncme"))) {
          doomed.push(k);
        }
      }
      doomed.forEach((k) => window.localStorage.removeItem(k));
    } catch {
      // continue to defaults reset
    }
    reset();
    toast.success("All local PeerMates data cleared — reloading with defaults.");
    setTimeout(() => window.location.reload(), 800);
  };

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
                              ? "bg-background text-foreground shadow-none"
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
                <SettingRow
                  title="Reduce motion"
                  desc="Minimize animations and transitions across the app. Off by default."
                  control={
                    <Toggle
                      checked={settings.reduceMotion}
                      onChange={(v) => update({ reduceMotion: v })}
                      label="Reduce motion"
                    />
                  }
                />
              </div>
            </Card>

            {/* Profile */}
            <Card className="px-4 sm:px-5 pb-4">
              <h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Profile
              </h2>
              <p className="py-2 text-xs leading-relaxed text-muted-foreground">
                The name guests see. Saved on this device and pre-filled at
                every room join — no signup needed.
                {nicknameSaved ? (
                  <> Currently joining as <strong className="text-foreground">“{nicknameSaved}”</strong>.</>
                ) : null}
              </p>
              <div className="flex gap-2">
                <Input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="e.g. MovieFan"
                  maxLength={24}
                  aria-label="Default nickname"
                  className="h-11 flex-1"
                />
                <Button onClick={handleSaveNickname} className="min-h-11 shrink-0">
                  Save name
                </Button>
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
                <SettingRow
                  title="Audio-only default"
                  desc="Start rooms with video hidden and audio playing (saves screen and battery). Off by default."
                  control={
                    <Toggle
                      checked={settings.audioOnlyDefault}
                      onChange={(v) => update({ audioOnlyDefault: v })}
                      label="Audio-only default"
                    />
                  }
                />
                <SettingRow
                  title="Presence avatars"
                  desc="Show profile pictures in the Watching list. Turn off for a text-only list."
                  control={
                    <Toggle
                      checked={settings.showAvatars}
                      onChange={(v) => update({ showAvatars: v })}
                      label="Show presence avatars"
                    />
                  }
                />
                <SettingRow
                  title="Data cost region"
                  desc="Which country's mobile-data prices estimate your session cost. Auto uses your locale."
                  control={
                    <SelectControl
                      value={settings.priceRegion}
                      onChange={(v) => update({ priceRegion: v })}
                      label="Data cost region"
                      options={REGION_OPTIONS}
                    />
                  }
                />
              </div>
            </Card>

            {/* Chat */}
            <Card className="px-4 sm:px-5">
              <h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Chat
              </h2>
              <div className="divide-y divide-border">
                <SettingRow
                  title="Typing indicators"
                  desc="Show “X is typing…” bubbles while others type."
                  control={
                    <Toggle
                      checked={settings.typingIndicators}
                      onChange={(v) => update({ typingIndicators: v })}
                      label="Show typing indicators"
                    />
                  }
                />
                <SettingRow
                  title="Message sounds"
                  desc="Play a soft chime when a new message arrives from someone else. Off by default."
                  control={
                    <Toggle
                      checked={settings.messageSounds}
                      onChange={(v) => update({ messageSounds: v })}
                      label="Play message sounds"
                    />
                  }
                />
                <SettingRow
                  title="Message text size"
                  desc="How large chat messages render on every device you use."
                  control={
                    <SelectControl
                      value={settings.chatFontSize}
                      onChange={(v) => update({ chatFontSize: v as ChatFontSize })}
                      label="Message text size"
                      options={[
                        { code: "s", label: "Small" },
                        { code: "m", label: "Medium" },
                        { code: "l", label: "Large" },
                      ]}
                    />
                  }
                />
              </div>
            </Card>

            {/* Privacy & data */}
            <Card className="px-4 sm:px-5">
              <h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Privacy & data
              </h2>
              <div className="divide-y divide-border">
                <SettingRow
                  title="Confirm before leaving"
                  desc="Ask “are you sure?” before you leave a room, so hosts never exit by accident. Off by default."
                  control={
                    <Toggle
                      checked={settings.confirmBeforeLeave}
                      onChange={(v) => update({ confirmBeforeLeave: v })}
                      label="Confirm before leaving rooms"
                    />
                  }
                />
              </div>
              <div className="flex flex-wrap gap-2 py-4">
                <Button onClick={handleExportData} variant="outline" className="min-h-11 text-xs">
                  Export my data (JSON)
                </Button>
                <Button onClick={handleClearHistory} variant="outline" className="min-h-11 text-xs">
                  Clear room history
                </Button>
                <Button onClick={handleClearAllData} variant="outline" className="min-h-11 text-xs">
                  Clear all local data
                </Button>
              </div>
              <p className="pb-4 text-[11px] leading-relaxed text-muted-foreground">
                Rooms, settings, nickname, and playback positions live only in
                this browser — nothing to download an account for, nothing sent
                to a server.
              </p>
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
