import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { agents, spaces, run, theme, props, closeOverlay, shared } from "herdr";

const FILTERS = { a: "all", w: "working", d: "done", i: "idle", b: "blocked" };
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

export default class ModalPicker extends View {
  init(_props, cx) {
    this.status = "all";
    this.searching = false;
    this.query = "";
    this.at = 0;
    this.scroll = ScrollHandle.new();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Search space, tab or agent..." });
    this.input.on("change", (_event, cx) => {
      this.query = this.input.value();
      this.at = 0;
      cx.notify();
    });
    this.input.on("submit", () => this.go(this.rows()[this.at]));
    this.handle.focus();
  }

  rows() {
    const all = agents();
    const query = this.query.toLowerCase();
    return spaces().flatMap(space => space.tabs.flatMap(tab => {
      const mine = all.filter(agent => agent.tab === tab.id);
      const entries = mine.length
        ? mine.map(agent => ({ id: agent.address, space, tab, agent }))
        : [{ id: tab.id, space, tab, agent: null }];
      return entries.filter(row =>
        (this.status === "all" || row.agent?.status === this.status) &&
        [space.name, tab.name, row.agent?.title, row.agent?.program.name, row.agent?.address]
          .join(" ").toLowerCase().includes(query));
    }));
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  go(row) {
    if (!row) return;
    this.dismiss();
    if (row.agent) run("agent.focus", { terminal: row.agent.address });
    else run("tab.select", { id: row.tab.id });
  }

  key(e, cx) {
    const key = e.key;
    if (e.modifiers.control || e.modifiers.alt || e.modifiers.platform) return;
    if (key === "escape") {
      this.dismiss();
    } else if (key === "down" || key === "up" || (!this.searching && (key === "j" || key === "k"))) {
      const count = this.rows().length;
      if (count) this.at = (this.at + (key === "down" || key === "j" ? 1 : -1) + count) % count;
    } else if (this.searching) {
      return;
    } else if (key === "enter") {
      this.go(this.rows()[this.at]);
    } else if (key === "/") {
      this.searching = true;
      this.input.focus();
    } else if (FILTERS[key]) {
      this.status = FILTERS[key];
      this.at = 0;
    } else {
      return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  spaceColor(t, space) {
    if (space.name === "~") return t.dim;
    const color = shared("space.colors")?.[space.id] ?? "ansi6";
    return color.startsWith("#") ? color : (MARK[color] ?? t[color]);
  }

  glyph(t, status) {
    if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    return div().w(12).flex_none().text_color(t[status] ?? t.dim).child(status === "idle" ? "○" : status ? "●" : "·");
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const items = rows.flatMap((row, index) =>
      index === 0 || row.space.id !== rows[index - 1].space.id ? [{ heading: row.space }, row] : [row]);
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    if (rows.length) this.scroll.scroll_to_item(items.indexOf(rows[this.at]));
    return v_flex()
      .id("modal-picker")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .w_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13)
      .child(h_flex().items_center().justify_between()
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Go to..."))
        .child(div().text_size(11).text_color(t.dim).child(`${rows.length} results`)))
      .when(this.searching, el => el.child(
        h_flex().h(36).px(10).items_center().rounded(7).border_1().border_color(t.accent).bg(t.background)
          .child(Input.new(this.input).flex_1().h_full().text_color(t.foreground))))
      .child(rows.length
        ? v_flex().id("picker-list").h(Math.min(420, rows.length * 32 + (items.length - rows.length) * 29)).min_h(0)
          .overflow_y_scrollbar().track_scroll(this.scroll)
          .children(items.map(row => row.heading
            ? h_flex().id(`space-${row.heading.id}`).h(29).flex_none().px(10).gap(8).items_center()
              .text_size(11).font_semibold().text_color(t.dim)
              .child(h_flex().size(18).rounded(5).bg(this.spaceColor(t, row.heading)).items_center().justify_center()
                .text_size(10.5).font_bold().text_color("#ffffff").child([...row.heading.name][0]?.toUpperCase() ?? "?"))
              .child(row.heading.name)
            : h_flex().id(`row-${row.id}`).h(32).flex_none().px(10).gap(10).items_center().rounded(6)
              .cursor_pointer().bg(row === rows[this.at] ? t.hover : t.popover)
              .hover(s => s.bg(t.hover))
              .on_click(() => this.go(row))
              .child(this.glyph(t, row.agent?.status ?? row.tab.status))
              .child(div().flex_1().min_w(0).truncate().text_color(t.foreground)
                .when(row.agent ? row.agent.focused : row.space.active && row.tab.active, el => el.font_semibold())
                .child(row.agent ? row.agent.title || row.agent.program.name : row.tab.name))
              .when(row.agent !== null, el => el.child(div().max_w(220).truncate().text_size(11).text_color(t.dim)
                .child(`${row.tab.name} / ${row.agent.program.name}`)))))
        : div().h(80).text_color(t.dim).child("No matching agents or tabs"))
      .child(this.searching
        ? div().text_size(11).text_color(t.dim).child("SEARCH  Enter:go  Esc:close")
        : h_flex().gap(8).text_size(11).text_color(t.dim)
          .children(Object.entries(FILTERS).map(([key, status]) =>
            div().id(`filter-${key}`).cursor_pointer()
              .on_click((_e, cx) => { this.status = status; this.at = 0; cx.notify(); })
              .child(this.status === status ? `[${key}:${status}]` : `${key}:${status}`)))
          .child(div().child("j/k:move  /:search  Enter:go  Esc:close")));
  }
}
