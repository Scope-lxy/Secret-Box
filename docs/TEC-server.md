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

内容池支持私密文案、私密音频、私密图册、心笺和文章。普通内容支持单条新增与批量导入；文章支持编辑、公众号 URL 异步导入，以及标准 MD / Markdown / TXT 文件夹导入。字段、接口、去重、重试和实现速查统一见[内容导入说明](TEC-content-import.md)，文件格式和运营规则以[文章文档批量导入规范](PRD-文章文档批量导入.md)为准。

服务端负责 AppID 会话校验、数据范围校验、内容与广告配置、内容安全和管理后台 API。普通本地图片由浏览器直传 COS 并登记素材；公众号 URL 与文章文档中的远程正文图、封面均由服务端校验、下载后转存 COS。音频经服务端处理后写入 COS；具体上传和封面规则见[内容导入说明](TEC-content-import.md)。

## Content List Randomization

文章和心笺列表的 `random` 模式由服务端生成用户级顺序。第 1 页请求按小程序实例、内容池、内容类型和用户生成新种子；第 2 页及后续页面复用同一进程内的种子，因此不需要旧版小程序新增参数。用户主动下拉刷新会重新请求第 1 页并换序，`sequence` 模式继续按入库顺序倒序。

文章详情“继续阅读”将内容池的 30 分钟窗口种子与当前文章 ID 组合，分别生成每篇文章的推荐顺序。同一篇文章在缓存窗口内供所有用户复用；从全内容池排除当前文章后随机选取最多 200 条，每页最多 20 条，可继续下滑至本轮推荐末尾，不循环。响应中的 `recommendationPagination.seed` 原样用于后续分页，即使窗口到期，内容集合不变时仍沿用原顺序。推荐广告继续按客户端原有配置和累计列表位置插入。

排序使用种子和内容 ID 计算稳定排名，并在内存中缓存已排好的 ID。实现、容量边界、服务重启影响和验收记录统一见[内容列表随机与推荐顺序说明](TEC-content-randomization.md)。本次改动只需部署并重启 Admin 服务，不需要重新构建或上传小程序。
