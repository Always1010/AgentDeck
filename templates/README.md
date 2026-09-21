# 可选内容模板

这些目录只是起点，不是工作台协议。将需要的模板复制到用户明确指定的输出目录再编辑；工作台不会执行复制或修改原文件。

- `report-single-file/index.html`：自包含报告，标题、正文和来源都在 HTML 中。
- `report-multi-file/index.html`：保留 CSS、JS、JSON 和 SVG 的完整相邻关系。先输出资源，最后完成 HTML 入口。
- `tool-static/index.html`：原生文本工具，纯浏览器执行；没有服务器和网络依赖。
- 构建工具参考 `examples/company/tool`：平台根目录运行 `npm run build:example`，完整输出到示例自己的 `dist`。自己的工程可以独立安装和构建 Vite，配置 `base: './'`，使用 hash 路由。

演示数据不能被当成真实研究结论。正文中的来源链接使用 `target="_blank" rel="noopener noreferrer"`；不要伪造来源。不要放入密钥，不要求 `artifact.json` / `sources.json`。
