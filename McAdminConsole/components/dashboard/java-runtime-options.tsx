import { JavaRuntime } from "@/lib/mc-server/java";

const optionClass = "bg-zinc-950 text-zinc-200";

/** `<option>` list for Java runtime selects: host runtimes plus official auto-download runtimes. */
export function JavaRuntimeOptions({ runtimes }: { runtimes: JavaRuntime[] }) {
  const host = runtimes.filter((r) => !r.managed);
  const managed = runtimes.filter((r) => r.managed);

  return (
    <>
      {host.length > 0 && (
        <optgroup label="Detected on host" className={optionClass}>
          {host.map((r) => (
            <option key={r.id} value={r.id} className={optionClass}>
              {r.name} {r.is_default ? "★ (Default)" : ""} {!r.is_valid ? "⚠ (Unverified)" : ""}
            </option>
          ))}
        </optgroup>
      )}
      {host.length === 0 && (
        <option value="" className={optionClass}>
          System Default (java in PATH)
        </option>
      )}
      {managed.length > 0 && (
        <optgroup label="Official Eclipse Temurin (auto-download)" className={optionClass}>
          {managed.map((r) => (
            <option key={r.id} value={r.id} className={optionClass}>
              {r.name}{" "}
              {r.id === "temurin-auto"
                ? "(downloads if needed)"
                : r.installed
                  ? `✓ installed${r.version_detected ? ` (${r.version_detected})` : ""}`
                  : "⬇ downloads on first start"}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}
