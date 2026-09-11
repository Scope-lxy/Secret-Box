# Admin

这里放「Secret Box」正式发布时要部署到服务器里的内容，包括管理后台、服务端和运行说明。

## 子目录

```text
server/   当前 Node.js API 服务和管理后台静态资源。
docs/     服务端部署和运维文档。
```

## 当前生产入口

- 管理后台：`https://secretbox.scopeview.cn/admin/`
- API 健康检查：`https://secretbox.scopeview.cn/api/health`

内容池的新增、批量导入和素材上传规则见 `docs/content-import.md`。

## 本地入口

```powershell
cd admin\server
npm run dev
```

管理后台：

```text
http://127.0.0.1:3000/admin/
```

本目录只承载实现、运行和配置相关内容。
