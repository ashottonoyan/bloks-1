// Where a new agent starts: a folder, a model and an effort, applied
// before its first turn, because a chat's folder is pinned on that turn
// and cannot be moved after it.
//
// Set by the person only. Agents cannot read or write /api/config, so an
// agent that hires another cannot hand it more than the person chose
// here. The server checks each value again at hire time; this card only
// shows what it refused.
//
// A server that does not report agentDefaults does not have the feature,
// and the card is not drawn at all rather than offering a form that
// saves nowhere.
import { useEffect, useRef, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import { api, useStore, type AgentDefaults as Defaults } from "@/state/store";
import { ModelPicker } from "./ModelPicker";
import { BrowseFolderButton } from "@/components/ui/browse-folder";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

const EFFORTS = [
  [undefined, "Default"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
] as const;

export function AgentDefaults() {
  const { state, dispatch } = useStore();
  const saved = state.config?.agentDefaults;
  const [folder, setFolder] = useState(saved?.cwd ?? "");
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const hydrated = useRef(false);

  // adopt the server value once it arrives, without stomping an edit
  useEffect(() => {
    if (hydrated.current || !saved) return;
    hydrated.current = true;
    setFolder(saved.cwd ?? "");
  }, [saved]);

  if (!saved) return null;

  /** The whole object every time: the server replaces the section, so
   * an unset key is one left out, not one sent empty. */
  const save = (patch: Partial<Defaults>) => {
    const next: Defaults = { ...saved, ...patch };
    for (const key of Object.keys(next) as Array<keyof Defaults>) {
      if (next[key] === undefined || next[key] === null || next[key] === "") delete next[key];
    }
    setError(null);
    api("/api/config", { method: "PUT", body: JSON.stringify({ agentDefaults: next }) })
      .then((status) => {
        dispatch({ type: "configStatus", config: status });
        setFolder(status?.agentDefaults?.cwd ?? "");
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1600);
      })
      .catch((e: Error) => setError(e.message));
  };

  const saveFolder = (value: string) => save({ cwd: value.trim() || undefined });
  const anySet = Boolean(saved.cwd || saved.modelSelection || saved.effort);

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[13.5px] font-semibold text-foreground">New agents</div>
        {justSaved ? (
          <span className="flex items-center gap-1 text-[11.5px] text-success">
            <Check size={12} /> Saved
          </span>
        ) : (
          anySet && (
            <button
              onClick={() => save({ cwd: undefined, modelSelection: undefined, effort: undefined })}
              className="text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear all
            </button>
          )
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
        Where every agent you or your agents hire starts. Existing agents keep their own settings.
        <InfoTip text="Applied the moment an agent is made, so its first chat already runs in the folder. Only you can change these; agents cannot. Team hires keep the lighter model the team chose and take the rest." />
      </div>

      <div className="mt-3.5 text-[12.5px] font-medium text-foreground">Working folder</div>
      <div className="mt-1.5 flex gap-2">
        <Input
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveFolder(folder)}
          placeholder="Their own workspace"
          spellCheck={false}
          className="h-8 font-mono text-[12px]"
        />
        <BrowseFolderButton
          onPick={(path) => {
            setFolder(path);
            saveFolder(path);
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={folder.trim() === (saved.cwd ?? "")}
          onClick={() => saveFolder(folder)}
        >
          Save
        </Button>
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-4">
        <div className="text-[12.5px] font-medium text-foreground">Model</div>
        <ModelPicker
          value={saved.modelSelection ?? null}
          onPick={(selection) => save({ modelSelection: selection ?? undefined })}
          noneLabel="Engine default"
        />
      </div>

      <div className="mt-3 text-[12.5px] font-medium text-foreground">Reasoning effort</div>
      <div className="mt-1.5 flex gap-1 rounded-xl bg-muted p-1">
        {EFFORTS.map(([level, label]) => (
          <button
            key={label}
            onClick={() => save({ effort: level })}
            className={cn(
              "flex-1 rounded-lg py-1 text-[12.5px] transition-colors duration-150",
              saved.effort === level
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="mt-2 text-[12px] text-destructive">{error}</div>}
    </div>
  );
}
