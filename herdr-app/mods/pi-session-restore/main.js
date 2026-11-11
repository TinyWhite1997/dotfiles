import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { terminals, hc, openOverlay, closeOverlay, props, theme } from "herdr";
import { LABELS, restoreCandidates, resumeCommand } from "./logic.mjs";

export default class PiRestore extends View {
  init() {
    this.busy = new Set();
    this.errors = new Map();
  }

  candidates() {
    return restoreCandidates(terminals());
  }

  restore(terminal, cx) {
    if (this.busy.has(terminal.address)) return;
    this.busy.add(terminal.address);
    this.errors.delete(terminal.address);
    cx.notify();
    cx.spawn(async (cx) => {
      const result = await hc(["send", terminal.address, resumeCommand(terminal)]);
      if (result.code !== 0) {
        this.busy.delete(terminal.address);
        this.errors.set(terminal.address, result.stderr.trim() || "Could not start Pi");
      }
      cx.notify();
    });
  }

  forget(terminal, cx) {
    if (this.busy.has(terminal.address)) return;
    this.busy.add(terminal.address);
    cx.notify();
    cx.spawn(async (cx) => {
      const result = await hc(["label", terminal.address,
        `${LABELS.id}=`, `${LABELS.path}=`, `${LABELS.cwd}=`]);
      this.busy.delete(terminal.address);
      if (result.code !== 0) this.errors.set(terminal.address, result.stderr.trim() || "Could not forget session");
      cx.notify();
    });
  }

  button(t, id, label, primary, onClick) {
    return h_flex().id(id).h(30).px(11).items_center().rounded(7)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .cursor_pointer().hover((el) => el.opacity(0.88)).on_click(onClick).child(label);
  }

  panel(cx) {
    const t = theme();
    const candidates = this.candidates();
    return v_flex().id("pi-restore-dialog").size_full().min_h(0).p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(16).font_semibold().child("Restore Pi sessions"))
        .child(div().id("pi-restore-close").px(7).py(3).rounded(5).text_size(11).text_color(t.dim)
          .cursor_pointer().hover((el) => el.bg(t.hover).text_color(t.foreground))
          .on_click(() => closeOverlay(props().overlay)).child("Esc")))
      .child(candidates.length
        ? v_flex().flex_1().min_h(0).gap(8).overflow_y_scrollbar().children(candidates.map((terminal) => {
          const path = terminal.labels[LABELS.path];
          const cwd = terminal.labels[LABELS.cwd] || terminal.cwd;
          const busy = this.busy.has(terminal.address);
          const error = this.errors.get(terminal.address);
          return v_flex().id(`pi-session-${terminal.address}`).p(12).gap(7).rounded(8).bg(t.surface).border_1().border_color(t.border)
            .child(div().font_semibold().child(terminal.labels.where || terminal.title || terminal.address))
            .child(div().text_size(12).text_color(t.muted).truncate().tooltip(cwd).child(cwd || "Unknown folder"))
            .child(div().text_size(11).text_color(t.dim).truncate().tooltip(path).child(path))
            .when(Boolean(error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(error)))
            .child(h_flex().justify_end().gap(8)
              .child(this.button(t, `forget-${terminal.address}`, "Forget", false, (_e, cx) => this.forget(terminal, cx)))
              .child(this.button(t, `restore-${terminal.address}`, busy ? "Starting…" : "Restore", true, (_e, cx) => this.restore(terminal, cx))));
        }))
        : div().flex_1().text_color(t.muted).child("No Pi sessions need restoring."));
  }

  render(cx) {
    if (props()?.overlay || props()?.dialog) return this.panel(cx);
    const t = theme();
    const count = this.candidates().length;
    return h_flex().id("pi-restore-bar").size_full().px(12).gap(8).items_center().bg(t.chrome)
      .text_size(12).text_color(count ? t.foreground : t.dim)
      .cursor_pointer().hover((el) => el.bg(t.hover))
      .on_click(() => openOverlay({ mod: "pi-session-restore", kind: "dialog", width: 580, height: 420, props: { dialog: true } }))
      .child(div().size(7).rounded(4).bg(count ? t.done : t.idle))
      .child(count ? `${count} Pi session${count === 1 ? "" : "s"} ready to restore` : "Pi session restore ready")
      .child(div().flex_1())
      .child(div().text_color(t.dim).child("Open"));
  }
}
