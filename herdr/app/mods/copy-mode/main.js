// Copy mode: a cursor over the terminal's buffer (screen + history), vim-ish
// motions, / search, s+jump labels, a charwise/linewise selection, and yank
// to the system clipboard. The buffer is a snapshot taken when the mode opens.
//
// Motions: h j k l arrows, w e b W E B, 0 $, g G, { }, ctrl+d ctrl+u, PgUp PgDn
// Search:  /type Enter, n N
// Jump:    s, then type characters to narrow; matches in the visible window
//          get a lowercase label drawn right after them (press it to jump);
//          a label never reuses the character that follows a match, so typing
//          on to refine never jumps by accident. A single match jumps at once;
//          Backspace edits, Esc cancels.
// Select:  v (chars), V (lines); y or Enter copies; Esc clears/leaves; q quits.

import * as fs from "fs/promises";
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { appHome, closeOverlay, exec, focused, hc, nextCommand, notify, panes, props, setShared, settings, shared, theme } from "herdr";
const R = () => { const r = settings().radius; return typeof r === "number" ? r : 0; };

const HISTORY = 2000;
const LINE_H = 18;
const HEAD_H = 26;
const FOOT_H = 22;
const PAD = 8;
const LABELS = "asdfghjklqwertyuiopzxcvbnm";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// A "word" is a run of letters, digits, underscore or CJK (like vim's w).
const isWord = (ch) => Boolean(ch) && (/[\p{L}\p{N}_]/u.test(ch) || ch.codePointAt(0) > 0x2e80);
const isSpace = (ch) => ch === " " || ch === "\t";

export default class CopyMode extends View {
  // Defaults for every field render touches: a hot reload can render before
  // init has finished, and that must not break the view.
  lines = [];
  glyphs = [];
  r = 0;
  c = 0;
  top = 0;
  anchor = null;
  linewise = false;
  height = 0;
  status = "loading…";
  typing = false;
  query = "";
  lastQuery = "";
  matches = [];
  matchRows = new Map();
  jump = null;
  target = null;
  searchInput = null;

  init(_props, cx) {
    this.handle = cx.focus_handle();
    // Only an overlay copy takes the keyboard; publish it so pane mods leave it
    // alone for as long as this window is up. The stamp lets this copy clear
    // only its own mark.
    if (props()?.overlay) setShared("keys.capturing", (this.capture = { state: "copy-mode", ts: Date.now() }));
    this.searchInput = InputState.new({ placeholder: "search…" });
    this.searchInput.on("change", (_e, cx) => {
      this.query = this.searchInput.value();
      this.computeMatches();
      cx.notify();
    });
    this.searchInput.on("submit", (_e, cx) => this.commitSearch(cx));
    // Esc arrives as a binding while the search Input holds focus (it would
    // otherwise swallow it); the same action backs the raw key path.
    cx.spawn(async (cx) => {
      for (;;) {
        await nextCommand();
        this.escape(cx);
      }
    });
    this.lines = [];
    this.glyphs = [];
    this.r = 0;
    this.c = 0;
    this.top = 0;
    this.anchor = null;
    this.linewise = false;
    this.height = 0;
    this.status = "loading…";
    this.typing = false;
    this.query = "";
    this.lastQuery = "";
    this.matches = [];
    this.matchRows = new Map();
    this.jump = null;
    // A window holds the keyboard when it opens, so a reload sees no focused
    // pane; the last target keeps the buffer readable across reloads.
    const f = focused();
    this.target = f?.terminal ?? panes().find((p) => p.focused)?.terminal ?? shared("copy-mode.target") ?? null;
    if (this.target) setShared("copy-mode.target", this.target);
    if (!this.target) {
      this.status = "No focused terminal";
    } else {
      cx.spawn(async (cx) => {
        const out = await hc(["read", this.target, "--lines", String(HISTORY)]);
        if (out.code !== 0) {
          this.status = (out.stderr || "read failed").trim();
          cx.notify();
          return;
        }
        const raw = String(out.stdout ?? "").replace(/\r/g, "").split("\n");
        while (raw.length > 1 && raw[raw.length - 1].trim() === "") raw.pop();
        this.lines = raw;
        this.glyphs = raw.map((line) => Array.from(line));
        this.r = Math.max(0, raw.length - 1);
        this.c = 0;
        this.top = this.r;
        this.status = null;
        this.ensureVisible();
        cx.notify();
      });
    }
  }

