# Web Chat Platform

基于 WebSocket + Express + MySQL 的实时聊天系统，支持用户认证、多房间群聊、私聊、图片消息、消息回复、管理员后台等功能。

## 功能特性

| 功能 | 状态 | 说明 |
|------|------|------|
| 用户注册/登录 | 已实现 | bcrypt 密码哈希 + JWT 会话管理 |
| 可视化聊天界面 | 已实现 | 三栏响应式布局，适配桌面和移动端 |
| 在线用户列表 | 已实现 | 右侧面板实时显示当前频道在线成员 |
| 多人群聊 | 已实现 | 预置大厅/技术交流/休闲水区三个频道 |
| 消息持久化 | 已实现 | MySQL 存储，数据库不可用时自动降级为本地 JSON 缓存 |
| 表情发送 | 已实现 | 内置表情面板，点击插入消息 |
| 历史消息 | 已实现 | 加入频道时加载最近 50 条历史消息 |
| 图片传输 | 已实现 | 支持 jpg/png/gif/webp，最大 5MB |
| 消息回复 | 已实现 | 引用原消息进行回复 |
| 消息撤回 | 已实现 | 普通用户可撤回 2 分钟内自己发的消息；管理员不显示撤回按钮，使用删除代替 |
| 一对一私聊 | 已实现 | 自动创建 DM 房间，登录后自动加载已有私聊列表，对方发起私聊时双方侧边栏同步显示 |
| 管理员后台 | 已实现 | 用户管理、封禁/解封、踢出、禁言 |
| 审计日志 | 已实现 | 记录所有管理操作和登录登出 |
| 已读回执 | 已实现 | 消息已读状态记录 |
| 降级模式 | 已实现 | 数据库不可用时自动使用本地文件缓存 |

## 技术栈

- **前端**: HTML5 + CSS3 + Vanilla JavaScript（模块化）
- **后端**: Node.js + Express
- **通信**: WebSocket (ws 库)，JWT 认证
- **数据库**: MySQL (mysql2)，自动降级为本地文件缓存
- **认证**: bcrypt + jsonwebtoken
- **反向代理**: Nginx (可选配置见 `config/nginx-chat.conf`)

## 项目结构

```
web-chat-platform/
├── src/
│   ├── server.js              # 入口：HTTP + WebSocket 服务，JWT 认证
│   ├── db.js                  # 数据库连接池 + v2.0 Schema 自动建表
│   ├── msgBuffer.js           # 本地消息缓存（降级用）
│   ├── auth/
│   │   ├── middleware.js      # JWT 签发/验证 + HTTP 鉴权中间件
│   │   └── password.js       # bcrypt 密码哈希
│   ├── handlers/
│   │   ├── connection.js     # WebSocket 连接管理（频道成员/广播）
│   │   ├── chat.js           # 聊天消息处理（文本/图片/回复）
│   │   ├── room.js           # 房间加入/离开
│   │   ├── admin.js          # 管理员 WebSocket 指令（踢人/封禁/禁言）
│   │   └── dm.js             # 私聊消息处理
│   ├── routes/
│   │   ├── auth.js           # 注册/登录/登出/获取用户 API
│   │   ├── admin.js          # 管理员 API（用户管理/封禁/审计日志）
│   │   ├── upload.js         # 登录用户图片上传 API
│   │   └── health.js         # 健康检查 + 缓存合并
│   ├── services/
│   │   ├── message.js        # 消息存储/查询/已读标记
│   │   ├── ban.js            # 封禁检查/执行/解除
│   │   └── audit.js          # 审计日志记录/查询
│   └── utils/
│       └── validate.js       # 输入校验工具函数
├── public/
│   ├── index.html            # 登录/注册页
│   ├── chat.html             # 聊天主界面
│   ├── admin.html            # 管理后台
│   ├── js/
│   │   ├── auth.js           # 登录/注册/JWT 管理
│   │   ├── ws.js             # WebSocket 连接管理（自动重连）
│   │   ├── chat.js           # 聊天界面逻辑（消息渲染/回复/表情）
│   │   ├── room.js           # 频道切换/私聊列表
│   │   ├── upload.js         # 图片选择、上传和消息发送
│   │   └── admin.js          # 管理后台逻辑
│   ├── css/
│   │   └── styles.css        # 统一样式（桌面/平板/手机响应式）
│   └── uploads/              # 用户上传文件存储
├── db/
│   ├── schema.sql            # v2.0 建表 SQL（10 张表）
│   └── messages-buffer.json  # 运行时缓存文件
├── config/
│   └── nginx-chat.conf       # Nginx 配置（静态文件 + API + WebSocket）
├── .env                      # 环境变量
├── package.json
└── README.md
```

## 快速开始

### 环境要求

- Node.js >= 16
- MySQL >= 5.7 (可选，无数据库时自动降级)

### 安装

```bash
git clone git@github.com:1497105876/web-chat-platform.git
cd web-chat-platform
npm install
```

### 配置

