import { spawn } from "node:child_process";

export function openInDefaultApp(filePath: string): void {
  try {
    const { platform } = process;
    const cmd =
      platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
    const args = platform === "win32" ? ["/c", "start", "", filePath] : [filePath];
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", (err) => {
      console.error(`[open-file] failed to open ${filePath}: ${err.message}`);
    });
    child.unref();
  } catch (err) {
    console.error(
      `[open-file] failed to open ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
