local M = {}

---Merge an AstroNvim-derived preset with local overrides.
---Plugin defaults remain the final fallback inside each plugin's setup().
---@param preset table|nil
---@param local_opts table|nil
---@return table
function M.merge(preset, local_opts)
  return vim.tbl_deep_extend("force", {}, preset or {}, local_opts or {})
end

function M.list_insert_unique(list, additions)
  local seen = {}
  local result = {}
  for _, value in ipairs(list or {}) do
    if value and not seen[value] then
      seen[value] = true
      result[#result + 1] = value
    end
  end
  for _, value in ipairs(additions or {}) do
    if value and not seen[value] then
      seen[value] = true
      result[#result + 1] = value
    end
  end
  return result
end

function M.is_valid_buffer(bufnr)
  bufnr = bufnr or 0
  return vim.api.nvim_buf_is_valid(bufnr)
    and vim.bo[bufnr].buflisted
    and vim.bo[bufnr].buftype == ""
    and vim.api.nvim_buf_get_name(bufnr) ~= ""
end

function M.is_large_buffer(bufnr)
  bufnr = bufnr or 0
  if vim.b[bufnr].large_buf ~= nil then
    return vim.b[bufnr].large_buf
  end
  local ok, stat = pcall(vim.uv.fs_stat, vim.api.nvim_buf_get_name(bufnr))
  local large = ok and stat and stat.size > 256 * 1024 or vim.api.nvim_buf_line_count(bufnr) > 10000
  vim.b[bufnr].large_buf = large and true or false
  return vim.b[bufnr].large_buf
end

function M.toggle_option(name)
  vim.opt[name] = not vim.opt[name]:get()
  vim.notify(("%s: %s"):format(name, tostring(vim.opt[name]:get())))
end

return M
