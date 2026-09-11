# Admin

`admin/` 放「Secret Box」后台、服务端与部署配置；说明文档统一位于根目录 `docs/`。

## 子目录

```text
server/   当前 Node.js API 服务和管理后台静态资源。
deploy/   构建文件与环境变量示例（生产操作手册仅本地保留）。
```

## 文档入口

- [后台 PRD](PRD-轻读手记后台.md)
- [后台设计规范](TEC-admin-workbench-design-spec.md)
- [服务端说明](TEC-server.md)

内容池的新增、批量导入和素材上传规则见 [内容导入说明](TEC-content-import.md)。

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
