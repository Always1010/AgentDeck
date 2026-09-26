# AgentDeck 后端说明

本文按当前实现（`app/server` 与 `app/shared/model.ts`）整理 AgentDeck 的本地后端职责、HTTP 接口和约束。它是面向本机工作台前端的接口说明，不是对外开放的 Web API。

## 1. 架构与职责

后端由 Fastify 创建两个仅监听 `127.0.0.1` 的服务：

| 服务 | 默认地址 | 职责 |
| --- | --- | --- |
| 主服务 | `http://127.0.0.1:4310` | 提供工作台静态页面、项目和挂载管理、文件树与文本读取、下载、工具登记、SSE 状态通知。 |
| 预览服务 | `http://127.0.0.1:4311` | 在受限边界内提供已挂载目录的 HTML 与静态资源，并为 HTML 临时注入工作台桥接脚本。 |

启动入口为 `app/server/main.ts`。可通过 `--state-dir`、`--port` 和 `--preview-port` 调整状态目录与端口；默认状态文件为：

- Windows：`%LOCALAPPDATA%\AgentDeck\state\registry.json`
- 其他系统：`~/.local/share/AgentDeck/state/registry.json`

首次使用默认状态目录启动时，服务会尝试迁移旧 `ProjectWorkbench/registry.json`，保留旧文件，并在新目录额外保存 `.legacy.bak` 备份。

### 核心能力

1. **项目与挂载登记**：维护项目、目录挂载、工具入口覆盖和文件显示偏好；不会移动、改写或删除用户挂载的源文件。
2. **安全的目录访问**：对每次目录、文件、下载和预览请求都验证挂载状态、相对路径、真实路径与排除规则；禁止符号链接/junction、UNC 路径、敏感目录、隐藏文件及密钥等。
3. **文件浏览与阅读支撑**：按需列出单层目录、读取受支持的文本文件、提供下载，并生成稳定的文件引用与预览地址。
4. **HTML 报告/工具预览**：维持相对资源路径；在响应过程中注入桥接脚本，不写回源 HTML。桥接脚本用于 iframe 内的焦点、滚动和工作台快捷键协调。
5. **工具分类**：将指定 HTML 文件登记为“工具”，也支持单工具挂载、历史登记和每个工具根目录的入口覆盖；工具分类本身不递归扫描挂载目录。
6. **配置可靠性**：配置变更串行执行，写入临时文件后替换 `registry.json`，并保留 `.bak`。注册表损坏时服务报错停止，不以空配置覆盖原文件。

## 2. 通用约定

### 请求边界

- 管理接口均位于主服务的 `/api` 下，只接受 `Host: 127.0.0.1:<主端口>`。
- 浏览器请求还必须是同源（`Origin` 为主服务地址且 `Sec-Fetch-Site: same-origin`）。写操作另要求 `Content-Type: application/json` 和 `X-Workbench: 1`，用于 CSRF 防护。
- API 不提供登录、会话、Cookie 或跨域访问；设计前提是单用户本机工作台。
- 预览服务与主服务是不同来源。预览资源在 sandbox CSP 内运行，且只对来自主服务的请求回送 CORS 响应头。

### 标识和路径

- `:id` 为项目或挂载 ID 时，使用 UUID。
- 文件 ID 使用可逆格式 `file:<mountId>:<relativePath>`；放进 URL 路径时需进行 URL 编码。例如：`file:8b...:reports/index.html`。
- `relativePath`、`path`、`entry`、`toolRoot` 使用 `/` 分隔的相对路径，不允许空路径（部分目录接口除外）、`..`、`.`、反斜杠、盘符、空字节或 Windows 末尾点/空格。
- 目录挂载仅允许本机磁盘的绝对路径，不支持 UNC；不能是盘符根目录、用户主目录、系统敏感目录、状态目录及其祖先/子孙，且不跟随 symlink/junction。

### 通用错误格式

所有异常以 JSON 返回：

