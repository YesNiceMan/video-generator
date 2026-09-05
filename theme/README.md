# 🎨 视界引擎 · 主题包

本文件夹存放可**导入 / 导出**的 UI 主题包,每个子目录代表一个独立主题。
通过「导出主题」把当前页面样式与布局快照到此目录;后续「导入主题」时选择对应主题包即可一键还原/切换。

---

## 📁 主题包结构

```
theme/<theme-id>/
├── theme.json       # 主题清单(元数据 + 设计令牌 + 组件覆盖)
├── app.css           # 样式表(完整 CSS 设计系统,当前页面样式快照)
├── layout.html       # 布局模板(页面外壳 HTML,当前页面布局快照)
└── assets/           # (可选)主题专属静态资源(图片/字体等)
```

---

## 📝 theme.json 格式

```json
{
  "id": "black-gold",              // 主题唯一标识(目录名)
  "name": "黑金设计系统",           // 主题显示名称
  "description": "...",            // 一句话描述
  "version": "1.0.0",              // 语义化版本
  "author": "VideoForge Studio",   // 作者
  "created": "2025-08-27",         // 创建日期
  "type": "dark",                  // dark | light
  "layout": "layout.html",         // 布局模板文件
  "stylesheet": "app.css",         // 样式表文件

  "tokens": {                      // 设计令牌(供导入时生成/覆盖 CSS 变量)
    "colors":  { ... },            //   - 颜色:背景/文字/主色/辅助色/边框
    "radius":  { ... },            //   - 圆角
    "font":    { ... },            //   - 字体与字号
    "shadow":  "...",              //   - 阴影
    "topbar":  { ... },            //   - 顶栏尺寸/背景
    "content": { ... }             //   - 内容区边距
  },
  "components": { ... },           // 组件级覆盖(头像/品牌Logo/导航/按钮/滚动条等)
  "stars": { ... }                 // 背景星点装饰层参数
}
```

---

## 🪐 当前主题

| 主题 | ID | 说明 |
| --- | --- | --- |
| 鎏金胶片 Ciné Noir | `black-gold` | 深空墨蓝背景 · 紫靛青渐变主色 · 玻璃态面板 · 极光辉光(默认主题) |

## 🚀 使用方式

### 导出主题(备份当前页面样式与布局)
```bash
npm run theme:export          # 将当前 public/css/app.css + public/index.html 快照到 theme/<id>/
```

### 导入主题
```bash
npm run theme:apply -- <theme-id>   # 将 theme/<theme-id>/ 下样式与布局应用到 public/
```

> 管理后台也可在「系统设置 → 主题管理」中选择主题包并应用(规划中)。
