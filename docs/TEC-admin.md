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
- [文章文档批量导入规范](PRD-文章文档批量导入.md)
- [内容列表随机与推荐顺序说明](TEC-content-randomization.md)

内容池的新增、批量导入和素材上传实现见 [内容导入说明](TEC-content-import.md)。文章支持标准 MD 文件夹导入与公众号链接抓取两种方式；文件格式、去重和图片处理的产品规则以[文章文档批量导入规范](PRD-文章文档批量导入.md)为准。

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
