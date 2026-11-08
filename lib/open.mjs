// Opens the page in the person's browser. A convenience: when it cannot, the
// address printed on the terminal still works.

import { spawn } from "node:child_process";

export function openBrowser(url) {
  const [cmd, args] =
    process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin" ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch { /* opening the browser is a convenience */ }
}