  close() {
    this.closed = true;
    const overlay = props()?.overlay;
    if (overlay) {
      closeOverlay(overlay);
      if (this.capture && shared("keys.capturing")?.ts === this.capture.ts) setShared("keys.capturing", null);
    }
  }

  visible() {
    const h = this.height || 640;
    return Math.max(1, Math.floor((h - HEAD_H - FOOT_H - PAD * 2) / LINE_H));
  }

  ensureVisible() {
    const rows = this.visible();
    if (this.r < this.top) this.top = this.r;
    else if (this.r >= this.top + rows) this.top = this.r - rows + 1;
    this.top = clamp(this.top, 0, Math.max(0, this.lines.length - rows));
  }

  setPos(r, c) {
    if (!this.lines.length) return;
    this.r = clamp(r, 0, this.lines.length - 1);
    this.c = clamp(c, 0, Math.max(0, this.lineLen(this.r) - 1));
    this.ensureVisible();
  }

  sel() {
    if (!this.anchor) return null;
    const a = this.anchor;
    const c = { r: this.r, c: this.c };
    return a.r < c.r || (a.r === c.r && a.c <= c.c) ? { a, c } : { a: c, c: a };
  }

  lineLen(i) {
    return (this.glyphs[i] ?? []).length;
  }

  // Selected glyph range of row i, inclusive [start, end]; null when outside.
  rangeFor(i, sel) {
    if (!sel) return null;
    const { a, c } = sel;
    if (this.linewise) return i >= a.r && i <= c.r ? [0, this.lineLen(i) - 1] : null;
    if (i < a.r || i > c.r) return null;
    const len = this.lineLen(i);
    const start = i === a.r ? Math.min(a.c, Math.max(0, len - 1)) : 0;
    const end = i === c.r ? Math.min(c.c, Math.max(0, len - 1)) : len - 1;
    return [start, end];
  }

  text() {
    const sel = this.sel();
    if (!sel) return this.lines[this.r] ?? "";
    if (this.linewise) return this.lines.slice(sel.a.r, sel.c.r + 1).join("\n");
    const out = [];
    for (let i = sel.a.r; i <= sel.c.r; i++) {
      const g = this.glyphs[i] ?? [];
      const start = i === sel.a.r ? Math.min(sel.a.c, g.length) : 0;
      const end = i === sel.c.r ? Math.min(sel.c.c + 1, g.length) : g.length;
      out.push(g.slice(start, end).join(""));
    }
    return out.join("\n");
  }

