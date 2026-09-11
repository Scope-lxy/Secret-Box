# Secret Box

「Secret Box」微信小程序及配套后台服务。

## 目录结构

```text
miniprogram/  微信小程序源码，可用微信开发者工具打开。
admin/        后台管理面板、Node.js 服务端和运行说明。
```

## 文档分工

- 内容新增与批量导入：`admin/docs/content-import.md`。

## 本地运行

后台服务与管理后台：

```powershell
cd admin\server
npm run dev
```

小程序用微信开发者工具直接打开 `miniprogram/`。后台内容维护和导入规则见 `admin/docs/content-import.md`。