```json
{
  "error": {
    "code": "INVALID_PATH",
    "message": "需要安全的相对路径，不能越界"
  }
}
```

常见状态码：`400` 输入无效、`403` 路径/来源不可信、`404` 项目/挂载/文件不存在、`409` 挂载目录重叠、`410` 挂载已停用、`413` 文本超过大小限制、`415` 不是可读取文本、`503` 挂载目录离线。未捕获错误为 `500`。

### 主要数据模型

| 模型 | 字段 |
| --- | --- |
| `Project` | `id`、`name`、`order` |
| `Mount` | `id`、`projectId`、`label`、`absolutePath`、`mode`、`toolDirectories`、`excludes`、`entry`、`enabled` |
| `Entry` | `id`、`projectId`、`mountId`、`title`、`kind`、`format`、`relativePath`、`resourceRoot`、`updatedAt`、`fileVersion`、`refreshMode`、`status`，HTML 条目还会带 `previewUrl` |

`mode` 仅为 `content`、`tool-library`、`single-tool`；`kind` 仅为 `html`、`tool`、`markdown`、`text`、`data`。新建挂载的默认值是 `mode: "content"`、`entry: "index.html"`、`toolDirectories: []`、`excludes: []`、`enabled: true`。

## 3. 主服务 API

下表中的响应仅列出核心字段；除特别说明外，成功状态码为 `200`。

### 服务状态与事件

| 方法与路径 | 作用 | 响应要点 |
| --- | --- | --- |
| `GET /api/status` | 读取服务基本状态。 | `{ previewOrigin, revision, schemaVersion: 1, navigation: "files" }` |
| `GET /api/legacy-files` | 返回旧版不可逆 ID 到新文件引用的迁移映射。 | `{ "<legacyId>": "file:<mountId>:<path>" }` |
| `GET /api/events` | 建立 SSE 连接，获知登记配置变化。 | 首先推送 `resync` 事件；变更后推送 `registry-changed`，数据均为 `{ revision }`；每 15 秒发送心跳注释。 |

每个会导致注册表写入的 API 成功后都会增加 `revision` 并广播 `registry-changed`。SSE 客户端积压超过 1 MiB 会被服务端关闭。

### 项目与挂载管理

| 方法与路径 | 请求体或参数 | 作用与响应 |
| --- | --- | --- |
| `GET /api/projects` | — | 返回 `{ projects, mounts, revision }`。项目按 `order` 排序；每个挂载额外带 `status: online \| offline \| disabled`，离线时带 `error`。 |
| `POST /api/projects` | `{ name, order?, mount? }`；可选 `mount` 为下文挂载创建字段。 | 新建项目，可同时新建一个挂载；返回新 `Project`。未传 `order` 时使用当前项目数量。 |
| `PATCH /api/projects/:id` | `{ name?, order? }` | 更新项目名称或排序；返回更新后的 `Project`。 |
| `DELETE /api/projects/:id` | — | 移除项目及其挂载、工具入口覆盖；不删除任何实际目录或文件。返回 `{ ok: true }`。 |
| `POST /api/projects/:id/mounts` | `{ label, absolutePath, mode?, toolDirectories?, excludes?, entry?, enabled? }` | 为已有项目添加挂载；返回新 `Mount`。 |
| `PATCH /api/mounts/:id` | 上述挂载字段的任意子集。 | 更新挂载并重新校验路径；返回更新后的 `Mount`。 |
| `DELETE /api/mounts/:id` | — | 取消挂载并清理其工具入口覆盖；不删除目录或文件。返回 `{ ok: true }`。 |
| `PUT /api/mounts/:id/tool-override` | `{ toolRoot, entry }` | 指定挂载内某工具根目录的 HTML 入口；替换同一 `toolRoot` 的旧覆盖。`entry` 必须是 `.html/.htm`。返回 `{ ok: true }`。 |

创建或更新挂载时，服务会验证入口是 HTML、工具目录相互不重叠，且同一项目中不得存在彼此包含的挂载目录。`absolutePath` 会被解析为真实路径后保存。

