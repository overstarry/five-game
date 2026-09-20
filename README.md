# 五子棋

仅支持人与 TypeSafe AI 对弈。React + TypeScript 前端，Node.js + Express 服务端；需要 Node.js 22.12+。

## 启动

```powershell
npm install
Copy-Item .env.example .env
```

在 `.env` 填入从 [TypeSafe 控制台](https://console.typesafe.ai/home) 获取的 `TYPESAFE_API_KEY`，然后启动：

```powershell
npm run dev
```

访问 http://127.0.0.1:3000。未配置密钥时仍可查看界面，但无法开始对战。配置变化需要重启服务。“已配置”只表示服务端存在密钥，实际权限与连通性在落子时验证。

## 功能和规则

- 15×15 自由规则五子棋，黑棋先行，连续五子或以上获胜，无禁手。
- 可选择先后手、显示手数、悔棋、重开，自动保存当前棋局到浏览器。
- 悔棋撤销最近一次玩家落子及其后的 AI 落子；AI 思考中也可悔棋或重开。
- 方向键移动棋盘焦点，回车或空格落子。
- AI 请求失败保留局面，可手动重试。刷新恢复到 AI 回合时需点击继续，避免意外重复收费请求。

## AI 接入

依据 [TypeSafe Quick Start](https://docs.typesafe.ai/introduction/quickstart) 与 [Choice 文档](https://docs.typesafe.ai/primitives/choice)，服务端请求 `POST https://api.typesafe.ai/v1/systemone`，默认模型 `jev-latest`。把棋盘、历史与所有合法落点传入 Choice，读取 `answers.move.choice`。本地只计算规则与即时胜负提示，最终落点由模型选择；失败不会回退成本地 AI。

密钥仅由服务端读取，不返回客户端、不保存到浏览器。AI 上游超时 25 秒，不自动重试；返回非法或已占用落点会报错。服务端重放棋谱验证合法性，并限制同时进行的 AI 请求数为 4。

当前是默认只监听本机的单用户应用；公开部署前需要增加用户鉴权、按用户配额/速率限制及预算控制。此版本没有用户系统或多人房间。

## 验证与生产构建

```powershell
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm start
```

单元与接口测试使用模拟 TypeSafe 响应，浏览器测试覆盖未配置、对弈、失败重试、悔棋、恢复、请求取消和移动端布局。真实 TypeSafe 联调需要有效密钥；模拟测试通过不代表真实模型调用已验证。

生产启动先执行构建。前端与 API 使用同一个端口，`PORT` 默认 `3000`，`HOST` 默认 `127.0.0.1`。标题字体从 Google Fonts 加载，离线时回退本机衬线字体，不影响游戏。
