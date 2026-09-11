# 轻读手记（Secret Box）1Panel 生产部署手册

最后一次已记录验证快照：2026-09-11，镜像 `secretbox-api:2026.09.11-03`，对应提交 `2e4ec47`。本文是「轻读手记」（Secret Box）现役生产部署规范，主生产站点为 `https://secretbox.scopeview.cn`；`letterbox.scopeview.cn` 与 COS `/letterbox/` 对象地址仍在兼容和素材链路中，不得按名称自行清理。

## 生产基线

- 管理后台：`https://secretbox.scopeview.cn/admin/`
- API：`https://secretbox.scopeview.cn/api/`
- 健康检查：`https://secretbox.scopeview.cn/api/health`
- 根路径：`https://secretbox.scopeview.cn/` 应跳转至 `/admin/`
- 最后一次已记录的 v6 验证快照使用镜像 `secretbox-api:2026.09.11-03`，容器状态为 `running / healthy`，线上健康检查返回 `database: ok`；本次发布更新后台静态样式，保留生产数据、运行配置和上传密钥。发布前后 schema v6 只读摘要一致。
- 生产数据库仅接受 schema v6；数据目录应只保留 `secretbox.sqlite` 与 `miniapp-upload-keys/`，每次发布均以当次只读验库为准。
- 实例数、模式、内容池、广告与其他业务配置以 Admin 运行态为准，发布不得擅自改写。
- 数据库只支持 schema v6：新库直接初始化完整 v6 结构，现有活动库必须已是 v6。生产 v5→v6 一次性迁移已经完成，不得再次执行；生产不提供运行时旧库兼容或旧库恢复，旧版数据库不得进入部署包或生产目录。
- 站点、反向代理和 HTTPS 证书均由 1Panel UI 管理；不手工维护第二套站点或证书配置。
- 上次验收记录包括：根路径返回 302 并跳转 `/admin/`，Admin 返回 200 且侧栏标题为居中的“管理后台”，健康检查返回 200；公开配置、首页、心笺和文章 API 正常，旧日记 API 返回 404。发布前仍须按下文重新执行站点、API、数据库和权限检查；本文不把上次记录视为今日已验证状态。
- 服务端部署不等于上传或发布微信版本，开发版、体验版、审核和正式版状态均以微信公众平台为准。

## 目录与 Compose

```text
/opt/secretbox/
  app/          # 服务端源码和 secretbox.Dockerfile
  miniprogram/  # 用于上传微信开发版的小程序源码
  data/         # 唯一活动数据库 secretbox.sqlite、上传密钥和运行素材
  runtime.env   # 生产环境配置，权限 600

/opt/1panel/docker/compose/secretbox/
  compose.yaml  # 唯一现役 Compose 文件
```

- 现役 Compose：`/opt/1panel/docker/compose/secretbox/compose.yaml`
- 服务容器：`secretbox-api`，只映射 `127.0.0.1:3101`
- `admin/server/` 中的服务端文件部署到 `/opt/secretbox/app/`。
- `admin/deploy/secretbox.Dockerfile` 部署为 `/opt/secretbox/app/secretbox.Dockerfile`；Compose 的 build context 是 `/opt/secretbox/app`。
- `miniprogram/` 部署到 `/opt/secretbox/miniprogram/`，供 Admin 的小程序上传功能读取。
- 应用源码只部署到 `/opt/secretbox/app`，运行 Compose 不放在该目录。
- 仓库唯一部署模板：`../deploy/secretbox.1panel.compose.yaml`，部署时复制为上述 `compose.yaml` 后由 1Panel 的“通过路径创建 Compose”管理。
- 每次发布前必须递增 `image` 标签（日期加序号）；不得覆盖已验证镜像标签。服务端依赖在镜像构建时按锁文件安装。