### 本机目录选择

| 方法与路径 | 参数 | 作用与响应 |
| --- | --- | --- |
| `GET /api/fs/locations` | — | 返回目录选择器的起始位置：`{ locations: [home, cwd, ...可访问盘符] }`。 |
| `GET /api/fs/directories` | `?absolutePath=<本机绝对路径>` | 返回该目录的直接、非隐藏、非符号链接子目录：`{ current, parent, directories: [{ name, path }] }`。 |

该组接口只辅助选择挂载目录，不会创建目录，也不会返回文件列表。

### 文件与目录

| 方法与路径 | 参数 | 作用与响应 |
| --- | --- | --- |
| `GET /api/mounts/:id/tree` | `?path=<相对目录>`，省略时为挂载根目录。 | 读取一层目录，返回 `TreeItem[]`：`{ name, relativePath, directory, legacyIds? }`。目录在前；HTML、CSV、Markdown 随后；再按自然排序。 |
| `GET /api/entries/:id` | `:id` 为文件引用或可恢复的旧 ID。 | 获取单个文件元信息 `Entry`，并追加 `previewUrl`。目录会返回 `400`。 |
| `GET /api/mounts/:id/file` | `?path=<相对文件路径>` | 读取文本，返回 `{ text, size, updatedAt }`。文件大于 10 MiB 返回 `413`；二进制或不受支持的文本类型返回 `415`。 |
| `GET /api/mounts/:id/download` | `?path=<相对文件路径>` | 以 `application/octet-stream` 和附件文件名流式下载任意允许的普通文件。 |
| `PATCH /api/entries/:id/preferences` | `{ title?, kind?, refreshMode? }` | 保存条目的显示偏好；`refreshMode` 为 `auto` 或 `prompt`。返回 `{ ok: true }`。 |

文本读取支持 HTML、CSS、JavaScript/TypeScript、JSON、CSV、Markdown、TXT、常见代码和配置文件等。文件树和读取均不会递归遍历目录；下载可用于不支持预览或文本读取的允许文件。

### 工具分类

| 方法与路径 | 请求体或参数 | 作用与响应 |
| --- | --- | --- |
| `GET /api/tools` | — | 返回工具列表 `[{ id, title }]`。来源包括显式登记、单工具挂载、入口覆盖和可恢复的历史登记。 |
| `PUT /api/tools` | `{ id, title? }` | 将一个存在的 HTML 条目登记为工具；`title` 长度为 1–200（可选）。返回 `{ id }`。 |
| `DELETE /api/tools/:id` | `:id` 为文件引用。 | 取消工具分类，实际文件保留。返回 `{ ok: true }`。 |

工具列表只根据登记数据和历史映射恢复，不会为发现工具而扫描文件系统。显式移除会覆盖旧版工具登记。

## 4. 预览服务 API

预览服务不提供 `/api` 管理接口，只提供下列 `GET`/`HEAD` 资源端点：

| 方法与路径 | 作用 |
| --- | --- |
| `GET /__agentdeck/bridge.js` | 返回运行时注入到 HTML 文档中的工作台桥接脚本。 |
| `GET` 或 `HEAD /m/:id/*` | 在挂载 `:id` 中读取资源；目录请求会补充尾随 `/` 并加载其 `index.html`。 |

预览支持 HTML、CSS、JS、JSON、CSV、图片、字体、PDF、音视频等已列入 MIME 白名单的类型。未知类型不提供预览。若资源是 HTML，服务会在响应流中注入 `<script src="/__agentdeck/bridge.js"></script>`：

- 不改写源文件，下载和源码读取保持原始内容；
- 保留原编码，并只检查最多 64 KiB 的文档前缀来确定安全插入点；
- `HEAD` 只返回头部，不传输正文；
- 预览地址由文件元信息中的 `previewUrl` 提供，格式为 `http://127.0.0.1:<预览端口>/m/<mountId>/<相对路径>`。

