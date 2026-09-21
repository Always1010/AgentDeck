# AgentDeck 本机后台运行

适合频繁更新的 Windows 试运行：程序仍从当前开发仓库的 `dist` 运行，Windows 任务计划程序负责后台生命周期，用户配置和日志写到仓库外。无需复制研究文件，也不依赖打开终端或 Codex。

## 安装与运行

在项目所在目录安装依赖后运行：

```powershell
npm ci
npm run background:install
```

安装命令构建当前代码，登记名为 `AgentDeck` 的当前用户任务并立即启动。打开 <http://127.0.0.1:4310>；预览服务在 4311，两个端口只监听本机。任务以当前用户普通权限运行，不保存密码，不请求管理员运行级别。

| 命令 | 行为 |
| --- | --- |
| `npm run background:status` | 查看任务、路径、端口和 API 就绪状态 |
| `npm run background:start` | 启动；已经运行时只检查就绪状态 |
| `npm run background:stop` | 停止当前后台实例，保留配置和日志 |
| `npm run background:restart` | 用现有构建重新启动 |
| `npm run background:update` | 停止 → 构建当前代码 → 启动 |
| `npm run background:install` | 首次安装，或更新任务中的仓库/Node 路径，并立即启动 |
| `npm run background:uninstall` | 停止并删除自启动任务，保留全部本机数据 |

也可从任意工作目录通过脚本的实际路径执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "项目所在路径\scripts\agentdeck.ps1" -Action Status`。启动脚本用自身位置计算项目根目录，服务入口也独立定位所属项目，不把某台机器的盘符、用户名或仓库路径写进源码。

任务计划程序需要记录当次安装生成的绝对路径。因此移动/重命名仓库后，在新位置重新执行 `background:install`；更换 Node.js 安装位置也一样。重新安装会保留项目登记。只支持同一 Windows 用户的一套 `AgentDeck` 后台实例。

## 数据放在哪里

| 内容 | 位置 |
| --- | --- |
| 程序源码、依赖和构建输出 | 当前仓库；`node_modules`、`dist` 已被 Git 忽略 |
| 项目、挂载、入口覆盖和内容偏好 | `%LOCALAPPDATA%\AgentDeck\state\registry.json` |
| 上次正常写入前的备份 | `registry.json.bak`，有下一次配置写入后才会生成 |
| 旧名称配置的迁移备份 | `registry.json.legacy.bak` |
| 每次启动的标准输出/错误 | `%LOCALAPPDATA%\AgentDeck\logs\时间戳.stdout.log` / `.stderr.log` |
| 启动器本身的错误 | `%LOCALAPPDATA%\AgentDeck\logs\runner.log` |
| 当前子进程身份和日志路径 | `%LOCALAPPDATA%\AgentDeck\run\process.json` |
| 自启动任务 | Windows 任务计划程序，名称 `AgentDeck` |
| 收藏和布局等浏览器偏好 | `http://127.0.0.1:4310` 的浏览器 localStorage |

这些本机数据不在 Git 工作区内，不会随正常的仓库提交或 push 上传。挂载登记会保存真实目录的绝对路径；这是本机配置中的路径，原文件继续留在原处，平台只读。迁移到另一台电脑时，需要重新定位这些挂载。

默认启动会在新注册表不存在时校验并复制 `%LOCALAPPDATA%\ProjectWorkbench\registry.json`，保留旧文件，并另存原始字节备份。已有 AgentDeck 注册表绝不被旧文件覆盖；损坏的旧配置会明确报错。使用显式 `--state-dir` 的前台服务不参与自动迁移。迁移前必须停止仍在写旧注册表的服务。

日志按启动分文件，目前不自动删除或限额轮转；可在停止服务后清理不需要的旧日志。备份用户配置只需保存 `state`，挂载的原内容仍由原目录的备份方式负责。

## 更新与自启动边界

- 任务触发点是**当前用户登录 Windows**。开机后尚未登录、退出登录或电脑关机时不提供服务；不是系统级 Windows Service。
- 运行窗口隐藏，重复任务采用 IgnoreNew；后台启动器在 Node 子进程异常退出后每隔一分钟最多重试三次，重新启动任务会重置次数；耗尽后记录日志并报错停止。启动器自身被结束不会自行恢复，需要手动启动或下次登录。取消运行时长限制，使用电池也允许运行。休眠时服务不可用，唤醒后依赖操作系统恢复。
- 修改 AgentDeck 平台代码后使用 `background:update`。更新会短暂停机；构建失败保持停止，并输出错误，不自动回滚，也不执行 `git pull` 或安装依赖。修复后重跑更新即可。
- 正式服务运行中不要直接 `npm run build` 覆盖它的静态产物。需要更新依赖时先停止，执行 `npm ci`，再执行 `background:update`。
- 原目录内容的新增、修改，以及网页新增项目/挂载，均无需重建或重启。原生 HTML 和已构建工具仍按完整目录关系读取。
- 后台服务和 `npm run dev` 默认端口相同；开发时先停止后台服务，完成后用更新命令恢复。不要让两个实例共用状态目录。
- 停止命令只处理本后台实例记录的 PID，并校验进程名称和创建时间，不按端口批量杀进程。端口被其他进程占用时启动失败，需先处理已有服务。
- 服务重启/构建更新不会自动保存工具中的未保存输入，也不自动刷新当前工具 iframe。连接恢复会按现有规则提示；浏览器主动刷新前自行保留需要的内容。

## 验证

自动测试迁移、动态目录定位、正式服务从仓库外启动及配置恢复：

```powershell
npm run background:stop
npx vitest run tests/runtime.test.ts
npm run build
npx playwright test tests/e2e/restart.spec.ts
npm run background:start
```

已安装后台任务后，可运行以下人工验收脚本。它会短暂停止/重启实际后台服务，不修改注册表；附加选项会主动结束它自己的 Node 子进程，以验证约一分钟后的自动恢复：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/windows-background.ps1 -IncludeCrashRecovery
```

实际结果见 [后台验收记录](BACKGROUND-TEST-RESULTS.md)。未实现无人登录的系统服务、跨平台后台安装器、无中断更新、自动回滚和日志限额轮转。

## 文件浏览器版本升级

`background:update` 停止旧后台前，读取它已经存在的入口记录，保存到状态目录的 `legacy-file-references.json`。新版以该映射恢复旧收藏和链接，不遍历挂载磁盘。后续再次更新会识别新版并保留已有映射。若旧实例不可用而没有生成映射，旧收藏仍保留，浏览原目录后按需关联恢复。
