local utils = require "config.utils"

return {
  {
    "nvim-treesitter/nvim-treesitter",
    branch = "main",
    lazy = false,
    build = ":TSUpdate",
    config = function()
      local parsers = {
        "bash",
        "c",
        "c_sharp",
        "css",
        "html",
        "javascript",
        "jsdoc",
        "json",
        "lua",
        "luap",
        "markdown",
        "markdown_inline",
        "powershell",
        "python",
        "query",
        "scss",
        "tsx",
        "typescript",
        "vim",
        "vimdoc",
        "xml",
        "yaml",
      }
      require("nvim-treesitter").setup {}
      require("nvim-treesitter").install(parsers)
      vim.api.nvim_create_autocmd("FileType", {
        group = vim.api.nvim_create_augroup("native_treesitter", { clear = true }),
        callback = function(args)
          local lang = vim.treesitter.language.get_lang(vim.bo[args.buf].filetype)
          if lang and pcall(vim.treesitter.language.add, lang) then
            pcall(vim.treesitter.start, args.buf, lang)
            vim.bo[args.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
          end
        end,
      })
    end,
  },
  {
    "nvim-treesitter/nvim-treesitter-textobjects",
    branch = "main",
    lazy = false,
    config = function()
      require("nvim-treesitter-textobjects").setup {
        select = { lookahead = true },
        move = { set_jumps = true },
      }
      local select = require "nvim-treesitter-textobjects.select"
      local move = require "nvim-treesitter-textobjects.move"
      local swap = require "nvim-treesitter-textobjects.swap"
      local selections = {
        ak = "@block.outer",
        ik = "@block.inner",
        ac = "@class.outer",
        ic = "@class.inner",
        ["a?"] = "@conditional.outer",
        ["i?"] = "@conditional.inner",
        af = "@function.outer",
        ["if"] = "@function.inner",
        ao = "@loop.outer",
        io = "@loop.inner",
        aa = "@parameter.outer",
        ia = "@parameter.inner",
      }
      local function select_map(query)
        return function()
          select.select_textobject(query, "textobjects")
        end
      end
      for lhs, query in pairs(selections) do
        vim.keymap.set({ "x", "o" }, lhs, select_map(query))
      end
      local moves = {
        ["]k"] = { move.goto_next_start, "@block.outer" },
        ["]f"] = { move.goto_next_start, "@function.outer" },
        ["]a"] = { move.goto_next_start, "@parameter.inner" },
        ["]K"] = { move.goto_next_end, "@block.outer" },
        ["]F"] = { move.goto_next_end, "@function.outer" },
        ["]A"] = { move.goto_next_end, "@parameter.inner" },
        ["[k"] = { move.goto_previous_start, "@block.outer" },
        ["[f"] = { move.goto_previous_start, "@function.outer" },
        ["[a"] = { move.goto_previous_start, "@parameter.inner" },
        ["[K"] = { move.goto_previous_end, "@block.outer" },
        ["[F"] = { move.goto_previous_end, "@function.outer" },
        ["[A"] = { move.goto_previous_end, "@parameter.inner" },
      }
      local function move_map(fn, query)
        return function()
          fn(query, "textobjects")
        end
      end
      for lhs, spec in pairs(moves) do
        vim.keymap.set({ "n", "x", "o" }, lhs, move_map(spec[1], spec[2]))
      end
      for lhs, query in pairs { [">K"] = "@block.outer", [">F"] = "@function.outer", [">A"] = "@parameter.inner" } do
        vim.keymap.set("n", lhs, move_map(swap.swap_next, query))
      end
      for lhs, query in pairs { ["<K"] = "@block.outer", ["<F"] = "@function.outer", ["<A"] = "@parameter.inner" } do
        vim.keymap.set("n", lhs, move_map(swap.swap_previous, query))
      end
    end,
  },
  {
    "windwp/nvim-autopairs",
    event = "InsertEnter",
    opts = utils.merge({
      check_ts = true,
      enabled = function(bufnr)
        return utils.is_valid_buffer(bufnr) and not utils.is_large_buffer(bufnr)
      end,
      ts_config = { java = false },
      fast_wrap = {
        map = "<M-e>",
        chars = { "{", "[", "(", '"', "'" },
        pattern = ([[ [%'%"%)%>%]%)%}%,] ]]):gsub("%s+", ""),
        offset = 0,
        end_key = "$",
        keys = "qwertyuiopzxcvbnmasdfghjkl",
        check_comma = true,
        highlight = "PmenuSel",
        highlight_grey = "LineNr",
      },
    }, {}),
    config = function(_, opts)
      local npairs = require "nvim-autopairs"
      npairs.setup(opts)
      local Rule = require "nvim-autopairs.rule"
      local cond = require "nvim-autopairs.conds"
      npairs.add_rules {
        Rule("$", "$", { "tex", "latex" })
          :with_pair(cond.not_after_regex "%%")
          :with_pair(cond.not_before_regex("xxx", 3))
          :with_move(cond.none())
          :with_del(cond.not_after_regex "xx")
          :with_cr(cond.none()),
        Rule("a", "a", "-vim"),
      }
    end,
    keys = {
      {
        "<Leader>ua",
        function()
          vim.g.autopairs_enabled = not require("nvim-autopairs").state.disabled
          require("nvim-autopairs").toggle()
        end,
        desc = "Toggle autopairs",
      },
    },
  },
  { "kylechui/nvim-surround", event = "VeryLazy", opts = {} },
  {
    "max397574/better-escape.nvim",
    event = "VeryLazy",
    opts = { timeout = 300, default_mappings = false, mappings = { i = { j = { k = "<Esc>", j = "<Esc>" } } } },
  },
  {
    "NMAC427/guess-indent.nvim",
    event = { "BufReadPost", "BufNewFile" },
    opts = { auto_cmd = false },
    config = function(_, opts)
      require("guess-indent").setup(opts)
      local group = vim.api.nvim_create_augroup("guess_indent", { clear = true })
      vim.api.nvim_create_autocmd("BufReadPost", {
        group = group,
        callback = function(args)
          require("guess-indent").set_from_buffer(args.buf, true, true)
        end,
      })
      vim.api.nvim_create_autocmd("BufNewFile", {
        group = group,
        callback = function(args)
          vim.api.nvim_create_autocmd("BufWritePost", {
            group = group,
            buffer = args.buf,
            once = true,
            callback = function(ev)
              require("guess-indent").set_from_buffer(ev.buf, true, true)
            end,
          })
        end,
      })
    end,
  },
  {
    "brenoprata10/nvim-highlight-colors",
    event = { "BufReadPost", "InsertEnter" },
    cmd = "HighlightColors",
    opts = {
      enable_named_colors = false,
      virtual_symbol = "󱓻",
      exclude_buffer = function(bufnr)
        return utils.is_large_buffer(bufnr) or not utils.is_valid_buffer(bufnr)
      end,
    },
    keys = { { "<Leader>uz", "<Cmd>HighlightColors Toggle<CR>", desc = "Toggle color highlight" } },
  },
  { "windwp/nvim-ts-autotag", event = { "BufReadPost", "BufNewFile" }, opts = {} },
  {
    "HiPhish/rainbow-delimiters.nvim",
    submodules = false,
    dependencies = { "nvim-treesitter/nvim-treesitter" },
    event = { "BufReadPost", "BufNewFile" },
    main = "rainbow-delimiters.setup",
    opts = {
      condition = function(bufnr)
        return utils.is_valid_buffer(bufnr) and not utils.is_large_buffer(bufnr)
      end,
    },
    keys = {
      {
        "<Leader>u(",
        function()
          local rainbow = require "rainbow-delimiters"
          local bufnr = vim.api.nvim_get_current_buf()
          rainbow.toggle(bufnr)
          vim.notify("Rainbow delimiters: " .. (rainbow.is_enabled(bufnr) and "on" or "off"))
        end,
        desc = "Toggle rainbow delimiters",
      },
    },
  },
  {
    "MeanderingProgrammer/render-markdown.nvim",
    ft = { "markdown", "Avante", "codecompanion" },
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
      heading = { icons = { "󰼏 ", "󰎨 ", "󰼑 ", "󰎲 ", "󰼓 ", "󰎴 " }, border = true, render_modes = true },
      checked = { highlight = "RenderMarkdownUnchecked", scope_highlight = "RenderMarkdownUnchecked" },
      anti_conceal = {
        disabled_modes = { "n" },
        ignore = { bullet = true, head_border = true, head_background = true },
      },
      win_options = { concealcursor = { rendered = "nvc" } },
      completions = { lsp = { enabled = true } },
    },
  },
  {
    "mikavilpas/yazi.nvim",
    version = "*",
    event = "VeryLazy",
    dependencies = { "nvim-lua/plenary.nvim" },
    keys = {
      { "<Leader>o", "<Cmd>Yazi<CR>", mode = { "n", "x" }, desc = "Open yazi at current file" },
      { "<Leader>e", "<Cmd>Yazi cwd<CR>", desc = "Open yazi in cwd" },
      { "<C-Up>", "<Cmd>Yazi toggle<CR>", desc = "Resume yazi" },
    },
    opts = { open_for_directories = true, keymaps = { show_help = "<F1>" } },
  },
  {
    "vuki656/package-info.nvim",
    event = "BufRead package.json",
    dependencies = { "MunifTanjim/nui.nvim" },
    opts = {},
  },
  {
    "stevearc/conform.nvim",
    event = { "BufWritePre" },
    cmd = { "ConformInfo" },
    opts = {
      formatters_by_ft = {
        lua = { "stylua" },
        javascript = { "prettierd", "prettier", stop_after_first = true },
        javascriptreact = { "prettierd", "prettier", stop_after_first = true },
        typescript = { "prettierd", "prettier", stop_after_first = true },
        typescriptreact = { "prettierd", "prettier", stop_after_first = true },
        css = { "prettierd", "prettier", stop_after_first = true },
        scss = { "prettierd", "prettier", stop_after_first = true },
        html = { "prettierd", "prettier", stop_after_first = true },
        json = { "prettierd", "prettier", stop_after_first = true },
        jsonc = { "prettierd", "prettier", stop_after_first = true },
        yaml = { "prettierd", "prettier", stop_after_first = true },
        markdown = { "prettierd", "prettier", stop_after_first = true },
        sql = { "pg_format" },
      },
      format_on_save = function(bufnr)
        if vim.g.disable_autoformat or vim.b[bufnr].disable_autoformat or utils.is_large_buffer(bufnr) then
          return
        end
        if vim.tbl_contains({ "json", "yaml", "markdown" }, vim.bo[bufnr].filetype) then
          return
        end
        return { timeout_ms = 1000, lsp_format = "fallback" }
      end,
    },
  },
  { "PProvost/vim-ps1", ft = "ps1" },
}