发布后按本次变更范围进行线上验收；小程序页面正文与广告配置并行请求，正文不等待微信广告素材；原生广告由微信组件异步填充，页面不使用额外的广告预加载、固定占位高度或广告曝光节流逻辑。验收应确认广告配置可读、列表内容正常显示，广告素材加载失败时不影响正文使用。

## 首次部署

1. 将 `admin/server/` 的内容部署到 `/opt/secretbox/app/`，将 `admin/deploy/secretbox.Dockerfile` 部署为 `/opt/secretbox/app/secretbox.Dockerfile`，将 `miniprogram/` 部署到 `/opt/secretbox/miniprogram/`。
2. 在服务器创建 `/opt/secretbox/runtime.env`，设置为 `600`，仅保存生产配置和密钥。
3. 将仓库的 `secretbox.1panel.compose.yaml` 部署为唯一现役 `compose.yaml`，确认其中使用 `/opt/secretbox` 的绝对路径和目标镜像标签。
4. 在 1Panel 通过该路径创建 `secretbox` Compose，并在站点管理中配置 `secretbox.scopeview.cn` 反向代理、HTTP 跳转和 HTTPS 证书。
5. 通过下文验收后，再在 Admin 中配置小程序 AppID、AppSecret、COS 和广告位，并上传微信开发版。

小程序生产 API 地址为 `https://secretbox.scopeview.cn/api`。正式审核前还需按 `../../prototype/prd/PRD-轻读手记小程序端.md` 完成体验版真机全链路验证及微信公众平台配置核对。

## 小程序接入、上传和发布

1. 在 Admin 的小程序管理中为每个 AppID 分别建立实例，配置 AppSecret、内容池和数据模式。多个 AppID 可复用同一份 `/opt/secretbox/miniprogram/` 源码，运行时由 AppID 匹配各自配置。
2. 在 Admin 的小程序列表中选择对应实例并点击“上传”。首次上传需要提供该 AppID 的微信代码上传密钥，并确保微信公众平台的 IP 白名单允许生产服务器。密钥只保存在 `/opt/secretbox/data/miniapp-upload-keys/`。
3. Admin 上传成功只代表代码已上传到微信开发版。体验版、审核和正式发布继续在微信公众平台操作并验证。

当前后端与小程序使用 `dataScopeId` 协议，必须配套发布，不存在旧客户端兼容层。不要在已发布的旧客户端仍在使用时单独上线本协议后端。

微信小程序更新不会自动清空设备上的 `wx` storage；本轮通过新的缓存命名空间隔离旧昵称、旧打开历史和旧业务缓存，不能把“上传新版本”当作清缓存手段。平台行为参考[本地缓存](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/storage.html)与[运行时更新机制](https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/update-mechanism.html)。

## 提审与配置一致性

