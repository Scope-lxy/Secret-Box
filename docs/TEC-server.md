# Server

Node.js backend for the MiniApp project.

## Local Run

```bash
cd admin/server
npm run dev
```

Health check:

```bash
curl http://127.0.0.1:3000/api/health
```

产品需求见[后台 PRD](PRD-轻读手记后台.md)与[小程序 PRD](PRD-轻读手记小程序端.md)。

## Data Scope Protocol

小程序会话按 AppID 校验；用户资料、签到、打开记录、互动、收藏和留言等数据按 `dataScopeId` 共享或隔离；运营访问与行为统计仍按 `miniProgramId` 归属。

客户端先请求 `GET /api/miniapp/config` 取得当前 `dataScopeId`。`POST /api/miniapp/session` 以及所有会写入用户数据的请求，都必须在 `x-miniapp-data-scope` 请求头中回传该值。请求头缺失、过期或伪造时，服务端返回 `409 DATA_SCOPE_CHANGED`，不执行写入，也不产生部分副作用。客户端可以刷新配置，但不得自动重放这次被拒绝的写操作。

本协议没有旧客户端兼容层。不发送 `x-miniapp-data-scope` 的旧客户端仍可能使用公开读请求，已有效会话的受保护读请求也可能成功；但它不能创建新会话，也不能执行受数据范围保护的写操作。后端与小程序必须配套发布。

## Production

生产环境使用 `../admin/deploy/` 下的 Compose、Dockerfile 和环境变量示例；微信审核、发布、隐私保护指引和合法域名状态仍以微信公众平台为准。

`npm run db:backup` 默认不可执行。只有运维人员明确设置位于活动数据目录之外的 `MINIAPP_BACKUP_DIR` 时才允许手动备份；不得将备份写入 `admin/server/data`、生产数据卷或其子目录。

需要在发布前清除开发期用户数据时，先停服务并确认数据库已是 schema v6，再显式执行 `npm run db:clear-user-data`。该命令只清理账号、身份、资料、会话、签到、留言、互动、文章解锁、打开记录、分析和幂等数据；保留 Admin/运行配置、内容池、文章导入任务、图片与音频素材引用，不创建备份，也不操作 COS。

## Content Creation and Import

内容池支持私密文案、私密音频、私密图册、心笺和文章。普通内容支持单条新增与批量导入；文章支持编辑和微信公众号 URL 异步导入。字段、格式、去重、重试和接口速查统一见 `TEC-content-import.md`。

服务端负责 AppID 会话校验、数据范围校验、内容与广告配置、内容安全和管理后台 API。普通本地图片由浏览器直传 COS 并登记素材；公众号文章导入的远程正文图和封面由服务端校验、下载后转存 COS。音频经服务端处理后写入 COS；具体上传和封面规则见 `TEC-content-import.md`。
