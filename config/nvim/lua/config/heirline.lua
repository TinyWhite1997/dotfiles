local M = {}

function M.setup()
  local conditions = require "heirline.conditions"
  local utils = require "heirline.utils"
  local icons = require "mini.icons"

  local function colors()
    local normal = vim.api.nvim_get_hl(0, { name = "Normal", link = false })
    local status = vim.api.nvim_get_hl(0, { name = "StatusLine", link = false })
    local function hl(name, attr, fallback)
      local value = vim.api.nvim_get_hl(0, { name = name, link = false })[attr]
      return value and string.format("#%06x", value) or fallback
    end
    return {
      bg = status.bg and string.format("#%06x", status.bg) or "#1e1e2e",
      fg = normal.fg and string.format("#%06x", normal.fg) or "#cdd6f4",
      blue = hl("DiagnosticInfo", "fg", "#89b4fa"),
      cyan = hl("Special", "fg", "#89dceb"),
      green = hl("DiagnosticOk", "fg", "#a6e3a1"),
      orange = hl("DiagnosticWarn", "fg", "#fab387"),
      purple = hl("Statement", "fg", "#cba6f7"),
      red = hl("DiagnosticError", "fg", "#f38ba8"),
      yellow = hl("String", "fg", "#f9e2af"),
      muted = hl("Comment", "fg", "#6c7086"),
    }
  end

  local ViMode = {
    init = function(self)
      self.mode = vim.fn.mode(1)
    end,
    static = {
      names = {
        n = "NORMAL",
        i = "INSERT",
        v = "VISUAL",
        V = "V-LINE",
        ["\22"] = "V-BLOCK",
        R = "REPLACE",
        c = "COMMAND",
        t = "TERMINAL",
      },
      mode_colors = {
        n = "blue",
        i = "green",
        v = "purple",
        V = "purple",
        ["\22"] = "purple",
        R = "red",
        c = "orange",
        t = "green",
      },
    },
    provider = function(self)
      return "  " .. (self.names[self.mode] or self.mode) .. " "
    end,
    hl = function(self)
      return { fg = self.mode_colors[self.mode] or "blue", bold = true }
    end,
    update = {
      "ModeChanged",
      pattern = "*:*",
      callback = vim.schedule_wrap(function()
        vim.cmd.redrawstatus()
      end),
    },
  }

  local GitBranch = {
    condition = conditions.is_git_repo,
    init = function(self)
      self.status = vim.b.gitsigns_status_dict
    end,
    provider = function(self)
      return self.status and ("  " .. self.status.head .. " ") or ""
    end,
    hl = { fg = "purple", bold = true },
  }

  local FileName = {
    init = function(self)
      self.filename = vim.api.nvim_buf_get_name(0)
      self.icon, self.icon_hl = icons.get("file", self.filename)
    end,
    provider = function(self)
      local name = self.filename == "" and "[No Name]" or vim.fn.fnamemodify(self.filename, ":t")
      return " " .. (self.icon or "") .. " " .. name .. (vim.bo.modified and " [+] " or " ")
    end,
    hl = function(self)
      return { fg = utils.get_highlight(self.icon_hl or "Normal").fg }
    end,
  }

  local GitDiff = {
    condition = conditions.is_git_repo,
    init = function(self)
      self.status = vim.b.gitsigns_status_dict or {}
    end,
    {
      provider = function(self)
        return self.status.added and self.status.added > 0 and (" +" .. self.status.added) or ""
      end,
      hl = { fg = "green" },
    },
    {
      provider = function(self)
        return self.status.changed and self.status.changed > 0 and (" ~" .. self.status.changed) or ""
      end,
      hl = { fg = "orange" },
    },
    {
      provider = function(self)
        return self.status.removed and self.status.removed > 0 and (" -" .. self.status.removed) or ""
      end,
      hl = { fg = "red" },
    },
    { provider = " " },
  }

  local Diagnostics = {
    condition = conditions.has_diagnostics,
    static = { error_icon = " ", warn_icon = " ", info_icon = "󰋼 ", hint_icon = "󰌵 " },
    init = function(self)
      self.errors = #vim.diagnostic.get(0, { severity = vim.diagnostic.severity.ERROR })
      self.warnings = #vim.diagnostic.get(0, { severity = vim.diagnostic.severity.WARN })
      self.info = #vim.diagnostic.get(0, { severity = vim.diagnostic.severity.INFO })
      self.hints = #vim.diagnostic.get(0, { severity = vim.diagnostic.severity.HINT })
    end,
    update = { "DiagnosticChanged", "BufEnter" },
    {
      provider = function(self)
        return self.errors > 0 and (self.error_icon .. self.errors .. " ") or ""
      end,
      hl = { fg = "red" },
    },
    {
      provider = function(self)
        return self.warnings > 0 and (self.warn_icon .. self.warnings .. " ") or ""
      end,
      hl = { fg = "yellow" },
    },
    {
      provider = function(self)
        return self.info > 0 and (self.info_icon .. self.info .. " ") or ""
      end,
      hl = { fg = "blue" },
    },
    {
      provider = function(self)
        return self.hints > 0 and (self.hint_icon .. self.hints .. " ") or ""
      end,
      hl = { fg = "cyan" },
    },
  }

  local Lsp = {
    condition = conditions.lsp_attached,
    update = { "LspAttach", "LspDetach", "BufEnter" },
    provider = function()
      local names = vim
        .iter(vim.lsp.get_clients { bufnr = 0 })
        :map(function(client)
          return client.name
        end)
        :totable()
      return #names > 0 and ("   " .. table.concat(names, ",") .. " ") or ""
    end,
    hl = { fg = "green" },
  }

  local Ruler = { provider = " %l:%c %P ", hl = { fg = "cyan" } }
  local Align = { provider = "%=" }

  local Buffer = {
    init = function(self)
      self.filename = vim.api.nvim_buf_get_name(self.bufnr)
      self.icon, self.icon_hl = icons.get("file", self.filename)
    end,
    provider = function(self)
      local name = self.filename == "" and "[No Name]" or vim.fn.fnamemodify(self.filename, ":t")
      return " " .. (self.icon or "") .. " " .. name .. (vim.bo[self.bufnr].modified and " ● " or " ")
    end,
    hl = function(self)
      if self.is_active then
        return { fg = "blue", bold = true, underline = true }
      end
      return { fg = utils.get_highlight(self.icon_hl or "Comment").fg }
    end,
    on_click = {
      callback = function(_, minwid)
        vim.api.nvim_set_current_buf(minwid)
      end,
      minwid = function(self)
        return self.bufnr
      end,
      name = "heirline_buffer_callback",
    },
  }

  local BufferLine = utils.make_buflist(
    Buffer,
    { provider = "  ", hl = { fg = "muted" } },
    { provider = "  ", hl = { fg = "muted" } }
  )

  local WinBar = {
    condition = function()
      return vim.bo.buftype == "" and vim.api.nvim_buf_get_name(0) ~= ""
    end,
    init = function(self)
      self.filename = vim.api.nvim_buf_get_name(0)
      self.icon, self.icon_hl = icons.get("file", self.filename)
    end,
    provider = function(self)
      local path = vim.fn.fnamemodify(self.filename, ":~:.")
      path = path:gsub("[/\\]", " 󰿟 ")
      return " " .. (self.icon or "") .. " " .. path .. " "
    end,
    hl = function(self)
      return { fg = utils.get_highlight(self.icon_hl or "WinBar").fg }
    end,
  }

  require("heirline").setup {
    opts = { colors = colors() },
    statusline = { hl = { fg = "fg", bg = "bg" }, ViMode, GitBranch, FileName, GitDiff, Diagnostics, Align, Lsp, Ruler },
    winbar = WinBar,
    tabline = { hl = { fg = "fg", bg = "bg" }, BufferLine, Align },
  }

  vim.api.nvim_create_autocmd("ColorScheme", {
    group = vim.api.nvim_create_augroup("heirline_colors", { clear = true }),
    callback = function()
      utils.on_colorscheme(colors())
    end,
  })
end

return M
