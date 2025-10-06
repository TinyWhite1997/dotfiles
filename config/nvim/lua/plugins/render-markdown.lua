return {
  "MeanderingProgrammer/render-markdown.nvim",
  opts = {
    sign = { enabled = false },
    code = {
      width = "block",
      min_width = 80,
      border = "thin",
      left_pad = 1,
      right_pad = 1,
      position = "right",
      language_icon = true,
      language_name = true,
      highlight_inline = "RenderMarkdownCodeInfo",
    },
    heading = {
      icons = { "󰼏 ", "󰎨 ", "󰼑 ", "󰎲 ", "󰼓 ", "󰎴 " },
      border = true,
      render_modes = true,
    },
    checked = {
      highlight = "RenderMarkdownUnchecked",
      scope_highlight = "RenderMarkdownUnchecked",
    },
    anti_conceal = {
      disabled_modes = { "n" },
      ignore = {
        bullet = true,
        head_border = true,
        head_background = true,
      },
    },
    win_options = { concealcursor = { rendered = "nvc" } },
    completions = {
      blink = { enabled = true },
      lsp = { enabled = true },
    },
  },
}
