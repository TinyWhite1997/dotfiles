import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { agents, spaces, run, theme, props, closeOverlay } from "herdr";

const FILTERS = { a: "all", w: "working", d: "done", i: "idle", b: "blocked" };

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
      .child(h_flex().gap(6).children(Object.entries(FILTERS).map(([key, status]) =>
        div().id(`filter-${key}`).px(8).py(5).rounded(5).cursor_pointer()
          .bg(this.status === status ? t.hover : t.background)
          .text_color(this.status === status ? t.foreground : t.dim)
          .on_click((_e, cx) => { this.status = status; this.at = 0; cx.notify(); })
          .child(`${key}: ${status}`))))
      .child(this.searching
        ? h_flex().h(36).px(10).items_center().rounded(7).border_1().border_color(t.accent).bg(t.background)
          .child(Input.new(this.input).flex_1().h_full().text_color(t.foreground))
        : div().text_size(12).text_color(t.muted).child(this.query ? `Search: ${this.query}  (/ to edit)` : "/ to search"))
      .child(rows.length
        ? v_flex().id("picker-list").h(Math.min(360, rows.length * 32 + (items.length - rows.length) * 29)).min_h(0)
          .overflow_y_scrollbar().track_scroll(this.scroll)
          .children(items.map(row => row.heading
            ? h_flex().id(`space-${row.heading.id}`).h(29).flex_none().px(10).items_center()
              .text_size(11).font_semibold().text_color(t.dim).child(row.heading.name)
            : h_flex().id(`row-${row.id}`).h(32).flex_none().px(10).gap(10).items_center().rounded(6)
              .cursor_pointer().bg(row === rows[this.at] ? t.hover : t.popover)
              .hover(s => s.bg(t.hover))
              .on_click(() => this.go(row))
              .child(div().w(64).flex_none().text_size(11).text_color(t[row.agent?.status] ?? t.dim)
                .child(row.agent?.status ?? "tab"))
              .child(div().flex_1().min_w(0).truncate().text_color(t.foreground)
                .child(row.agent ? row.agent.title || row.agent.program.name : row.tab.name))
              .when(row.agent !== null, el => el.child(div().max_w(220).truncate().text_size(11).text_color(t.dim)
                .child(`${row.tab.name} / ${row.agent.program.name}`)))))
        : div().h(80).text_color(t.dim).child("No matching agents or tabs"))
      .child(div().text_size(11).text_color(t.dim)
        .child(this.searching ? "SEARCH  Enter: go  Esc: close" : "NORMAL  j/k: move  Enter: go  /: search  Esc: close"));
  }
}