  async yank(cx) {
    const text = this.text();
    const path = `${appHome()}/copy-mode-${Date.now()}.txt`;
    try {
      await fs.writeFile(path, text, "utf8");
      const quoted = path.replace(/'/g, "''");
      const out = await exec("powershell", ["-NoProfile", "-Command", `Set-Clipboard -Value ([IO.File]::ReadAllText('${quoted}'))`]);
      if (out?.code !== 0) throw new Error((out?.stderr || "powershell failed").trim());
      notify({ title: "Copied", body: `${text.split("\n").length} line(s)`, level: "info" });
      this.close();
    } catch (err) {
      this.status = String(err?.message ?? err);
      notify({ title: "Copy failed", body: this.status, level: "error" });
      cx.notify();
    } finally {
      // A failed clipboard write must not leave a copy of the buffer in the
      // config folder (it would show up as an untracked file there).
      await fs.unlink(path).catch(() => {});
    }
  }

  // --- motions -------------------------------------------------------------

  // Generic word motion with a predicate; dir +1 moves forward, -1 backward.
  wordMotion(forward, stop, pred) {
    const n = this.lines.length;
    if (!n) return;
    const g = (i) => this.glyphs[i] ?? [];
    let r = this.r;
    let c = this.c;
    if (forward) {
      c++;
      for (;;) {
        const line = g(r);
        if (stop === "end") {
          while (c < line.length && !pred(line[c])) c++;
          if (c < line.length) { while (c + 1 < line.length && pred(line[c + 1])) c++; return this.setPos(r, c); }
        } else {
          if (pred(line[c])) { while (c < line.length && pred(line[c])) c++; }
          while (c < line.length && !pred(line[c])) c++;
          if (c < line.length) return this.setPos(r, c);
        }
        r++;
        if (r >= n) return this.setPos(n - 1, Math.max(0, this.lineLen(n - 1) - 1));
        c = 0;
      }
    } else {
      c--;
      for (;;) {
        if (c < 0) {
          r--;
          if (r < 0) return this.setPos(0, 0);
          c = Math.max(0, this.lineLen(r) - 1);
        }
        const line = g(r);
        while (c >= 0 && !pred(line[c])) c--;
        if (c >= 0) {
          while (c - 1 >= 0 && pred(line[c - 1])) c--;
          return this.setPos(r, c);
        }
        c = -1;
      }
    }
  }

  paragraph(dir) {
    for (let i = this.r + dir; i >= 0 && i < this.lines.length; i += dir) {
      if (!this.lines[i].trim()) return this.setPos(i, 0);
    }
    this.setPos(dir > 0 ? this.lines.length - 1 : 0, 0);
  }

  move(dr, dc) {
    if (!this.lines.length) return;
    this.r = clamp(this.r + dr, 0, this.lines.length - 1);
    const len = this.lineLen(this.r);
    this.c = clamp(this.c + dc, 0, Math.max(0, len - 1));
    this.ensureVisible();
  }

  goto(row) {
    if (!this.lines.length) return;
    this.r = clamp(row, 0, this.lines.length - 1);
    this.c = clamp(this.c, 0, Math.max(0, this.lineLen(this.r) - 1));
    this.ensureVisible();
  }

  page(dir) {
    if (!this.lines.length) return;
    this.r = clamp(this.r + dir * Math.max(1, this.visible() - 1), 0, this.lines.length - 1);
    this.c = clamp(this.c, 0, Math.max(0, this.lineLen(this.r) - 1));
    this.ensureVisible();
  }

  // --- search --------------------------------------------------------------

  // Case-insensitive unless the query has an uppercase character (smartcase).
  computeMatches() {
    this.matchRows = new Map();
    this.matches = [];
    const q = this.query;
    if (!q || !this.lines.length) return;
    const fold = q === q.toLowerCase();
    const needle = fold ? q.toLowerCase() : q;
    for (let r = 0; r < this.lines.length; r++) {
      const line = this.lines[r];
      if (!line) continue;
      const hay = fold ? line.toLowerCase() : line;
      let at = hay.indexOf(needle);
      while (at !== -1) {
        const start = Array.from(line.slice(0, at)).length;
        const len = Array.from(line.slice(at, at + needle.length)).length;
        this.matches.push({ r, c: start, len });
        const ranges = this.matchRows.get(r);
        if (ranges) ranges.push({ s: start, e: start + len - 1 });
        else this.matchRows.set(r, [{ s: start, e: start + len - 1 }]);
        at = hay.indexOf(needle, at + needle.length);
      }
    }
  }

  jumpMatch(dir) {
    if (!this.matches.length) return;
    const key = (m) => m.r * 1e6 + m.c;
    const cur = this.r * 1e6 + this.c;
    let found = null;
    if (dir > 0) found = this.matches.find((m) => key(m) > cur) ?? this.matches[0];
    else {
      for (let i = this.matches.length - 1; i >= 0; i--) {
        if (key(this.matches[i]) < cur) { found = this.matches[i]; break; }
      }
      found = found ?? this.matches[this.matches.length - 1];
    }
    this.setPos(found.r, found.c);
  }

  escape(cx) {
    this.escAt = Date.now();
    if (this.typing) return this.cancelSearch(cx);
    if (this.jump) {
      this.jump = null;
      return cx.notify();
    }
    if (this.anchor) {
      this.anchor = null;
      this.linewise = false;
      return cx.notify();
    }
    this.close();
  }

  startSearch(cx) {
    this.typing = true;
    this.query = "";
    this.searchInput.set_value("");
    this.searchInput.focus();
    this.computeMatches();
    cx.notify();
  }

  cancelSearch(cx) {
    this.typing = false;
    this.query = this.lastQuery;
    this.searchInput.set_value(this.lastQuery);
    this.computeMatches();
    this.handle.focus();
    cx.notify();
  }

  commitSearch(cx) {
    this.typing = false;
    this.lastQuery = this.query;
    this.computeMatches();
    this.handle.focus();
    if (this.matches.length) this.jumpMatch(1);
    cx.notify();
  }

  // --- s-jump --------------------------------------------------------------

  // Matches of the typed query in the visible window. Labels (lowercase,
  // drawn one cell after each match) only become active from two characters
  // on, so the first two keystrokes always refine instead of jumping.
  updateJump() {
    const q = this.jump.query;
    const qlen = Array.from(q).length;
    const rows = this.visible();
    const fold = q === q.toLowerCase();
    const needle = fold ? q.toLowerCase() : q;
    const positions = [];
    const blocked = new Set(); // chars right after a match: the likely next keystroke
    const last = Math.min(this.lines.length, this.top + rows);
    if (q) {
      for (let r = this.top; r < last; r++) {
        const line = this.lines[r];
        if (!line) continue;
        const hay = fold ? line.toLowerCase() : line;
        let at = hay.indexOf(needle);
        while (at !== -1) {
          const startGlyph = Array.from(line.slice(0, at)).length;
          const len = Array.from(line.slice(at, at + needle.length)).length;
          positions.push({ r, c: startGlyph, len });
          const next = this.glyphs[r]?.[startGlyph + len];
          if (next) blocked.add(next.toLowerCase());
          at = hay.indexOf(needle, at + needle.length);
        }
      }
    }
    const byKey = new Map();
    const after = new Map();
    if (qlen >= 2) {
      let k = 0;
      for (const p of positions) {
        if (k >= LABELS.length) break;
        while (k < LABELS.length && blocked.has(LABELS[k])) k++;
        if (k >= LABELS.length) break;
        const label = LABELS[k++];
        byKey.set(label, { r: p.r, c: p.c });
        const m = after.get(p.r);
        if (m) m.set(p.c + p.len, label);
        else after.set(p.r, new Map([[p.c + p.len, label]]));
      }
    }
    this.jump = { ...this.jump, byKey, after, count: positions.length, only: positions.length === 1 ? positions[0] : null };
  }

  jumpKey(e, cx) {
    cx.stop_propagation();
    if (e.key === "escape") {
      this.jump = null;
      return cx.notify();
    }
    if (e.key === "backspace") {
      this.jump.query = Array.from(this.jump.query).slice(0, -1).join("");
      this.updateJump();
      return cx.notify();
    }
    const m = e.modifiers ?? {};
    if (m.control || m.platform || m.alt) return cx.notify(); // stay in the mode
    const ch = e.key_char ?? (e.key.length === 1 ? e.key : "");
    if (!ch) return cx.notify(); // arrows and other keys keep the mode
    const hit = Array.from(this.jump.query).length >= 2 ? this.jump.byKey.get(ch) : null;
    if (hit) {
      this.jump = null;
      this.setPos(hit.r, hit.c);
      return cx.notify();
    }
    this.jump.query += ch;
    this.updateJump();
    if (this.jump.count === 1 && this.jump.only) {
      const only = this.jump.only;
      this.jump = null;
      this.setPos(only.r, only.c);
    }
    return cx.notify();
  }

  // --- keys ----------------------------------------------------------------

  key(e, cx) {
    this.interacted = true;
    if (this.typing) {
      if (e.key !== "escape") return; // the Input owns typing, IME and paste
      cx.stop_propagation();
      return this.cancelSearch(cx);
    }
    cx.stop_propagation();
    if (this.jump) return this.jumpKey(e, cx);
    const m = e.modifiers ?? {};
    if (e.key === "escape") {
      if (Date.now() - (this.escAt ?? 0) < 60) return;
      return this.escape(cx);
    }
    if (m.control || m.platform) {
      if (e.key === "d") { this.page(1); return cx.notify(); }
      if (e.key === "u") { this.page(-1); return cx.notify(); }
      return;
    }
    const ch = e.key_char ?? (m.shift && e.key.length === 1 ? e.key.toUpperCase() : e.key);
    if (e.key === "pageup") { this.page(-1); return cx.notify(); }
    if (e.key === "pagedown") { this.page(1); return cx.notify(); }
    if (e.key === "home" || ch === "0") { this.c = 0; return cx.notify(); }
    if (e.key === "end" || ch === "$") { this.c = Math.max(0, this.lineLen(this.r) - 1); return cx.notify(); }
    switch (e.key) {
      case "left": this.move(0, -1); return cx.notify();
      case "right": this.move(0, 1); return cx.notify();
      case "up": this.move(-1, 0); return cx.notify();
      case "down": this.move(1, 0); return cx.notify();
    }
    switch (ch) {
      case "h": this.move(0, -1); return cx.notify();
      case "l": this.move(0, 1); return cx.notify();
      case "j": this.move(1, 0); return cx.notify();
      case "k": this.move(-1, 0); return cx.notify();
      case "w": this.wordMotion(true, "start", isWord); return cx.notify();
      case "e": this.wordMotion(true, "end", isWord); return cx.notify();
      case "b": this.wordMotion(false, "start", isWord); return cx.notify();
      case "W": this.wordMotion(true, "start", (x) => !isSpace(x)); return cx.notify();
      case "E": this.wordMotion(true, "end", (x) => !isSpace(x)); return cx.notify();
      case "B": this.wordMotion(false, "start", (x) => !isSpace(x)); return cx.notify();
      case "{": this.paragraph(-1); return cx.notify();
      case "}": this.paragraph(1); return cx.notify();
      case "g": this.goto(0); return cx.notify();
      case "G": this.goto(this.lines.length - 1); return cx.notify();
      case "/":
        return this.startSearch(cx);
      case "n": this.jumpMatch(1); return cx.notify();
      case "N": this.jumpMatch(-1); return cx.notify();
      case "s":
        this.jump = { query: "", byKey: new Map(), after: new Map(), count: 0 };
        return cx.notify();
      case "v":
        this.anchor = this.anchor && !this.linewise ? null : { r: this.r, c: this.c };
        this.linewise = false;
        return cx.notify();
      case "V":
        this.anchor = this.anchor && this.linewise ? null : { r: this.r, c: this.c };
        this.linewise = true;
        return cx.notify();
      case "y":
      case "enter":
        return this.yank(cx);
      case "q":
        this.close();
        return;
    }
  }

  // --- render --------------------------------------------------------------

  rowEl(i, sel, t, font) {
    const g = this.glyphs[i] ?? [];
    const len = g.length;
    const range = this.rangeFor(i, sel);
    const search = this.matchRows?.get(i) ?? null;
    const labels = this.jump?.after?.get(i) ?? null;
    const runs = [];
    let run = null;
    const push = (text, bg, fg) => {
      if (run && run.bg === bg && run.fg === fg) run.text += text;
      else { run = { text, bg, fg }; runs.push(run); }
    };
    for (let c = 0; c < len; c++) {
      const label = labels?.get(c);
      if (label) push(label, t.accent, t.accent_foreground);
      let bg = null;
      let fg = t.foreground;
      if (range && c >= range[0] && c <= range[1]) bg = t.selection;
      if (search) {
        for (let k = 0; k < search.length; k++) {
          if (c >= search[k].s && c <= search[k].e) { bg = t.selected; break; }
        }
      }
      if (i === this.r && c === this.c) { bg = t.accent; fg = t.accent_foreground; }
      push(g[c], bg, fg);
    }
    const tail = labels?.get(len);
    if (tail) push(tail, t.accent, t.accent_foreground);
    if (i === this.r && this.c >= len) push(" ", t.accent, t.accent_foreground);
    const parts = runs.map((r) =>
      div()
        .flex_none()
        .font_family(font)
        .text_color(r.fg)
        .when(Boolean(r.bg), (el) => el.bg(r.bg))
        .child(r.text),
    );
    return h_flex()
      .h(LINE_H)
      .flex_none()
      .items_center()
      .whitespace_nowrap()
      .text_size(13)
      .line_height(`${LINE_H}px`)
      .text_color(t.foreground)
      .children(parts);
  }

  render(cx) {
    const t = theme();
    const font = settings().font_family ?? "JetBrains Mono";
    this.ensureVisible();
    const sel = this.sel();
    const rows = this.visible();
    const slice = [];
    for (let i = this.top; i < Math.min(this.lines.length, this.top + rows); i++) {
      slice.push(this.rowEl(i, sel, t, font));
    }
    const mode = this.typing ? "SEARCH" : this.jump ? "JUMP" : this.anchor ? (this.linewise ? "V-LINE" : "VISUAL") : "NORMAL";
    const pos = this.lines.length ? `${this.r + 1}/${this.lines.length}:${this.c + 1}` : "—";
    const hint = this.jump
      ? this.jump.query
        ? Array.from(this.jump.query).length >= 2
          ? `"${this.jump.query}"  (${this.jump.count})  · label jumps · Bksp edit · Esc cancel`
          : `"${this.jump.query}"  (${this.jump.count})  · one more character for labels`
        : "type characters to match · Bksp edit · Esc cancel"
      : "hjkl wbe {} / search · s jump · v select · y copy";
    return v_flex()
      .id("copy-mode")
      .size_full()
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", (_e, cx) => {
        this.interacted = true;
        if (!this.handle.is_focused() && !this.typing) this.handle.focus();
        cx.stop_propagation();
      })
      .on_size_change((size, cx) => {
        if (!this.mounted) {
          this.mounted = true;
          cx.timer.after(32, () => {
            const overlay = props()?.overlay;
            if (this.closed || this.interacted || this.typing) return;
            if (overlay && shared("keys.capturing")?.ts !== this.capture?.ts) return;
            if (!this.handle.is_focused()) this.handle.focus();
          });
        }
        this.height = size.height;
        cx.notify();
      })
      .bg(t.popover)
      .rounded(R())
      .border_1()
      .border_color(t.border)
      .p(PAD)
      .gap(0)
      .overflow_hidden()
      .child(
        h_flex()
          .h(HEAD_H)
          .flex_none()
          .items_center()
          .gap(10)
          .text_size(12)
          .child(div().font_semibold().text_color(t.foreground).child(mode))
          .child(div().text_color(t.dim).child(pos))
          .when(this.typing, (el) =>
            el.child(Input.new(this.searchInput).flex_1().h(20).text_size(12).text_color(t.foreground)),
          )
          .when(this.typing && this.matches.length > 0, (el) =>
            el.child(div().text_color(t.accent).child(`(${this.matches.length})`)),
          )
          .when(!this.typing, (el) =>
            el.child(div().text_color(this.jump ? t.accent : t.dim).child(hint)),
          )
          .child(div().flex_1()),
      )
      .child(v_flex().flex_1().min_h(0).overflow_hidden().gap(0).children(slice))
      .child(
        h_flex()
          .h(FOOT_H)
          .flex_none()
          .items_center()
          .gap(10)
          .text_size(11)
          .child(div().text_color(t.dim).child(this.target ?? ""))
          .child(div().flex_1())
          .child(div().text_color(this.status ? t.blocked : t.dim).child(this.status ?? (this.anchor ? "selection" : ""))),
      );
  }
}