## 5. 安全与运行限制

- 所有响应使用 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer` 及受限 `Permissions-Policy`。
- 主服务采用严格 CSP；预览服务采用允许页面自身资源加载、但仅允许被主服务 iframe 嵌入的 sandbox CSP。预览 HTML 是可信本地内容模型，不是多租户隔离边界。
- 默认隐藏/拒绝 `.git` 等点目录、`node_modules`、`__pycache__`、`coverage`、`credentials`、`secrets`、锁文件、私钥/证书和用户配置的 `excludes`。
- 挂载一旦停用，所有解析请求会返回 `410 MOUNT_DISABLED`；物理目录不可读时通常返回 `503 MOUNT_OFFLINE`。
- 不支持根绝对资源路径、服务端路由、Service Worker、UNC 共享或自动构建/执行挂载目录中的项目脚本。

## 6. 代码定位

### 文件更新与未读记录

`app/server/updates.ts` 提供单实例文件变更检测。首次由界面初始化共享文件类型筛选，此后服务启动自动恢复。文件树仍按需读取；更新检测在建立基线、筛选范围变化、挂载变化及每 5 分钟核对时遍历允许访问的目录，仅读取元数据，不解析正文或标题。每个允许目录使用系统目录通知，650 ms 合并事件，普通文件变化只核对对应路径。超过 1000 个待处理路径合并为该挂载的一次核对。排除目录和符号链接不进入扫描，也不建立监听。

状态原子保存到状态目录的 `file-updates.json`，独立于注册表。首次存量文件不产生未读；筛选重新纳入的类型建立当前基线，已有未读保留。服务停止期间的变化通过启动核对补充，不能恢复已经删除的短暂文件及所有中间版本。记录损坏时保留原文件并向界面报告，不覆盖为空状态。无法访问的目录保留旧记录，核对时重试。

| 方法与路径 | 作用 |
| --- | --- |
| `GET /api/file-updates` | 返回共享 `filter`、`initialized`、`busy`、`errors`、未读总数 `total`、最新 200 条 `items` 和确认水位 `through`。 |
| `PUT /api/file-updates/filter` | `{ filter, initializeOnly? }`；完整保存现有 all/allow/deny 筛选，`initializeOnly` 仅供首个客户端迁移旧浏览器偏好。 |
| `POST /api/file-updates/read` | `{ id, version }` 确认单文件的实际已读版本，或 `{ through }` 确认该水位之前、当前筛选范围内的未读；后续版本保留。 |

SSE 新增 `file-updates` 失效通知，客户端重新拉取快照；连接恢复也重新拉取，不依赖逐条事件重放。读取正文的响应增加可选 `fileVersion`，只有读取前后版本稳定才提供。HTML 的注入桥接脚本携带文件版本，`ready` 消息返回该版本和页面路径；阅读区确认来源、iframe、实际路径、加载完成及版本一致后才标记已读，不修改 HTML 地址。HTML 预览接口也接受可选 `fileVersion` 查询参数，版本不匹配返回 409。

| 位置 | 说明 |
| --- | --- |
| `app/server/server.ts` | 两个 Fastify 服务、全部路由、HTTP 安全头与错误处理。 |
| `app/server/path-policy.ts` | 路径归一化、挂载边界、敏感文件过滤与 MIME 白名单。 |
| `app/server/registry.ts` | 注册表加载、串行修改、原子替换与备份。 |
| `app/server/files.ts` | 文件类型判断、条目元信息和旧 ID 兼容。 |
| `app/server/tools.ts` | 工具列表合成逻辑。 |
| `app/server/html-bridge.ts` | HTML 流式注入与 iframe 桥接脚本。 |
| `app/shared/model.ts` | Zod 请求/注册表校验规则和共享 TypeScript 类型。 |

接口行为的回归用例主要在 `tests/http.test.ts`、`tests/files.test.ts`、`tests/tools.test.ts` 与 `tests/security.test.ts`。
