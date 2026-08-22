local utils = require "config.utils"

return {
  {
    "catppuccin/nvim",
    name = "catppuccin",
    priority = 1000,
    opts = utils.merge({
      flavour = "mocha",
      integrations = { rainbow_delimiters = true },
    }, {
      transparent_background = not vim.g.neovide,
      float = { transparent = true, solid = false },
      auto_integrations = true,
      integrations = {
        colorful_winsep = { color = "lavender" },
        snacks = { indent_scope_color = "lavender" },
        rainbow_delimiters = true,
      },
    }),
    config = function(_, opts)
      require("catppuccin").setup(opts)
      vim.cmd.colorscheme "catppuccin"
    end,
  },
  {
    "echasnovski/mini.icons",
    lazy = false,
    opts = {
      file = {
        [".nvmrc"] = { glyph = "", hl = "MiniIconsGreen" },
        [".node-version"] = { glyph = "", hl = "MiniIconsGreen" },
        ["package.json"] = { glyph = "", hl = "MiniIconsGreen" },
        ["tsconfig.json"] = { glyph = "", hl = "MiniIconsAzure" },
        ["tsconfig.build.json"] = { glyph = "", hl = "MiniIconsAzure" },
        ["yarn.lock"] = { glyph = "", hl = "MiniIconsBlue" },
      },
      filetype = { postcss = { glyph = "󰌜", hl = "MiniIconsOrange" } },
    },
  },
  {
    "rebelot/heirline.nvim",
    event = "BufEnter",
    config = function()
      require("config.heirline").setup()
    end,
  },
  {
    "folke/which-key.nvim",
    event = "VeryLazy",
    opts = utils.merge({
      icons = { group = "", rules = false, separator = "-" },
    }, {
      spec = {
        { "<Leader>b", group = "Buffers" },
        { "<Leader>f", group = "Find" },
        { "<Leader>g", group = "Git" },
        { "<Leader>l", group = "Language Tools" },
        { "<Leader>p", group = "Packages" },
        { "<Leader>u", group = "UI/UX" },
        { "<Leader>x", group = "Quickfix/Lists" },
        { "<Leader><Leader>m", group = "Markdown" },
      },
    }),
  },
  {
    "folke/snacks.nvim",
    lazy = false,
    priority = 900,
    opts = {
      dashboard = {
        preset = {
          header = table.concat({
            " █████  ███████ ████████ ██████   ██████ ",
            "██   ██ ██         ██    ██   ██ ██    ██",
            "███████ ███████    ██    ██████  ██    ██",
            "██   ██      ██    ██    ██   ██ ██    ██",
            "██   ██ ███████    ██    ██   ██  ██████ ",
            "",
            "███    ██ ██    ██ ██ ███    ███",
            "████   ██ ██    ██ ██ ████  ████",
            "██ ██  ██ ██    ██ ██ ██ ████ ██",
            "██  ██ ██  ██  ██  ██ ██  ██  ██",
            "██   ████   ████   ██ ██      ██",
          }, "\n"),
          keys = {
            { key = "n", action = "<Leader>n", icon = " ", desc = "New File" },
            { key = "f", action = "<Leader>ff", icon = " ", desc = "Find File" },
            { key = "o", action = "<Leader>fo", icon = "󰈙 ", desc = "Recents" },
            { key = "w", action = "<Leader>fw", icon = "󰈭 ", desc = "Find Word" },
          },
        },
        sections = {
          { section = "header", padding = 5 },
          { section = "keys", gap = 1, padding = 3 },
          { section = "startup" },
        },
      },
      image = { doc = { enabled = false } },
      input = {},
      notifier = {},
      picker = { ui_select = true },
      indent = {
        indent = { char = "▏" },
        scope = { char = "▏" },
        animate = { enabled = false },
        filter = function(bufnr)
          return utils.is_valid_buffer(bufnr)
            and not utils.is_large_buffer(bufnr)
            and vim.b[bufnr].snacks_indent ~= false
        end,
      },
      scope = {
        filter = function(bufnr)
          return utils.is_valid_buffer(bufnr) and not utils.is_large_buffer(bufnr)
        end,
      },
      zen = {
        toggles = { dim = false, diagnostics = false, inlay_hints = false },
        win = {
          width = function()
            return math.min(120, math.floor(vim.o.columns * 0.75))
          end,
          height = 0.9,
        },
      },
    },
    keys = {
      {
        "<Leader>h",
        function()
          Snacks.dashboard()
        end,
        desc = "Home screen",
      },
      {
        "<Leader>f<CR>",
        function()
          Snacks.picker.resume()
        end,
        desc = "Resume previous search",
      },
      {
        "<Leader>f'",
        function()
          Snacks.picker.marks()
        end,
        desc = "Find marks",
      },
      {
        "<Leader>fa",
        function()
          Snacks.picker.files { dirs = { vim.fn.stdpath "config" } }
        end,
        desc = "Find config files",
      },
      {
        "<Leader>fb",
        function()
          Snacks.picker.buffers()
        end,
        desc = "Find buffers",
      },
      {
        "<Leader>fc",
        function()
          Snacks.picker.files { cwd = vim.fn.stdpath "config" }
        end,
        desc = "Find config file",
      },
      {
        "<Leader>fC",
        function()
          Snacks.picker.commands()
        end,
        desc = "Find commands",
      },
      {
        "<Leader>ff",
        function()
          Snacks.picker.files { hidden = vim.uv.fs_stat ".git" ~= nil }
        end,
        desc = "Find files",
      },
      {
        "<Leader>fF",
        function()
          Snacks.picker.files { hidden = true, ignored = true }
        end,
        desc = "Find all files",
      },
      {
        "<Leader>fg",
        function()
          Snacks.picker.git_files()
        end,
        desc = "Find git files",
      },
      {
        "<Leader>fh",
        function()
          Snacks.picker.help()
        end,
        desc = "Find help",
      },
      {
        "<Leader>fk",
        function()
          Snacks.picker.keymaps()
        end,
        desc = "Find keymaps",
      },
      {
        "<Leader>fl",
        function()
          Snacks.picker.lines()
        end,
        desc = "Find lines",
      },
      {
        "<Leader>fm",
        function()
          Snacks.picker.man()
        end,
        desc = "Find man",
      },
      {
        "<Leader>fn",
        function()
          Snacks.picker.notifications()
        end,
        desc = "Find notifications",
      },
      {
        "<Leader>fo",
        function()
          Snacks.picker.recent()
        end,
        desc = "Find old files",
      },
      {
        "<Leader>fO",
        function()
          Snacks.picker.recent { filter = { cwd = true } }
        end,
        desc = "Find old files (cwd)",
      },
      {
        "<Leader>fp",
        function()
          Snacks.picker.projects()
        end,
        desc = "Find projects",
      },
      {
        "<Leader>fr",
        function()
          Snacks.picker.registers()
        end,
        desc = "Find registers",
      },
      {
        "<Leader>fs",
        function()
          Snacks.picker.smart()
        end,
        desc = "Smart find",
      },
      {
        "<Leader>ft",
        function()
          Snacks.picker.colorschemes()
        end,
        desc = "Find themes",
      },
      {
        "<Leader>fu",
        function()
          Snacks.picker.undo()
        end,
        desc = "Find undo history",
      },
      {
        "<Leader>fw",
        function()
          Snacks.picker.grep()
        end,
        desc = "Find words",
      },
      {
        "<Leader>fW",
        function()
          Snacks.picker.grep { hidden = true, ignored = true }
        end,
        desc = "Find words in all files",
      },
      {
        "<Leader>fB",
        function()
          Snacks.picker.grep_buffers()
        end,
        desc = "Grep open buffers",
      },
      {
        "<Leader>f/",
        function()
          Snacks.picker.search_history()
        end,
        desc = "Search history",
      },
      {
        "<Leader>fA",
        function()
          Snacks.picker.autocmds()
        end,
        desc = "Autocmds",
      },
      {
        "<Leader>gb",
        function()
          Snacks.picker.git_branches()
        end,
        desc = "Git branches",
      },
      {
        "<Leader>gc",
        function()
          Snacks.picker.git_log()
        end,
        desc = "Git commits",
      },
      {
        "<Leader>gC",
        function()
          Snacks.picker.git_log { current_file = true, follow = true }
        end,
        desc = "Git commits (file)",
      },
      {
        "<Leader>gt",
        function()
          Snacks.picker.git_status()
        end,
        desc = "Git status",
      },
      {
        "<Leader>gT",
        function()
          Snacks.picker.git_stash()
        end,
        desc = "Git stash",
      },
      {
        "<Leader>go",
        function()
          Snacks.gitbrowse()
        end,
        desc = "Git browse",
        mode = { "n", "x" },
      },
      {
        "<Leader>gg",
        function()
          Snacks.lazygit()
        end,
        desc = "Lazygit",
      },
      {
        "<C-/>",
        function()
          Snacks.terminal()
        end,
        desc = "Toggle terminal",
      },
      {
        "<Leader>u|",
        function()
          Snacks.toggle.indent():toggle()
        end,
        desc = "Toggle indent guides",
      },
      {
        "<Leader>uZ",
        function()
          Snacks.toggle.zen():toggle()
        end,
        desc = "Toggle zen mode",
      },
      {
        "<Leader>uD",
        function()
          Snacks.notifier.hide()
        end,
        desc = "Dismiss notifications",
      },
    },
  },
}
