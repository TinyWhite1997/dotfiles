export const LABELS = {
  id: "herdr.pi.session_id",
  path: "herdr.pi.session_path",
  cwd: "herdr.pi.session_cwd",
};

export function restoreCandidates(all) {
  const running = new Set(all
    .filter((terminal) => terminal.state === "live" && terminal.report?.app === "pi")
    .map((terminal) => terminal.labels?.[LABELS.path])
    .filter(Boolean));

  return all.filter((terminal) => {
    const path = terminal.labels?.[LABELS.path];
    return terminal.state === "live"
      && !terminal.address.includes("/")
      && Boolean(path)
      && terminal.report?.app !== "pi"
      && !running.has(path);
  });
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function resumeCommand(terminal) {
  const path = terminal.labels[LABELS.path];
  const cwd = terminal.labels[LABELS.cwd];
  return `${cwd ? `cd ${quote(cwd)}; ` : ""}pi --session ${quote(path)}`;
}
