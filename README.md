# Secret Box

「轻读手记」（Secret Box）微信小程序及配套后台服务。

## 目录结构

```text
README.md     项目首页与文档入口。
docs/         按 PRD、TEC 前缀和其他无前缀文档分类的项目文档。
miniprogram/  微信小程序正式源码。
admin/        后台、Node.js 服务端和部署配置示例。
```

## 文档导航

### 产品与体验

- [PRD / 小程序](docs/PRD-轻读手记小程序端.md)：页面、分享、广告、数据范围与验收。
- [PRD / 后台](docs/PRD-轻读手记后台.md)：多实例、内容池、管理配置与数据规则。
- [TEC / 设计与交付说明](docs/TEC-设计与交付说明.md)：当前页面映射、视觉参数和交互状态。
- [TEC / 后台设计规范](docs/TEC-admin-workbench-design-spec.md)：桌面布局、表单、弹窗与文章预览。
- [PRD / 图片资产与封面处理规范](docs/PRD-图片资产与封面处理规范.md)：派生、复用、显示和失败回退。
- [其他 / 已知暂缓事项](docs/已知暂缓事项.md)：当前未启用能力及重新评估条件。

### 内容与导入

- [PRD / 文章文档批量导入](docs/PRD-文章文档批量导入.md)：采集 skill 输出的 MD 格式、文件夹导入、去重、图片处理和确认规则。
- [TEC / 内容新增与批量导入](docs/TEC-content-import.md)：普通内容、文章链接和文章文档导入的实现、接口与验收。
- [TEC / 内容列表随机与推荐顺序](docs/TEC-content-randomization.md)：文章、心笺与继续阅读的排序和缓存边界。

### 开发入口

- [TEC / 小程序说明](docs/TEC-miniprogram.md) · [TEC / 后台说明](docs/TEC-admin.md) · [TEC / 服务端说明](docs/TEC-server.md)

服务端要求 Node.js 22 或更高版本。在仓库根目录执行：

```powershell
cd admin/server
npm ci
npm run dev
```

用微信开发者工具打开 `miniprogram/`。原型和归档不参与当前开发与默认提交；生产部署手册、本地数据库、密钥和私密配置不提交 Git。
