# 提示词优化（dsh-prompt-polish）

在 DeepSeek Harness 的输入框工具栏、模型选择左侧加两个按钮：**优化** 与 **撤销**。

- **优化**：把当前草稿发给 Host，用当前会话选中的模型重写成更清晰、更具体的提示词，然后替换输入框内容。
- **撤销**：把输入框精确恢复成优化前的那一版文本；不会重新调用模型。
- **不覆盖手改**：如果优化返回前你继续打字，或优化后手动改了草稿，结果不会写入 / 撤销会拒绝执行，并明确提示原因。
- **改写强度分档**：一句话的模糊目标会扩成带分析维度、输出结构和验收标准的提示词；已经写明文件/约束/验收标准的具体请求只做轻微收紧，不塞入额外交付物。
- **防「假优化」**：如果模型只加了「请 / 麻烦 / please」这类礼貌词，会自动重试一次；仍无实质改写就报错，不会用几乎一样的文本替换草稿。

## 安装

### 通过插件面板

1. 打开 **设置 → 插件 → 添加插件**。
2. 选择本目录（含 `package.json` 的目录）。
3. 启用后刷新页面；输入框工具栏会出现「优化」按钮。

### 通过 CLI / Agent

把本目录作为 bundle 安装：

```text
plugin_manager(action: "install_bundle", target: "/绝对路径/dsh-prompt-polish")
```

安装后新会话生效；已有页面刷新一次即可加载客户端半。

## 使用

1. 在输入框写草稿（纯文本；空草稿时按钮禁用）。
2. 点「优化」。按钮显示加载动画，完成后输入框被替换。
3. 需要回退时点「撤销」。撤销窗口在以下情况关闭或失效：
   - 你手动修改了草稿（撤销按钮变灰，避免覆盖你的编辑）；
   - 草稿被发送或清空（撤销窗口关闭）；
   - 你发起了下一次优化（只保留最近一次）。
4. 优化失败时，输入框不动；输入框上方出现错误条，可关闭后重试（空白新会话页同样可见）。

草稿里含 `@文件` 引用时按钮会禁用：替换草稿会丢失引用芯片，因此宁可不让点，也不静默丢引用。

## 模型选择

优化优先使用**当前会话已选中的模型**；没有会话模型时退回 profile 的 `agent-default-model`；两者都没有时返回明确错误。可以在配置里固定润色专用的 provider/model。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖 `id: prompt-polish` 的 `config`（整体替换，覆盖时请写全想保留的字段）：

```yaml
- id: prompt-polish
  config:
    maxInputChars: 20000
    maxOutputTokens: 4096
    timeoutMs: 60000
    temperature: 0.3
    provider: ''
    model: ''
    systemPrompt: ''
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `maxInputChars` | `20000` | 单次润色的输入字符上限；超出直接拒绝，不发模型请求。范围 64–200000。 |
| `maxOutputTokens` | `4096` | 输出 token 上限。范围 64–32000。 |
| `timeoutMs` | `60000` | 端到端超时；到时中止模型请求并返回 504。范围 1000–300000。 |
| `temperature` | `0.3` | 采样温度，越低越保守。范围 0–2。 |
| `provider` / `model` | 空 | 固定润色路由；两个字段必须同时设置。留空则跟随会话模型。 |
| `systemPrompt` | 空 | 覆盖内置润色提示词；留空使用内置。上限 16000 字符。自定义后不再启用「近似无改写重试」。 |

## Agent 工具

同一操作也注册为 Agent 工具 `polish_prompt`（参数 `prompt`），与按钮共用同一段 Host 逻辑，返回润色后的纯文本。适合「帮我把这段提示词改好」这类请求。

## 请求链路

```text
浏览器按钮
  → POST api/dsh-prompt-polish/optimize   （文档相对路径，带浏览器会话）
  → 路由准入：connection.requestRejection（Host/Origin + 登录会话）
  → 解析模型：config 覆盖 → 会话模型 → profile 默认
  → llm.prepareCall → llm.stream → 拼装文本
  → 返回 { text, provider, model }
```

另有 `GET api/dsh-prompt-polish/health` 用于自检（版本、限额、固定路由）。

## 限制

- 需要 Host 的 `llm` 服务与对应 provider 凭据；没有可用模型时按钮会报错而不是静默失败。
- 每次优化通常是一次真实模型调用；首次结果近似无改写时会再调一次重试。按所选 provider 计费，不做缓存。
- 非流式：等待完整结果后一次性写入；长提示词可能等待数秒到数十秒，输入框上方会显示「正在优化提示词…」。
- 不处理草稿中的 `@文件` 引用（含引用时禁用）。
- 撤销只保留最近一次；不提供多级历史。
- 视觉验证依赖实际页面：本仓库测试覆盖 Host 核心、HTTP 路由、客户端动作与槽位注册，不替代浏览器里的肉眼检查。

## 开发与测试

```sh
npm test          # optimizer / routes / client 三组测试
npm run preflight # 清单、bundle、locale、图标、主题 token 自检
```

目录：

- `lib/optimizer.js` — 提示词、模型调用、流拼装、输出清洗
- `lib/routes.js` — HTTP 路由、准入、边界与错误映射
- `lib/tool.js` — `polish_prompt` 工具
- `lib/index.js` — 装配、模型路由解析
- `lib/client.js` — 浏览器 bundle（按钮 + 撤销 + 错误条）
- `test/` — Node 测试；`scripts/preflight.mjs` — 分发自检

## 许可

MIT © 2026 Moonlit Pages