编辑 `.env` 文件：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | 服务端口 |
| DB_HOST | localhost | MySQL 地址 |
| DB_PORT | 3306 | MySQL 端口 |
| DB_USER | root | MySQL 用户名 |
| DB_PASSWORD | | MySQL 密码 |
| DB_NAME | chat_app | 数据库名 |
| JWT_SECRET | | JWT 签名密钥（生产环境必须修改） |
| JWT_EXPIRES_IN | 7d | JWT 过期时间 |
| ALLOWED_ORIGINS | * | 允许的跨域来源，逗号分隔 |
| MAX_FILE_SIZE | 5242880 | 上传文件大小限制，默认 5MB |
| ALLOWED_FILE_TYPES | jpg,jpeg,png,gif,webp | 允许上传的图片扩展名 |

### 初始化数据库

```bash
mysql -u root -p < db/schema.sql
```

数据库表会在服务启动时自动创建（如不存在）。

### 启动

```bash
# 生产模式
npm start

# 开发模式（自动重启）
npm run dev
```

浏览器打开 `http://localhost:3000` 进入登录页。

## 使用说明

### 普通用户

1. 在登录页注册账号或登录
2. 进入聊天页后，点击左侧频道加入群聊
3. 在消息框输入内容，点击「发送」或回车发送
4. 点击消息右上角「回复」可引用回复
5. 点击左侧「+ 新私聊」可发起一对一私聊
6. 点击 😊 按钮可插入表情

### 管理员

1. 使用管理员账号登录（角色为 `admin` 或 `super_admin`）
2. 聊天页顶部出现「管理」按钮，点击进入管理后台
3. 用户管理：搜索用户、调整角色、封禁/解封
4. 审计日志：查看所有操作记录，支持按操作类型筛选

## API

### 认证 API

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/api/auth/register` | POST | 注册新用户 | 否 |
| `/api/auth/login` | POST | 登录（返回 JWT） | 否 |
| `/api/auth/logout` | POST | 登出 | Bearer |
| `/api/auth/me` | GET | 获取当前用户信息 | Bearer |

### 上传 API（需登录）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/upload` | POST | 上传图片文件，表单字段名为 `file` |

### 管理员 API（需 admin 角色）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/admin/users` | GET | 用户列表（分页+搜索） |
| `/api/admin/users/:id` | PUT | 修改用户角色/状态 |
| `/api/admin/ban` | POST | 封禁用户 |
| `/api/admin/ban/:id` | DELETE | 解除封禁 |
| `/api/admin/room/:id/mute` | PUT | 禁言/解除禁言 |
| `/api/admin/room/:id/kick` | DELETE | 踢出用户 |
| `/api/admin/logs` | GET | 审计日志（分页+筛选） |

### 其他

| 端点 | 方法 | 说明 |
|------|------|------|
| `/healthz` | GET | 健康检查 |
| `/api/merge-buffer` | POST | 将本地缓存消息合并到数据库 |

## WebSocket 协议

连接地址: `ws://host/ws?token=<JWT>`

### 客户端 → 服务端

| type | 参数 | 说明 |
|------|------|------|
| `join` | `{ channel }` | 加入频道 |
| `leave` | | 离开当前频道 |
| `chat` | `{ content, contentType, replyTo? }` | 发送消息 |
| `dm` | `{ targetUserId }` | 发起私聊 |
| `recall` | `{ messageId }` | 撤回本人消息（普通用户，2 分钟内） |
| `read` | `{ lastMessageId }` | 上报已读 |
| `admin:kick` | `{ userId, roomId }` | 踢出用户 (管理员) |
| `admin:ban` | `{ userId, reason, expiresAt? }` | 封禁用户 (管理员) |
| `admin:mute` | `{ userId, roomId, muted }` | 禁言/解除 (管理员) |

### 服务端 → 客户端

| type | 说明 |
|------|------|
| `auth_ok` / `auth_fail` | 认证结果 |
| `history` | 加入频道后收到的历史消息 |
| `chat` | 新聊天消息（含 id、replyTo） |
| `system` | 系统通知 |
| `users` | 在线用户列表 |
| `dm:open` | 私聊房间信息（发起者自动切换，对方仅加入列表） |
| `dm:list` | 登录后推送已有私聊房间列表 |
| `msg_deleted` / `recall_ok` | 消息被撤回或撤回成功 |
| `kicked` | 被踢出通知 |
| `banned` | 被封禁通知 |
| `error` | 错误信息 |

## Nginx 部署（可选）

```bash
cp config/nginx-chat.conf /etc/nginx/conf.d/chat.conf
# 编辑 server_name 和 root 路径
nginx -s reload
```

配置包含静态文件、API 代理和 WebSocket 升级支持。

## 数据库

使用 v2.0 Schema，共 10 张表：

| 表名 | 说明 |
|------|------|
| `users` | 用户表（含角色、状态） |
| `rooms` | 房间表（public/private/dm） |
| `room_members` | 房间成员（含禁言状态） |
| `messages` | 消息表（JSON 内容，支持回复） |
| `message_reads` | 消息已读记录 |
| `user_bans` | 用户封禁记录 |
| `audit_logs` | 审计日志 |
| `attachments` | 附件记录 |
| `user_sessions` | 用户会话 |
| `room_invitations` | 房间邀请 |

