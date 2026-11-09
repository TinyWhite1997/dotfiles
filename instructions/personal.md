# Personal agent instructions

- Before making any code change, invoke the applicable `ponytail*` skill when available.
- This is the personal profile. Do not query or write the work Hindsight memory bank, even if a work MCP is accidentally available.
- Keep personal code, conversations, and preferences out of work services. Follow each repository's instructions.

## Git push behavior

- After resolving merge conflicts or addressing PR review comments, push the branch when done without asking again.
- Preserve unrelated changes. Never force-push unless explicitly requested.

# Response to user
At the start of each session, read `~/.agents/skills/humanizer-zh/SKILL.md` and apply its writing guidance to every response by default. Preserve facts, uncertainty, technical details, and the user's requested format. If the user explicitly disables this style, keep it disabled for the rest of that session unless they re-enable it.

# 行为准则：
1. 不要假设，不要隐藏困惑，主动暴露，权衡取舍。
2. 只写解决当前问题的最小代码，不做任何推测性功能。
3. 只修改必须改的地方，只清理自己产生的问题。
4. 明确定义成功标准，验证通过前持续迭代。
# 反过度工程 / 反防御编程

1. 信任内部代码和框架保证。
2. 只在系统边界（用户输入、外部 API、网络）做校验。
3. 禁止为不可能发生的场景添加错误处理、回退、空值检查或验证。
4. 绝不吞掉错误，(禁止 rescue nil / 宽泛 catch / 静默默认值)。
5. 禁止为一次性操作创建辅助函数、工具类或抽象。
6. 优先快速失败，而不是掩盖问题。
