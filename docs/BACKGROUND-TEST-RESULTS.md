# AgentDeck 后台运行验收

日期：2026-09-21。环境：Windows 10 19045、Node.js 24.20.0、npm 11.19.0、系统 Windows PowerShell；实际安装任务名 `AgentDeck`。

## 已通过

- `npm run typecheck`：通过。
- `npm test`：7 个测试文件、15 项测试通过，其中 4 项覆盖 AgentDeck 数据路径、搬到含空格目录后的源码/编译入口定位、旧配置逐字节迁移、不覆盖已有新配置、损坏旧配置拒绝迁移。
- `npm run build`：通过。保留依赖注释及约 507 kB 前端主包提示，不影响构建成功。
- `npx playwright test tests/e2e/restart.spec.ts`：1 项通过。实际子进程使用仓库之外的临时目录作为 cwd，正式页面可用；项目/挂载 ID 和入口偏好经重启保留，离线目录记录保留，占用端口时新实例退出。
- 系统 Windows PowerShell 实际运行 `background:install` 成功：任务以当前用户 InteractiveToken、普通权限登记，触发器为该用户登录，IgnoreNew，运行时间限制为 PT0S，电池供电不阻止/中断运行。
- 从仓库外的临时工作目录调用管理脚本，仍定位到脚本所属仓库；没有在源码中写死本机仓库或 Node 路径。任务动作中的绝对路径来自安装时动态计算。
- 实际迁移旧注册表：1 个项目、1 个挂载、revision 1；旧文件、新注册表和 `registry.json.legacy.bak` 的 SHA-256 一致。原配置文件保留，未修改挂载原内容。
- `tests/windows-background.ps1 -IncludeCrashRecovery`：通过。重复 Start 保持同一 PID；Stop 后原 Node 子进程结束，4310/4311 均可重新绑定；重新启动后首页及其真实编译 JS 资源返回 200，项目与挂载 ID 不变，注册表哈希不变。
- 强制结束记录且校验身份的后台 Node 子进程后，后台启动器 **66 秒**恢复服务，两个端口及静态资源恢复，注册表不变。恢复后的错误日志为空。
- `npm run background:update`：实际完成停止 → 正式构建 → 后台启动；首页 200，1 个项目和 1 个挂载仍在，注册表哈希不变。之后 `npm run background:status` 返回 Running，4310/4311 均可访问，API 就绪。
- 后台实例由 Windows 登录任务持有，验收命令结束后仍运行；状态、日志、进程记录均写在 `%LOCALAPPDATA%\AgentDeck`，Git 工作区没有新增运行数据。

## 实测后调整

初版尝试直接依赖 Windows Task Scheduler 的 RestartOnFailure。测试发现 Windows PowerShell 返回的子进程 ExitCode 可能为空，导致任务被记为成功；明确返回失败后，本机手动启动的任务仍未在测试等待期内重新启动。最终移除该重试设置，改由同一个后台启动器等待 Node 并负责 60 秒间隔、最多三次重试；任务计划程序负责登录启动和单实例管理。上述 66 秒恢复结果来自最终启动器实现，不把任务属性存在当成恢复成功。

## 未验证与限制

- 未实际重启电脑或退出/重新登录，未中断用户会话；登录触发器已读取核对，实际按需启动与后台运行已验证。
- 未实际移动当前仓库或更换 Node 安装位置。移动目录定位由临时含空格路径测试覆盖；真实系统任务移动后重新安装的完整流程尚未实测。
- 未长时间运行、休眠唤醒或实测电池切换；未实测连续四次崩溃耗尽重试、构建失败及卸载流程。
- 未实现无人登录的系统级 Windows Service、启动器自身被杀后的自动恢复、无中断更新、构建回滚、日志限额轮转、macOS/Linux 后台安装器。
- 此次只重跑了相关正式模式重启测试，未重跑全部浏览器用例；既有界面验收见 [TEST-RESULTS](TEST-RESULTS.md)。
