# 实时聊天室

基于 WebSocket + Express + MySQL 的实时聊天系统，支持多房间群聊、在线用户列表、消息持久化和表情发送。

## 功能特性

| 功能 | 状态 | 说明 |
|------|------|------|
| 可视化聊天界面 | 已实现 | 响应式 Web 界面，适配桌面和移动端 |
| 在线用户列表 | 已实现 | 右侧面板实时显示当前频道在线成员 |
| 多人群聊 | 已实现 | 支持 room1/room2/room3 三个频道 |
| 消息持久化 | 已实现 | MySQL 存储，数据库不可用时自动降级为本地 JSON 缓存 |
| 表情发送 | 已实现 | 内置表情面板，点击插入消息 |
| 历史消息 | 已实现 | 加入频道时加载最近 50 条历史消息 |
| 一对一私聊 | 待实现 | — |
| 图片传输 | 待实现 | — |
| 管理员监控 | 待实现 | — |
| 踢出用户 | 待实现 | — |
| 禁止/允许登录 | 待实现 | — |

## 技术栈

- **前端**: HTML5 + CSS3 + Vanilla JavaScript
- **后端**: Node.js + Express
- **通信**: WebSocket (ws 库)
- **数据库**: MySQL (mysql2)，自动降级为本地文件缓存
- **反向代理**: Nginx (可选配置见 `config/nginx-chat.conf`)

## 项目结构

```
chat/
├── public/                 # 前端静态文件
│   ├── index.html          # 聊天页面
│   ├── client.js           # WebSocket 客户端逻辑
│   ├── styles.css          # 基础样式 + 移动端适配
│   ├── styles-desktop.css  # 桌面端样式
│   └── styles-mobile.css   # 移动端样式
├── src/
│   ├── server.js           # Express + WebSocket 服务端
│   └── msgBuffer.js        # 本地消息缓存（数据库降级时使用）
├── db/
│   ├── schema.sql          # 数据库建表脚本
│   └── messages-buffer.json # 运行时缓存文件
├── config/
│   └── nginx-chat.conf     # Nginx 反向代理配置
├── .env                    # 环境变量配置
├── .gitignore
├── package.json
└── README.md
```

## 快速开始

### 环境要求

- Node.js >= 16
- MySQL >= 5.7 (可选，无数据库时自动降级)

### 安装

```bash
git clone <仓库地址>
cd chat
npm install
```

### 配置

复制并编辑环境变量：

```bash
cp .env.example .env
```

`.env` 配置项：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | 服务端口 |
| DB_HOST | localhost | MySQL 地址 |
| DB_PORT | 3306 | MySQL 端口 |
| DB_USER | root | MySQL 用户名 |
| DB_PASSWORD | | MySQL 密码 |
| DB_NAME | chat_app | 数据库名 |
| MESSAGE_HISTORY_LIMIT | 50 | 加入频道时加载的历史消息条数 |
| ALLOWED_ORIGINS | * | 允许的跨域来源，逗号分隔 |

### 初始化数据库

```bash
mysql -u root -p < db/schema.sql
```

### 启动

```bash
# 生产模式
npm start

# 开发模式（自动重启）
npm run dev
```

浏览器打开 `http://localhost:3000` 即可使用。

## 使用说明

1. 输入昵称（频道内不可重复）
2. 选择频道（room1 / room2 / room3）
3. 点击「加入」连接服务器
4. 在消息框输入内容，点击「发送」或回车发送
5. 点击 😊 按钮可插入表情

## Nginx 部署（可选）

```bash
# 复制配置到 Nginx
cp config/nginx-chat.conf /etc/nginx/conf.d/chat.conf

# 重载 Nginx
nginx -s reload
```

Nginx 配置支持 WebSocket 升级和静态文件服务，适合生产环境部署。

## API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/healthz` | GET | 健康检查，返回 `{"ok": true}` |
| `/api/merge-buffer` | POST | 将本地缓存消息合并到数据库 |

## WebSocket 协议

客户端发送 JSON 消息，`type` 字段标识消息类型：

### join - 加入频道

```json
{ "type": "join", "username": "张三", "channel": "room1" }
```

### chat - 发送消息

```json
{ "type": "chat", "content": "你好！" }
```

### 服务端推送类型

| type | 说明 |
|------|------|
| `history` | 加入频道后收到的历史消息列表 |
| `chat` | 其他用户发送的聊天消息 |
| `system` | 系统通知（加入/离开等） |
| `users` | 在线用户列表更新 |
| `error` | 错误信息 |

## License

MIT