- 微信《[小程序平台运营规范](https://developers.weixin.qq.com/miniprogram/product/)》3.1、3.4 要求实际服务与简介、服务范围、类目和标签一致；5.19 要求审核版本与实际上线版本一致，不得通过技术方式规避审核；第 10 节要求用户产生内容具备内容安全 API、人工审核等机制；第 11 节要求提交版本完整、可运行。
- 《[常见拒绝情形](https://developers.weixin.qq.com/miniprogram/product/reject)》3.4.5 要求未经用户授权不得展示用户头像、昵称等数据。提审前需用新账号检查昵称、头像、历史记录和缓存隔离后的默认态。
- 留言采用客户端 fail-closed：仅服务端明确返回 `messagesEnabled: true` 时展示，配置缺失或请求失败时默认隐藏。Admin 可远程启停；当前审核实例必须保持关闭，并以实际配置和真机结果为准。
- 远程开关不能作为审核规避手段。提审、审核通过后的正式上线配置和审核看到的服务应保持一致；以后开启留言前必须先补齐微信内容安全能力、后台处置流程和对应验收，再按平台要求处理审核。

## schema v6 日常发布

该流程用于当前已经运行 schema v6 的生产环境，可重复执行。日常发布不得运行 `npm run db:migrate` 或 `npm run db:clear-user-data`，也不得创建数据库副本、源码副本或部署备份目录。

1. 只读确认 `/opt/secretbox/data` 中唯一活动数据库是 `secretbox.sqlite`、schema 为 v6，并保留 `miniapp-upload-keys/`。发现其他 SQLite 主数据库或 schema 不是 v6 时立即停止发布，不得通过启动应用自动修复。
2. 只同步本次需要的源码到 `/opt/secretbox/app/` 和 `/opt/secretbox/miniprogram/`，同步 Dockerfile 与 Compose 模板；必须排除 `/opt/secretbox/data` 和 `/opt/secretbox/runtime.env`。Compose 的镜像标签递增为新的日期加序号，不覆盖已验证标签。
3. 恢复源码、运行配置和上传密钥权限，再构建新镜像：

   ```bash
   find /opt/secretbox/app /opt/secretbox/miniprogram -type d -exec chmod 755 {} +
   find /opt/secretbox/app /opt/secretbox/miniprogram -type f -exec chmod 644 {} +
   chmod 600 /opt/secretbox/runtime.env
   chmod 700 /opt/secretbox/data/miniapp-upload-keys
   find /opt/secretbox/data/miniapp-upload-keys -type d -exec chmod 700 {} +
   find /opt/secretbox/data/miniapp-upload-keys -type f -exec chmod 600 {} +
   docker compose -f /opt/1panel/docker/compose/secretbox/compose.yaml build api
   ```

5. 停止服务，并用新镜像只读校验 schema v6、完整性、外键、内容引用及各表数量；本次不运行 `npm run db:migrate`，也不复制活动库。结果只保存结构、引用和计数摘要，不包含业务正文，也不是数据库备份。任一检查失败都保持停服并进行仅支持 v6 的前向修复：

   ```bash
   set -euo pipefail
   docker compose -f /opt/1panel/docker/compose/secretbox/compose.yaml stop api
   docker compose -f /opt/1panel/docker/compose/secretbox/compose.yaml run --rm -T api node - <<'NODE' > /tmp/secretbox-v6-before.json
   const Database = require('better-sqlite3')
   const { validateSchemaV6 } = require('./src/lib/schema-v6-contract')
   const db = new Database('/app/data/secretbox.sqlite', { readonly: true })
   const result = validateSchemaV6(db)
   db.close()
   console.log(JSON.stringify(result))
   NODE
   cat /tmp/secretbox-v6-before.json
   ```

6. 检查通过后启动新镜像并等待健康状态；再次执行同一只读校验并与启动前结果比较，确认启动前后的 schema 合同、内容引用和各表行数摘要一致。这一比较不等同于逐行内容哈希；发布人仍需在 Admin 中抽查内容池、图片素材和小程序配置。随后按下文完成站点、Admin、API 和本次受影响主流程验收：

   ```bash
   docker compose -f /opt/1panel/docker/compose/secretbox/compose.yaml up -d --no-build --force-recreate api
   docker ps --filter name=secretbox-api
   docker inspect secretbox-api --format '{{.Config.Image}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}'
   docker logs --tail 200 secretbox-api
   curl -fsS https://secretbox.scopeview.cn/api/health
   docker exec -i secretbox-api node - <<'NODE' > /tmp/secretbox-v6-after.json
   const Database = require('better-sqlite3')
   const { validateSchemaV6 } = require('./src/lib/schema-v6-contract')
   const db = new Database('/app/data/secretbox.sqlite', { readonly: true })
   const result = validateSchemaV6(db)
   db.close()
   console.log(JSON.stringify(result))
   NODE
   cmp /tmp/secretbox-v6-before.json /tmp/secretbox-v6-after.json
   rm -f /tmp/secretbox-v6-before.json /tmp/secretbox-v6-after.json
   ```

不要用 `777` 处理权限。镜像构建和容器重建不得覆盖、移动或删除 `data/`、`runtime.env` 与上传密钥。

## 验收

服务启动后执行以下只读检查：

```bash
docker ps --filter name=secretbox-api
docker inspect secretbox-api --format '{{.Config.Image}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}'
docker logs --tail 200 secretbox-api
curl -fsS https://secretbox.scopeview.cn/api/health
```

同时确认：后台 `/admin/` 可访问、根路径跳转正确、1Panel 站点反向代理和证书状态正常，并检查 Admin 的内容池、配置和图片素材仍与发布前一致。服务端或小程序 API 有改动时，还要完成对应真机主流程验证；包括打开手记、分享和后台上传等本次受影响功能。当前审核实例还必须确认留言入口和内容均隐藏，配置获取失败时同样保持隐藏。

## 回滚

生产只允许运行 schema v6 镜像和 v6 活动库。最后一次已记录验证镜像为 `secretbox-api:2026.09.11-03`（2026-09-11）；是否仍为实际运行镜像，必须在每次发布前现场核对。当前验收失败时必须停止发布并做仅支持 v6 的前向修复，不得使用任何旧 schema 镜像。

以后只有在上一个已验证镜像仍保留，且确认它与当前 v6 数据结构完全兼容时，才可回退应用镜像。旧 schema 镜像、旧版数据库和 `archive/` 冻结资料均不是生产回退或恢复源。

镜像回退不覆盖、不移动、不删除 `data/`、`runtime.env` 或 SQLite 文件。数据恢复只能来自经授权且已验证与现役 schema v6 完全一致的受管备份；不能以清空数据、删除容器或重建站点作为排障手段。

## 数据、密钥与备份

- 正式数据库为 `/opt/secretbox/data/secretbox.sqlite`，镜像重建和普通发布不得覆盖。
- 生产活动数据目录应只有一个 SQLite 数据库文件 `secretbox.sqlite`，并必须保留 `miniapp-upload-keys/`；现役用户数据必须按发布前的逐表行数和哈希保留，不得因常规部署自动清理。只有产品负责人再次明确授权清场时，才可执行本文的显式用户数据清理步骤。
- 活动数据目录只允许一个 `secretbox.sqlite` 主数据库；运行时 `-wal`、`-shm` 文件不是独立数据库。旧版数据库及迁移输入只能作为本地冻结资料保留在 `archive/`，不得进入生产或与活动库并存。
- 新库直接初始化完整 schema v6；现有活动库只接受 v6。现役代码和日常生产部署不提供运行时迁移、旧字段/旧接口兼容或旧库恢复；已完成的一次性 v5→v6 迁移命令不得再次执行。
- `/opt/secretbox/runtime.env` 含生产密钥，严禁提交到 Git、写入前端、日志或截图。
- 小程序上传密钥按 AppID 保存在 `/opt/secretbox/data/miniapp-upload-keys/`，不得写入 SQLite、日志或截图。
- 生产暂不启用自动备份或定时备份任务。仓库保留手动 `npm run db:backup` 命令，但生产未启用定时调用，也不授权 Agent 在日常发布时自行运行。
- 不自行创建应用快照、源码副本、数据库副本或部署备份目录；真正恢复必须得到明确授权并确认有效恢复来源。

## 兼容域名与对象地址

当前已无 `letterbox-api` 容器和镜像，但这不能证明 `letterbox.scopeview.cn` 域名或 COS `/letterbox/` 对象地址已退役。COS 前缀下仍可能存在被现役内容引用的对象；未完成旧客户端请求、数据库引用、微信合法域名和 COS 对象引用取证，并未取得产品负责人授权前，不得删除、改写或宣称这些域名与对象地址已退役。

旧容器、旧镜像、数据和配置都必须得到产品负责人的明确确认后才可删除；本手册不授权删除任何历史资源。

