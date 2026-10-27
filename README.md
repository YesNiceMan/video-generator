# 🎬 视界引擎 · AI 视频生成与编辑平台

基于 Web 的 AI 视频生成与编辑平台,参考 mikooo.cn/editor 交互模式,为影视制作团队提供一站式创意视频生产工具。包含资产库管理、图生视频、风格库、分集管理(项目 → 分集 → 分镜 → 生成记录)、积分体系与后台模型管理。

## 🎨 设计系统(「鎏金胶片 Ciné Noir」v4)

- **单一令牌层**(`public/css/app.css` 顶部 `:root`):间距 4 的倍数、字号 8 档(11/12/13/14/17/22/28)、圆角 4 档、表面三级、阴影三级;组件不再硬编码尺寸,装饰金与「小号金色正文」分别用 `--gold` / `--gold-text`。
- **配色**:深色 = 影棚暖黑画布 · 鎏金主色;浅色 = 「青白 · 疏朗」(冷雾画布 + 纯白卡片浮起 + 青蓝 #2a76ba 强调 + 放宽一档的留白,第四十五轮起不再沿用金色,也不靠发丝线分层)。两套共用同一批令牌名,顶栏右侧 ☀/☾ 一键切换并持久化。语义色两套通用:定位绿(成功)/ 琥珀(进行)/ 朱红(失败)。
- **浅色模式只换令牌、不覆盖组件**:底纹 `rgba(var(--film), a)`(深=白雾 / 浅=墨雾),品牌色雾·描边·聚焦环 `rgba(var(--accent*-rgb), a)`,色块上的字 `--ok-ink / --warn-ink / --danger-ink / --gold-ink`,小号强调字 `--gold-text`;**空间与层级也是令牌** —— `--gap / --pad-card / --row-py / --pad-page / --fs-page-title / --card-shadow / --sel-fill` 在深色里全部等于原值,浅色靠它们把疏朗与层次拉开。浅色段(`section 29`)因此不出现 `html[data-scheme=light] .btn{…}` 这类会压过 `.btn-primary` / `.cat-chip.on` 权重的高优规则。
- **元素族(31·需求三十一)**:芯片 / 徽标 / 计数药丸 / 方形图标按钮各有唯一几何 —— 圆角只用 `--r-xs·sm·md·lg·full`,微间距只用 `--gap-xs`,控件高只用 `--h-2xs·xs·sm·md·lg` 与 `--sq-sm·md`;选中态分强弱两级(`--sel-*` 与 `--sel-soft-*`,浅色下收敛为同一种淡蓝),卡片选中用 `--sel-ring`,聚焦环只有 `--ring`;压在图片上的浮层统一 `--scrim-rgb / --scrim-ink / --scrim-line`。`test/verify-round44-light-menu.js` 的 G 段会实测每族成员的 height/圆角/字号并拒绝再次漂移。
- **全站一条顶栏**:常规页面显示主导航;进入项目 / 分集层级时,顶栏左侧改由 `App.setContext()` 渲染「返回 + 层级标识 + 视图切换」,不再各页面自建外壳。窄屏主导航折叠为「导航」下拉。
- **动作分层**:页头只放主行动与次级菜单,筛选控件独立成行;批量操作以浮条按需出现。

## ✨ 功能总览

| 模块 | 说明 |
| --- | --- |
| **用户与权限** | 邮箱注册/登录、会话管理;普通用户 / 管理员双角色;每人 5GB 存储配额(可扩展) |
| **资产库** | 图片/视频/音频上传,单文件最大 2GB;业务分类(角色/场景/物品/分镜/音频/视频);**右击快捷菜单**(预览/重命名/共享/下载/删除);文件夹、标签、搜索;按用户共享;**每页 20 条分页**(跨页保留勾选,「全选当前结果」按筛选取全量) |
| **图生视频** | 源图 + 模型 + 风格 + 参数;**参考资产门控的 [占位符] 链接**(仅加入「参考资产」的资源可占位,链接成功黄色高亮);支持**自定义在线模型(Agnes Video 兼容 API)或系统默认 ffmpeg** 双引擎;提交后实时任务进度面板 |
| **AI 生图(第二十五~三十三轮)** | 提示词 → 图片独立工坊:模型/风格/负面词/参考图(图生图·多图合成)/画幅比例/**分辨率档 1K·2K·4K**/张数(1–4),**输出规格下方实时显示换算后的成片宽高**(比例 × 分辨率 → 具体尺寸,模型有固定尺寸清单时直接写明);**模型能力后台勾选**(文生图·图生图·多图合成)+ **参数模板可配**(比例·分辨率·质量·种子);**可插拔协议**(openai-image · gemini-image · img-ffmpeg 本地占位),后台填表即接新 API;参考图挑选弹窗支持多选与大图浏览(方向键翻页);成果自动入资产库并可作为图生视频源图;分镜工作台一键按镜生图并自动加入参考资产;按张计价(creditPerImage),免费体验模型内置 |
| **风格库** | 风格 = 模型 + 提示词模板 + 参数预设;浏览/收藏/一键应用;用户可创建私有风格 |
| **项目协作** | 项目 → 分集 → 场景 → 片段;**每个项目有唯一 ID 与邀请码(VF-XXXXXX)**,凭管理员分享的邀请码即可加入协作;**项目级出片参数(帧率 / 画幅比例 / 分辨率 / 单镜时长)在建项目时设定,新增分镜按此初始化并真正参与渲染出片**;单集/整季导出最高 4K |
| **积分体系** | 注册赠送积分;**按段时长扣减积分**(管理员可为每段时长单独定价);失败/取消自动退还;用户可申请积分、查看消耗流水;免费模型不消耗积分 |
| **后台管理** | 模型管理(**添加后自动有效性检查**:schema/端点格式/ffmpeg 试渲;**免费模型端到端自检**)、**API 模型接入**(填 API 地址 + API Key 后一键**检测可用模型**并选择模型 ID)、积分审批、任务监控(含提示词与积分列)、用户管理(封禁/配额/手动调分)、系统设置(**每段时长的积分数定价**) |
| **分镜工作台** | 视频创作页多分镜:**[占位符] 自动链接资产**(绿色高亮 + 已链接资源 chips,**仅参考资产可引用**)、参考资产分类引入/搜索/**移除**、点击左侧资产右侧分镜**闪动反馈**、引用 chips 与左侧资产**点击放大查看**、**工作记录自动保存**(刷新/重开不丢失)、生成记录可删除;**分镜参数栏的分辨率带出成片宽高、帧率只给所选模型支持的档位** |

## 🚀 快速启动

要求:Node.js ≥ 22.5(内置 `node:sqlite`)

```bash
npm install          # 安装依赖(express / multer / bcryptjs / ffmpeg-static)
npm start            # 启动服务器(默认端口 3088)
```

打开浏览器访问 **http://localhost:3088**

**在线模型(可选)**:「Agnes Video 2.5 Flash」已内置,在后台「模型管理」中填入 API Key 即可走在线生成;不配置 Key 时该模型不可提交。本地素材需能被 Agnes 服务拉取 —— 设置环境变量 `PUBLIC_BASE_URL`(或系统设置 `publicBaseUrl`)为本机公网地址后用签名直链回传,未配置时自动改用 base64 内嵌方式提交。

### 内置体验账号

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| admin@videoforge.cn | admin123 | 管理员 |
| demo@videoforge.cn | demo123 | 普通用户(含演示项目《山海录》第一季) |

## 🧭 使用流程

1. **登录/注册** → 进入仪表盘
2. **资产库** 上传素材并分类,**右击**资产弹出快捷菜单可重命名/共享/下载/删除
3. **项目分集** 中创建分集 → 进入分集**视频创作工作台**,把资源库素材加入「参考资产」,提示词中输入 `[资产名]`(如 `[女主]`)自动链接并黄色高亮,确认积分数后开始生成
4. 任务进度实时展示;失败/取消自动退还积分;完成后视频自动存入资产库
5. 在项目设置里把唯一邀请码分享给成员即可多人协作
6. 管理员在 **后台管理** 配置模型(添加后自动检查有效性)、一键测试免费模型、设置每段时长积分数、审批积分申请

## 🏗️ 技术架构

```
video-generator/
├── server/                  # Node.js + Express 后端
│   ├── index.js             # 应用入口(路由/静态/错误处理)
│   ├── db.js                # node:sqlite 建表/增量迁移/种子数据(含免费模型)
│   ├── auth.js              # 会话认证(bcrypt + HttpOnly Cookie)
│   ├── credits.js           # 积分核心:计价/扣减/退还/发放/流水
│   ├── ffmpeg.js            # ffmpeg 封装(探测/缩略图/图生视频/分集拼接)
│   ├── worker.js            # 任务队列(并发控制/进度/通知/失败退积分)
│   └── api/                 # REST API:auth/assets/styles/tasks/credits/projects/admin
├── public/                  # 前端 SPA(原生 JS,无构建)
│   ├── index.html           # 应用外壳(顶栏导航 · 无侧边栏)
│   ├── css/app.css          # 黄主绿辅设计系统
│   └── js/                  # api/ui/viewer(统一成果查看器)/plink(占位符链接)/credits(积分中心)/视图
├── data/                    # 运行时数据(SQLite + 上传/生成文件,已 gitignore)
└── test/                    # e2e.js 与 verify-round*.js 验证脚本
```

- **后端**:Express + `node:sqlite`(零原生依赖)+ multer 上传 + bcryptjs 密码哈希
- **视频生成**:ffmpeg 对源图做镜头推拉(zoompan)+ 风格调色(eq/colorbalance/hue),输出 H.264 MP4;分集导出用 concat 滤镜拼接,支持 720p/1080p/4K
- **前端**:原生 JS SPA(无构建工具),hash 路由、fetch API、组件化视图;深色创意工具风格 UI
- **图标**:内置 [Lucide](https://lucide.dev) 图标库(`public/vendor/lucide.min.js`,本地化无外网依赖),`js/icons.js` 通过 MutationObserver 自动将动态插入的 `<i data-lucide>` 渲染为 SVG
- **动效**:统一动效系统(页面切换入场、卡片交错浮现、下拉/弹窗弹簧曲线、进度条流光、按钮按压反馈),支持 `prefers-reduced-motion` 降级
- **纯色设计**:全站取消渐变 UI(按钮/徽标/背景/进度条等均为纯色),顶部导航栏(工作台/视频创作页)高度固定 60px 不随内容与断点变化,层级选择(项目分集 → 分集列表 → 视频创作)常驻导航栏内可点击跳转
- **资产分类**:资产带 `category` 字段(角色/场景/物品/分镜/音频/视频),上传时自动按文件类型归类音视频,支持列表 chips 筛选、预览内单改、多选批量归类;分镜工作台的「+角色/+场景/+物品/+分镜/+音频/+视频」按分类精准选取素材
- **任务系统**:内存队列 + 并发上限(管理员可配),ffmpeg `-progress` 实时进度,失败自动落库可重试
- **第五轮优化**:顶栏用户菜单重复绑定修复(退出再登录后可直接弹出);API 模型(api_base/api_key/model_id)持久化与 `/api/admin/models/detect` 可用模型检测(Key 脱敏存储,支持复用已存 Key);分镜工作台工作记录自动保存(`episodes.studio_state`,防抖 PUT + sendBeacon 兜底);素材选择弹窗改为大窗口「全部资源 + 分类 chips + 名称搜索」;分镜卡片入场动画只在首次播放、轮询重渲染保持滚动位置,融生视频预览尺寸自适应放大
- **第七轮修复(Agnes 在线模型生成失败)**:修复「使用 Agnes-video-v2.0 / Agnes Video 2.5 Flash 生成视频必失败,报 *Cannot convert object to primitive value*」。根因:node:sqlite 返回的资产行对象原型为 null,流入 `server/agnes.js` 后被正则匹配/字符串拼接强制转字符串而抛 TypeError。修复:
  1. `server/worker.js` 把资产行收敛为普通媒体对象({id,name,path,mime})再传入 API 客户端,不泄漏整行字段;
  2. `server/agnes.js mediaRef()` 对字符串/对象统一安全取值,不再对对象做字符串强转;
  3. `flashBody()` keyframe 模式的首/尾帧经 `mediaRef()` 转成签名直链或 base64 data URI(此前把整个资产行塞进请求体);
  4. 网关错误详情(detail/error 可能是对象或数组)安全转文本,失败原因可读;
  5. 任务失败落库改用安全错误文本,任何非 Error 抛出值都不会再导致 markFailed 自身崩溃。
  - 回归验证:`node test/verify-round7-agnes-fix.js`(自建 Mock Agnes 网关全链路 26 项断言);并已用真实配置的 Agnes API 分别对两个模型端到端生成成功。
- **第八轮修复(API 请求超时 + 创作工坊取消)**:
  1. 修复「在线模型生成视频必报 *无法连接视频 API(请求超时)*」。根因:多张参考图经 base64 内嵌时请求体达 15MB+,30 秒超时不足以完成上传。修复:
     - `server/agnes.js` 增加 `prepareImage()` 函数,对 >256KB 的图片缩放至 1024×1024 以内并转 JPEG(压缩率 3~5%),极大减小请求体;
     - `mediaRefAsync()` 异步版媒体引用,在 base64 回退前先压缩大图;
     - `v2Body()` / `flashBody()` 改为 async,使用 `mediaRefAsync()`;
     - `createVideoTask()` 超时从 30 秒放宽至 120 秒,同时增加自动重试机制(最多 3 次,网络抖动自动恢复);
     - 查询超时从 20 秒放宽至 30 秒;
     - 错误消息明确包含已重试次数。
  2. 取消「创作工坊」独立功能模块,视频创作只保留在项目分镜工作台内:
     - 删除顶栏导航「创作工坊」入口与用户菜单项;
     - 删除 `/js/views/create.js` 视图文件与 script 标签;
     - `#/create` 旧链接自动重定向到 `#/projects`;
     - 通知/风格库等处的旧链接全部重定向到项目分集;
     - 更新对应测试脚本(verify-round4-ui.js / browser-check.js / verify-optimizations.js)。
  - 回归验证:实际配置的 Agnes API 端到端生成成功(4 张参考图 + 4 秒视频,完成耗时 ~9 秒创建,约 2 分钟生成);无头浏览器验证顶栏导航与重定向逻辑。


## 模型接入实测(第三十六轮补充 · Vercel AI Gateway 与 LTX v2)

- **Vercel AI Gateway(`bytedance/seedance-2.0-fast`)**:模型在册(`GET /v1/models` 200,`type=video`、输入 text/image 输出 video)。裸 HTTP 契约从 `@ai-sdk/gateway@4.0.126` 源码确认(官方文档只写 SDK):`POST https://ai-gateway.vercel.sh/v4/ai/video-model/start`,模型走请求头 `ai-model-id`,另需 `ai-gateway-protocol-version: 0.0.1` 与 `ai-video-model-specification-version: 4`(缺前者报 400 `Unsupported gateway protocol version`)→ `{operation}`;`POST …/video-model/status` 体 `{operation}` → `{status, videos[]}`。**未能出片**:该 Key 所属团队 `GET /v1/credits → {"balance":"0"}` 且未绑卡,任何计费请求(连 8 token 的语言模型也一样)一律 `403 customer_verification_required`,属账号门槛而非接口问题。要接进平台还需 rules 支持**自定义请求头**与 **POST 轮询**(现适配器只有 GET + `?video_id=`)。
- **LTX(`api.ltx.io/v2`)**:**已实测出片**。`POST /v2/text-to-video` → `202 {id}`;`GET /v2/text-to-video/{id}` → `processing → completed`(**21 秒**);地址在 `result.video_url`。实测 `ltx-2-5-fast · 1280x720 · 6s · 24fps · generate_audio:false` → **1280×720 / 6.04s / h264 / 2.41MB**(无声),样本 `data/generated/ltx-2-5-fast_1280x720_6s.mp4`(未入库)。可用模型 ID 用「故意给非法分辨率」的方式零成本校验:`ltx-2-5-fast`、`ltx-2-5-pro`、`ltx-2-3-fast`、`ltx-2-3-pro` 全部通过;`ltx-2.3`、`ltx-2`、`ltxv`、`ltx-2-fast` 等一律 `Invalid model`。按输出秒计价:2-3-fast 720p `$0.03`、2-5-fast 720p `$0.09`、2-5-pro 720p `$0.12`。
- 为让 LTX 纯 rules 接入,`server/adapters.js` 补两处通用能力:① `pickVideoUrl` 认「结果嵌一层」的 `result.video_url`;② `<token>` 新增 **`<size_px>`**(按所选分辨率档 + 画幅算出的像素串 `1280x720`,给要像素而非档位的网关用)。接入配置(无需改代码):
  ```json
  { "protocol": "openai-video",
    "create": { "path": "/text-to-video",
      "body": { "model": "<model_id>", "prompt": "<prompt>", "duration": "<seconds>",
                "resolution": "<size_px>", "fps": "<fps>", "generate_audio": false } },
    "limits": { "min_seconds": 6, "max_seconds": 20 } }
  ```
  不配 `query` 时轮询自动按 `{create.path}/{job_id}` GET,正好命中 LTX 的查询端点。
- 验证:Mock LTX 网关跑 `adapters.run()` 9 项全过(`duration` 保持数字类型、`resolution` 出像素串、嵌套 `video_url` 解析并下载、进度回调推进);回归 `verify-round12-adapters.js` 29 项、`verify-round7-agnes-fix.js` 26 项、`verify-round36-busy-requeue.js` 27 项全绿。


## 第四十九轮优化(需求三十二 · 浅色模式清掉最后一批旧配色元素)

需求：「浅色模式下还是有旧的配色元素」，附三张截图：生图记录卡上的「生成中」棕色角标、「已取消」深色角标、「失败」红角标 + 原始 JSON。

### 先量测：按色相扫，而不是按「旧金色字面值」扫

第四十四轮那条「无鎏金残留」断言是拿一份**旧金色字面值清单**比对的，而且为了不误伤语义色，把 `--warn / --gold / --danger` 的当前令牌值整体加进了白名单 —— 于是浅色 `--warn` 本身就是棕橙 `#a85a12`，棕色角标顺理成章地被判成「合法语义色」放过去了。这一轮改成**按 HSL 色相扫**（色相 12–78°、饱和度 ≥ 0.14，深浅 × 10 个页面），再把现场不一定出现的状态做成固定样本来量。量出来的七处：

| # | 现象 | 实测 | 根因 |
| --- | --- | --- | --- |
| 1 | 「生成中」角标是棕色，同卡片下方的进度条是主色蓝 | `rgb(168,90,18)` hue=29 | **状态语义放错族**：进行中 ≠ 警告，一直复用 `--warn` |
| 2 | 淡底芯片的底色仍是深色主题那套亮琥珀 / 亮绿 | 66 处 `rgba(65,207,144,.14)` 一类字面值写死在组件里 | 组件把**某一副主题**的色板写死了，浅色只能跟着穿深色衣服 |
| 3 | 「已取消 / 排队中」角标是一块深底浮层 | `rgba(18,32,48,.78)` 压在 `#e9f1f8` 占位块上 | 浮层语言只对**照片**成立；没出图时底下是占位灰块，深底就成了残留 |
| 4 | 参考资产的来源角标看不见 | 深蓝字压深底，对比 **0.55:1** | 浅色段那串「逐条补白字」的覆盖清单漏了它 |
| 5 | 已完成角标（实底绿）上的字看不见 | **1.21:1** | `html[data-scheme=light] .status-completed{color:#136c47}` 权重 (0,2,1) 压过 `.ig-card-flag .status-completed` (0,2,0) —— 第 44 轮立的权重陷阱，换了个地方复发 |
| 6 | 成果卡页脚没有钉在卡片底部 | `margin-top` 被写成 `margintop` | 第 47 轮那条「margin-top:auto 收住页脚」从头到尾是空转的 |
| 7 | 缩略图上的名字条 / 播放键悬停是暖黑 | `rgba(8,6,4,.82)`、`rgba(22,16,8,.8)` 硬编码 | 没走 `--scrim` |

### 改法

1. **语义色底纹令牌化**：新增 `--ok-rgb / --warn-rgb / --danger-rgb / --info-rgb`，66 处字面值全部改成 `rgba(var(--ok-rgb), .14)` 这种写法 —— 深色逐位不变，浅色整族跟着翻。两档三元组是量出来的而不是随手挑的：浅色直接用 `--ok` 的深绿做 14% 底，淡底会把 11px 粗体字压到 4.46:1，所以取中间调 `46,158,114`（→4.58）与 `222,96,88`（→4.54）。
2. **`--proc` 四件套**（实底 / 实底上的字 / 淡底上的字 / 淡底配方）：深色 = 琥珀（鎏金身份不动），浅色 = 主色蓝。`.status-processing`、成果卡角标、`.cc-pending` 三处一起换 —— 「进行中」从此和它自己的进度条同色。
3. **`--flag-idle` 三件套**：还没出图的卡片角标在浅色下是白底 + 墨字 + 一圈影子，深色仍是深底浮层。
4. **浮层统一交给 `--scrim-ink / --scrim-line / --scrim-accent`**：删掉浅色段那 13 个选择器的白字补丁（漏一个就是一个看不见的角标），组件规则自己读令牌；`.ws-ref-tag` 的金色标签在浅色下走 `--scrim-accent: #ffffff`。新增 `--surface-sunk` 表达「占位底比表面更暗一档」这层关系（深色是更亮一档，所以必须可翻）。
5. **删两条过时的浅色浓度补偿**（`.status-completed` / `.ws-log-state.ok` 的 `#136c47`）：浅色 `--ok` 现在本身就是深绿，补偿不但多余，还把实底角标的字压成看不见。
6. `.status-cancelled` 的字色 `--ink-3 → --ink-2`（深色 4.38 → 6.33），修 `margintop` 拼写，暖黑字面值走 `--scrim`。
7. **保留的暖色只有真警告**：`.ws-need-src`（缺前置条件提示）、`.cc-delta.minus`（积分减少）、`.fav-btn.on`（收藏星）仍用 `--warn` —— 它们是语义警告，不是旧品牌金。
8. **顺手修掉截图里那屏代码**：第三张图的失败卡片铺的是整坨网关响应体 JSON。新增 `errBrief(s)`（[public/js/ui.js:64](file:///Users/a123/Desktop/test/video-generator/public/js/ui.js#L64)）：先抠 `error.message / message / detail`，抠不到就按响应里的 `status` 概括成「上游返回 status=queued，未产出结果」，再退化成截断原文（90 字 + 省略号）；完整内容留在卡片 `title` 与工作台「工作日志」详情里，成果卡 / 分镜记录卡 / 时间线 / 失败 toast / 模型自检 toast 五处一起换。

### 验证

`test/verify-round44-light-menu.js` 由 267 项扩到 **300 项全过**：

- A 段新增 12 条静态契约 —— 语义字面值清零、`--proc` / `--flag-idle` 两族在两套主题各自定义、深底浮层不得写 `color: var(--ink)`、浅色段不得再给状态芯片补字色、`margintop` 这类拼写错误。
- 新增 **H 段「状态徽标族」**：把 生成中 / 排队 / 已取消 / 失败 / 已完成 五种角标和芯片做成固定样本注入页面（现场不一定有这些状态，也不能为看颜色去发一个耗积分的任务），逐个实测**有效底色色相 + 文字对比度**，浅色列断言「不暖、不是深底」，深色列反向断言「琥珀仍在」，量完即删。
- 新增 **I 段「上游报错文案」**：6 个 `errBrief` 用例（响应体 JSON / `error.message` / 普通文字 / 残缺 JSON 不抛异常 / 超长截断 / 空值退回兜底文案）。

回归：`verify-round22 / 29 / 32 / 40 / 42` 全绿；`verify-round17d-studio.js` 仍是那条已知的过期数据断言（时长档位）。


## 第四十八轮优化(需求三十一续 · 网格排满整行 + 分页条不再压在卡片上)

需求：「1、优化页面中的 UI/UX，可以做适当调整，能够方便使用；2、资产库中的图片没有塞满，会空几个位置」。

### 先量测(1750px 视口，20 项资产)

| 现象 | 实测 | 结论 |
| --- | --- | --- |
| 资产网格「空几个位置」 | 行内卡片 `hSpan:0 / thumbSpan:0`，行距 `dead:13` | 卡片本身没问题 —— 空格是**末页行数不整**:20 项 ÷ 6 列 = 6/6/6/**2**，最后一行缺 4 格 |
| 分页条 | `position:sticky` + `bottom`，`overlapsScroller:6` | 吸底时分页条**横压在最底一行 6 张卡片上**,点击区被遮 |

根因:分页大小一直是后端约定的常量 `PAGE_SIZE = 20`,与网格实际列数无关;而列数是 `repeat(auto-fill, minmax(220px,1fr))` 算出来的,随窗口宽度 3~8 列变化。**每页条数是定值、每行列数是变值**,两者永远对不齐,末行必然残缺;`sticky` 分页条则是为了让「翻页控件常驻可见」而付出的遮挡代价。

### 改法

1. **每页条数随列数自适应**：`ui.js` 新增 `gridCols(el, minVar)`(用与 CSS 完全相同的 `floor((w + gap) / (min + gap))` 公式实测列数)和 `gridPageSize(el, minVar, fallback)` = `列数 × PAGE_ROWS(4)`。列数 < 2(测量不到 / 极窄)时回落到后端默认 `PAGE_SIZE`,不会出现每页 1 条这种荒唐值。
2. **最小卡宽令牌化**：`220px` / `244px` 这两个硬编码值提为 `--card-min`、`--ig-card-min`,CSS 的 `minmax()` 与 JS 的列数计算读同一枚令牌——浅色模式下圆角/间距变大,卡宽下限也一并跟着调,JS 不会按旧值误算列数。
3. **先渲染骨架、再量列数**：`assets.js` 的 `render()` 改成先 `renderUI()` 出空网格(`_loading` 守卫挡住两个 `render*()`),这样 `#assetGrid` 已经进布局树、能拿到真实 `clientWidth`,再据此定 `state.size` 去 `load()`。所有分页算术从 `PAGE_SIZE` 改读 `st.size / this.state.size`。生图记录侧同理,`renderResults()` 量出 `st.rsize`。
4. **分页条改成栏底固定**：`.ast-main` 变成 `flex-direction:column; overflow:hidden`,滚动区单独包一层 `.ast-scroll`,`#astPager` 作为 `.ast-pager` 挂在它**外面**——不再 `sticky`、不再有 `box-shadow` 浮起,只靠一条 `border-top` 与内容区分隔,`flex-shrink:0` 保证永不被压缩。生图记录的 `#igResPager.ig-res-foot` 同理移出 `.ig-res-scroll`。
5. **`.pager` 的 `sticky` 规则保留**：资产库/创作台里的**弹窗选图器**仍然是一整块滚动区,那里吸底是合理的(选完就关,不存在长期遮挡)。用 `body:not(.page-fill) .ast-pager` 让非满高布局下的分页条维持原来的独立卡片外观,两种语境各自成立。
6. **窄屏/矮屏兜底**：`≤1080px` 与 `≤620px` 两段媒体查询里补上 `.ast-scroll`,在窗口高度不足时退回「整页滚动 + 分页条走普通文档流」,避免 `.ast-main` 被压成几十像素高。

效果：1750px 下资产库变成 **6 列 × 4 行 = 每页 24 张,末行不缺格**;分页条 `position:static`,`overlapsScroller:0`。生图记录 4 列 → 每页 16 张,底栏显示「共 41 条 · 每页 16 条」。

### 顺手的使用流小改

- 新建文件夹从「弹窗关掉再等业务」改成 `formModal({ onSubmit })` 契约:失败留窗、按钮恢复,不再静默。
- 空资产库文案补明确动作指引(「点右上『上传资产』添加…」),不再是孤零零一句「暂无资产」。

### 验证

`test/verify-round44-light-menu.js` 由 263 项扩到 **267 项全过**，新增「每页排满整数行」段：分别量资产库与生图记录,断言「末页行数 × 列数 == 每页条数」且「非末行无缺格」；再加「分页条不压在卡片区上」(几何相交测试,不是读 CSS 声明)。这两条正是本轮改前的量测脚本,留下防回潮。

回归：`verify-round22.js`、`verify-round29-uiux.js`、`verify-round32-srcref-tasks.js`、`verify-round40-modelcfg.js`(28 项)、`verify-round42-text.js`(67 项)全绿；`verify-round17d-studio.js` 仍是那条已知的过期断言(「时长档位 13 档」—— 第三十七轮接入大模型后档位已变,与本轮无关)。


## 第四十七轮优化(需求三十一续 · 卡片网格等高 + 生图成果卡重排)

需求：「1、页面中的 UI/UX 可以做适当调整，能够方便使用；2、AI 生图记录显示不美观，不止这个页面出现了这种情况」。

### 先量测，再动手(无头 Chrome 逐行量网格)

| 网格 | 行内卡片总高差 | 行内媒体块高度差 | 结论 |
| --- | --- | --- | --- |
| `.ig-res-grid` 生图成果 | 0(grid 拉伸) | **0 / 51 / 11 / 109px** | 总高被拉平,差值全被文字区吸收 → 短图卡片底部一大片死白 |
| `#assetGrid` 资产 | 0 | 0 | 本来就等高 |
| `#projGrid` 项目 | 0 | 0 | 正常 |

根因链：第三十三轮为了让用户看出「换了画幅比例」，把 `.ig-img-cell` 改成按图片真实宽高比撑高(`aspect-ratio: w / h`)—— 于是 16:9 的卡片媒体块 98px、1:1 的 218px，同一行差 109px。叠加另外两处：`.ig-card-meta` 是一整串 `#id · 模型 · 比例 · 分辨率 · 尺寸 · 时间` 且**没有裁切**(实测 2–3 行)、`.ig-card-foot` 里「状态徽章 + 三枚带字按钮」在 244px 卡宽下必然折成两行(量得 269px > 可用 220px)。

### 改法

1. **媒体块定高**：新增 `--media-h: 180px`，`.ig-card-media` 统一框高、缩略图 `object-fit: cover`;比例信息不再靠形状暗示,而由参数行(`16:9 · 2K · 1536×1024`)与多图角标(`4 张`)说明。进度块 / 失败块同样吃满这个框,不再随文案长短抖。
2. **状态徽章上封面、页脚只留动作**：`.ig-card-flag` 压在封面左上角(与资产库的类型角标同一语言),页脚腾出来放「下载 / 再次生成 / 删除」—— 一行放得下,不再折行。
3. **角标必须实底**：列表里那套「语义色文字 + 12% 半透明底」放到照片上完全读不出来,`.ig-card-flag .status-*` 改成实底语义色 + `--ok-ink/--warn-ink/--danger-ink` 字色(排队/取消走 `--scrim-rgb` 深底白字)。
4. **已完成不贴角标**：一屏六枚同款绿章是纯噪声,只有 进行中 / 排队 / 失败 才显示状态徽章。
5. **文字定行**：提示词 2 行(原有)、模型名 1 行、参数+时间 1 行(超出省略并把完整内容放进 `title`);时间口径统一成相对时间 `fmtAgo`(与资产库一致),任务 ID 移出可见文本、留在 tooltip 里。
6. **同类问题一起扫**：`#styleGrid .card` 补 `display:flex; flex-direction:column`(原先 `> div:last-child { margin-top:auto }` 因为父级不是 flex 而**一直是空转的**),标签行改单行不折;新增 `.clamp-1 / .clamp-2` 工具类。
7. **表面上的勾选框不再伪装成图片浮层**：`.style-check / .proj-check` 是勾在白卡表面上的,原先继承 `.asset-check` 的深底浮层配方 —— 浅色下是一个突兀的黑块、深色下几乎看不见。改走 `rgba(var(--film), .07) + --line-strong`,并把浅色那条强制白字/白边的规则收窄到 `.media-card .asset-check`(真的压在缩略图上的那种),同时补回 `.on` 的字色。

### 验证

`test/verify-round44-light-menu.js` 由 255 项扩到 **263 项全过**，新增「卡片网格等高」段：在 深浅 × 4 个网格(成果 / 资产 / 风格 / 项目)逐行实测 `卡片总高差 / 媒体块高差 / 底边差`，任一项 > 2px 即失败 —— 这一条正是本轮改前的量测脚本，留在套件里防止「按真实比例撑高」这类改动回潮。

回归：`verify-round22.js`、`verify-round29-uiux.js`、`verify-round32-srcref-tasks.js` 全绿。



## 第四十六轮优化(需求三十一 · 全站元素统一 + 消除「保存失败却像成功了」)

需求：「优化全站的页面UI/UX，使操作和样式更优秀；当前页面中有些元素不统一」。先做两路并行盘点(CSS 令牌/族漂移、JS 视图交互与文案)，再按「看得见的统一优先」动手。

### 量测出来的不统一(改前)

| 族 | 现状 | 漂移值 |
| --- | --- | --- |
| 圆角 | 39 处硬编 `6px` / `13 处 7px` 游离在 `--r-sm/md/lg` 之外 | `.ig-ref-chip`(r-sm) 包着 `.ig-ref-thumb`(6px) → 浅色下同一枚芯片内外两种圆角 |
| 微间距 | `gap: 5px` ×29、`6px` ×32、`7px` ×15 —— 一个从未声明的 5–7px 档 | 与「间距 4 的倍数」的自述契约直接冲突 |
| 芯片 | `.cat-chip` 30 / `.pg-btn` 28 / `.em-size-tag` 28 / `.ig-cap-chip` 22 / `.cost-hint` 28，圆角一半胶囊一半 `--r-sm` | 同一行里两种形状 |
| 徽标 | `.tag` 无 `font-weight`、`.status` `3px 10px`、`.free-badge`/`.tag-api` 6px 方角、`.tm-active-tag` `1px 8px`+5px | 表格里一排「看起来同类、数值各不同」的标签 |
| 计数药丸 | `.ws-ref-count` 22×20、`.ws-left-open-count` 24×18、`.cc-pending` 18×18 | 同角色三种尺寸 |
| 选中态 | 强选中(`--gold-fill` 实底)与弱选中(`--surface-hover`)混用无规则；`.wb-tbtn.on` 竟是**红色危险** | 浅色下满屏深色实底；`.on` 一个后缀两种语义 |
| 聚焦 | 4 处 `rgba(227,180,94,.14)` 光环 + 1 处 `.12` + 2 处只改描边 + 4 个输入框完全没有环 | 键盘用户无一致反馈 |
| 浮层 | `rgba(7,6,4,·)` ×8、`rgba(10,8,5,·)` ×5、浅色 `rgba(18,32,48,.6)` —— 三套配方，且浅色把所有浓度压成同一个 .6 | 深浅两主题的层级关系不一致 |
| 死代码 | `.ig-form .field` 被后写规则整条覆盖(紧凑化从未生效)、`.ig-foot-row .ig-go` 重复两遍、`.table .muted/.num` 与工具类重复、`--pl-name-fs` 被消费却从未声明、`.pl-token.ok .pl-tname` 硬编 `#f4d9a2` 逼出一条浅色覆盖 | 「组件不硬编码」的契约被自己违反 |
| 交互 | 11 个弹窗把 API 调用写在 `formModal()` **之后** → 请求失败时弹窗已关闭，用户以为保存成功(剧本 / 新建项目 / 编辑项目 / 分集 / 文件夹 / 配额 / 积分 全中招)；重置邀请码无确认；收藏切换无 try/catch 无禁用；分镜 0 镜时中间是一整块空白 | 「点了没反应」与「数据静默丢失」 |
| 文案 | 资产 128 / 素材 30 / 资源 12 —— 页面叫「资产库」、按钮叫「上传素材」、弹窗叫「补给资产」、搜索框叫「搜索素材名称」 | 同一对象三个名字 |

### 改法

1. **阶梯补齐**：新增 `--r-xs(6) / --h-2xs(22) / --h-xs(28) / --sq-sm(26) / --sq-md(30) / --gap-xs(6)`，把 52 处圆角、76 处微间距、10+ 处控件尺寸收编进去；芯片族统一胶囊形(`.pg-btn`/`.em-size-tag`/`.cost-hint` 由 `--r-sm` → `--r-full`)，徽标族统一 `11px / 700 / 2px·8px / 胶囊`，计数药丸统一 `--h-2xs`，方形图标按钮统一 `--sq-sm/--sq-md` + `--r-sm`。
2. **选中态分两级并全部令牌化**：`--sel-fill/--sel-ink/--sel-line`(强：芯片「就是这一个」) 与 `--sel-soft/--sel-soft-ink/--sel-soft-line`(弱：导航 / 工具条 / 目录树 / 命令面板 / 尺寸标签)。深色下强=鎏金实底、弱=悬停雾(取值与原先逐字相同 → **深色零变化**)，浅色下两级收敛成同一种淡蓝。卡片选中另给 `--sel-ring`，收掉 5 处硬编 `box-shadow: 0 0 0 1px var(--gold)`。删掉语义冲突的死规则 `.wb-tbtn.on`。
3. **聚焦环唯一配方 `--ring`**：6 处引用，`.ws-neg` / `.wb-ai-inner` 补上原本缺失的环。
4. **浮层三件套 `--scrim-rgb / --scrim-ink / --scrim-line`**：13 处暖黑配方统一，各组件保留自己的浓度，浅色只翻底色与字/边 —— 段 29 里那条把 .72/.78/.8 全压成 .6 的规则随之删除。
5. **死代码清理**：删被覆盖的 `.ig-form .field`、重复的 `.ig-foot-row .ig-go`、冗余的 `.table .muted`/`.table .num`；声明 `--pl-name-fs`；`#f4d9a2` → `var(--gold-soft)`。
6. **交互**：11 个弹窗的写操作全部移进 `formModal({ onSubmit })` —— 失败时弹窗保持打开、按钮恢复可用、已输入内容不丢(此前是「弹窗关闭 + 全局 toast 一闪 + 数据没了」)；后台三个「保存」按钮统一走新增的 `saveWithBusy()`(禁用 + 「保存中…」+ 失败弹错)；重置邀请码加不可撤销确认与禁用锁；收藏切换加 try/catch + 禁用防连点；分镜工作台 0 镜时给出带下一步指引的空态。
7. **文案统一**：用户可见的「素材」全部改口「资产」(上传资产 / 搜索资产名称 / 项资产 / 补给资产 tooltip)，「添加模型」→「新建模型」与 新建项目/分集/风格 同一动词；toast 文案去掉与 `toast()` 自带图标重复的 ✅/❌，提示里的 `⚠` 字符换成 lucide `triangle-alert`。

### 事故与恢复(如实记录)

第 4 步的一次 codemod 把「成对替换」写成了扁平数组，`for (const [a,b] of [...])` 于是按**字符**解构，实际执行了 `b→o`、`g→a`、`r→g`、`c→o` 四次全文替换，`section 29` 之前的 2035 行全部损坏。恢复方式：从 `git show HEAD` 取回段 1–28，按本轮记录**重放**第四十四/四十五/四十六轮的全部 codemod(逐条断言命中次数)，再接回未受损的段 29；随后跑当时已有的 232 项断言套件验证 —— **全过**，证明重建与损坏前一致。教训已写进脚本约定：替换函数必须接收 `[from, to]` 数组并断言命中数。

### 验证

`test/verify-round44-light-menu.js` 由 232 项扩到 **255 项全过**，新增：

- **A 段静态契约**：圆角/微间距/浮层底色不得再出现字面值、`--ring` 至少 6 处且无残留 `box-shadow: 0 0 0 3px rgba(`、强弱选中各 6/4 处确实引用对应令牌、`--sel-ring` 5 处、`.wb-tbtn.on` 已消失、徽标族带 `font-weight: 700`、重复选择器各只剩一处、`--pl-name-fs` 已声明、十个新阶梯令牌齐备。
- **G 段运行时族几何**：在 5 个页面上实测每个族成员的 `height / border-radius / font-size / font-weight / padding`，断言「同族圆角只有一个值」「控件族高度全部落在 22/26/28/30/36/44 阶梯上」「徽标族字号 11px、字重 700、内边距一致」—— 把「统一」变成可回归的数字，而不是目测。

回归：`verify-round22.js`、`verify-round29-uiux.js`、`verify-round32-srcref-tasks.js`、`verify-round40-modelcfg.js`(28)、`verify-round42-text.js`(67) 全绿；`verify-round17d-studio.js` 仍只有那条数据性过期断言失败。

### 本轮明确没做(避免半吊子)

- 三处手写的上传弹窗(assets / 补给资产 / 资产选择器)合并成一个 `uploadDialog()`，以及分镜工作台里整份复刻的 AI 生图面板改为复用 `ImagesView` —— 两处都是 ~200 行的抽取，值得单独一轮。
- 筛选/分页/滚动位置在刷新后的持久化(目前只有主题与文本模型进 localStorage)。



## 第四十五轮优化(需求三十 · 浅色模式换族「青白 · 疏朗」)

需求：「优化浅色模式页面样式，更清新大气，不要原来的黄色主题」。上一轮的浅色只是把鎏金压暗成 `#a8823c` 系，色族没换，所以整体仍是一张黄纸。

**第一版只换了色(黛蓝 #2f6089)，反馈是「还不够清新大气」。** 复查截图才看清问题不在色相：画布 `#fbfcfe` 与卡片 `#ffffff` 几乎同色 → 整页没有层次；到处是 1px 发丝线 → 像表格不像版面；选中芯片、分页当前页、上下文标签页全是一排深色实底 → 闷；页头标题 17px、表格行 11px、卡片间距 16px → 挤。**「清新大气」是空间与层级问题，换色只解决了一半。** 第二版因此重定为「青白 · 疏朗」。

### 令牌(全部只写在 `section 29`，组件规则一行未改)

| 令牌 | 深色(不变) | 浅色 | 说明 |
| --- | --- | --- | --- |
| `--bg` / `--surface` | `#0b0a08` / `#14110d` | `#f4f8fc` 冷雾 / `#ffffff` | **画布与卡片差出一档，卡片才浮得起来** |
| `--line` / `--line-strong` | `rgba(217,189,130,.14/.30)` | `rgba(23,43,66,.09/.18)` | 描边退到几乎看不见，分层交给影子 |
| `--card-shadow` | `none` | `0 1px 2px …, 0 10px 24px rgba(23,43,66,.07)` | 新增令牌：统计卡 / 媒体卡的浮起 |
| `--gold` / `--gold-fill` | `#e3b45e` / `#f5d07e` | `#2a76ba`(青蓝，比靛蓝更亮更透) | 白字 4.8:1 |
| `--gold-text` / `--info` | `#e3b45e` / `#7aa7d9` | `#1d5c93` / `#1d5c93` | 强调字与小标签走深一档，11px 也过 AA |
| `--gold-ink` | `#191307` | `#ffffff` | 色块上的字 |
| `--sel-fill / --sel-ink / --sel-line` | `var(--gold-fill) / var(--gold-ink) / transparent` | `#e7f2fb / #1a5588 / #c2dcf2` | **新增令牌：选中态与主行动分离** —— 实心只留给唯一的主行动按钮，芯片/分页/上下文标签一律淡蓝底 |
| `--gap / --gap-sm` | `16px / 12px` | `20px / 16px` | 网格留白 |
| `--pad-card / --pad-card-sm` | `20px / 16px 20px` | `24px / 16px 22px` | 卡内白 |
| `--row-py / --head-py` | `11px / 10px` | `14px / 12px` | 表格行高 |
| `--pad-page` | `24px` | `32px` | 页头上方留白 |
| `--fs-page-title` | `17px` | `22px` | 页头标题层级 |
| `--r-sm / --r-md / --r-lg` | `8 / 12 / 16` | `9 / 14 / 20` | 圆角更柔 |
| `--ok / --warn / --danger` | 定位绿 / 琥珀 / 朱红 | `#177a52 / #a85a12 / #c53a32` | 语义不动 |

### 做法

1. **色族**：新增 `--accent-rgb / --accent-hi-rgb / --accent-deep-rgb` 三组 RGB 三元组令牌，把 26 处硬写的品牌金(`.avatar`、`.dash-hero .dh-avatar`、`.brand-logo`、`.topbar::before`、`.tag-cat`、`.select-box`、`.toast::after`、6 处输入框聚焦光环、`.pl-token.ok/.no`、`.pl-hint-name:hover` …)改写成 `rgba(var(--accent-rgb), a)` —— 浓度逐条保留，深色像素不变，浅色整族翻青蓝。这是上一轮 `--film` 的同一手法。
2. **空间与层级**：新增 `--gap / --gap-sm / --pad-card / --pad-card-sm / --row-py / --head-py / --pad-page / --fs-page-title / --card-shadow / --sel-*` 十个令牌，取值在深色里全部等于原值(`--gap: var(--sp-4)`、`--card-shadow: none`、`--sel-fill: var(--gold-fill)`…) —— 组件规则改成引用它们，于是浅色放宽留白、卡片浮起、选中态转淡，**深色一个像素都没变**。
3. 修掉一处 JS 内联白雾：后台用户表「用户」角色标签写死 `background:rgba(255,255,255,.06)`，浅色下等于没有底色 → `rgba(var(--film), .06)`。
4. 浅色段自带的暖色字面值全部重写：氛围径向光、光球、顶栏发丝线、`::selection`、滚动条、`.auth-poster`、`.brand-name/.auth-title/.cmdk-mark` 渐变字、`.pl-token.ok`(青蓝实底 + 白字，语义仍是「已链接」)、图片浮层与遮罩的墨色基座(`31,35,41` → `18,32,48`)、缩略图占位灰；`body::after` 颗粒 .02 → .012(浅底上不该有噪点)。

### 验证

`test/verify-round44-light-menu.js` 由 199 项扩到 **232 项全过**：

- **静态 · 色**：浅色品牌令牌必须 b 通道 > r、`--gold-ink` 浅色下是白字、浅色段禁止出现旧鎏金字面值、≥18 处品牌色雾走 `--accent*-rgb`、深色 `--gold:#e3b45e` 与 `--accent-rgb:227,180,94` 仍在(证明两套互不影响)。
- **静态 · 空间**(本轮新增，防的就是「只换色」)：浅色画布与卡片的相对亮度必须差 ≥.02、`--card-shadow` 浅色非 none 而深色必须是 none、`--gap/--pad-card/--row-py/--pad-page/--fs-page-title` 五项浅色必须逐项大于深色解析后的实际值、`--sel-fill` 浅色必须是高亮度淡底且 `--sel-ink` 在其上 ≥4.5:1、`.cat-chip.on/.pg-btn.on/.ctx-tab.active` 确实引用了 `--sel-*`、浅色描边透明度必须比深色更淡。
- **运行时**：12 个页面 × 浅色的每个可见元素，`color / background / border / outline` 命中旧金色清单(22 个字面值)即失败 —— 这是「不要黄色主题」的可执行定义；琥珀/朱红是语义色按值放行。另加 **F 段登录页**(清 cookie 后量测未登录外壳，此前 `#authRoot` 不在覆盖范围内)。

回归：`verify-round22.js`、`verify-round29-uiux.js`、`verify-round40-modelcfg.js`(28 项)、`verify-round42-text.js`(67 项)全绿；`verify-round17d-studio.js` 仍只有那条数据性过期断言(时长档位 13 档)失败。



## 第四十四轮优化(需求二十九 · 浅色模式全站适配 + 资产库「更多」面板被覆盖)

需求：「1、完善浅色模式页面适配，当前有些页面没有完全适配；2、资产库的『更多』面板被覆盖」。

### 改前实测(无头 Chrome · 12 个页面状态 × 深浅两套主题)

| 现象 | 根因 |
| --- | --- |
| 资产库「更多」菜单第 3 项「新建文件夹」点不到，`elementFromPoint` 命中的是底下的卡片 | `.content > *:first-child` 的入场动画用了 `animation-fill-mode: both`，动画结束后 `.page-head` 上永久留着 `transform: matrix(1,0,0,1,0,0)` —— **任何非 none 的 transform 都会造出一个层叠上下文**，于是面板的 `z-index:120` 只能在页头内部生效，压不到后面按文档顺序绘制的卡片 |
| 浅色下「开始生图 / 新建项目 / 上传素材 / 添加模型 / 保存设置」全部退化成一行黑字(用户截图指的就是这个) | 浅色段用 `html[data-scheme="light"] .btn{background:#fff}` 整条覆盖按钮，「属性+类」权重 (0,2,1) 高于组件自己的 `.btn-primary`(0,1,0)，金色填充与 `border-color:transparent` 一起被压成白底白边 |
| 浅色下看不出哪个分类芯片是选中的、勾选中的方框仍是深灰 | 同一类权重陷阱：`.cat-chip` 压过 `.cat-chip.on`、`.em-size-tag` 压过 `.em-size-tag.on`、`.wb-tbtn` 压过 `.wb-tbtn.active`、图片浮层组的 `.asset-check` 压过 `.asset-check.on` |
| 顶栏头像、生成记录计数、参考资产计数、运动强度数值、追加新分镜…金字 3.2~3.6:1 | 这些规则写的是装饰金 `var(--gold)`(浅色 #a8823c)，而设计系统规定小号金字要用 `--gold-text`(#8a6a2c，5.05:1) |
| 存储条 / 任务进度条 / 生图卡片进度轨在浅色下「不存在」 | 轨道底色硬写 `rgba(255,255,255,.07)` —— 白雾压在白卡上等于透明 |
| 主题管理页色板里深色样本与白底糊在一起；通知计数白字压亮红 3.46:1 | 缺少描边 / 缺少「印在语义色块上的字色」令牌 |
| 浅色下**每张项目卡都像是已勾选**(左上角方框里始终有个白对勾) | 图片浮层那条 `… .asset-check { … color: #ffffff }` 把勾选框用来藏对勾的 `color: transparent` 覆盖掉了 |
| 右击菜单会跟着路由飘到下一个页面 | `.ctx-menu` 挂在 `body` 上，只靠「下一次点击」自毁，而前进/后退、⌘K 跳转都没有点击 |

### 改法

1. **层叠上下文**：入场动画改 `backwards`(有延迟的元素本来就用 backwards)，并给 `.page-head` 补 `position:relative; z-index:30` 兜底 —— 页头里的下拉面板从此永远压在内容栏(卡片网格 / 各自滚动的分栏)之上。
2. **浅色模式改成「只换令牌，不换组件」**：新增 `--film`(薄雾底色：深=白雾 / 浅=墨雾)并把 37 处 `rgba(255,255,255,.0x)` 底纹改写成 `rgba(var(--film), .0x)` —— 每条规则保留自己原本的浓度，深色模式像素不变，浅色模式自动翻成看得见的墨雾。据此删掉浅色段 4 组权重压人的整条覆盖(`.btn`、`.cat-chip/.ig-cap-chip`、15 个 `.icon-btn/.wb-tbtn/…`、`.input/.select/.textarea`)，填充与选中态交还组件自己；浅色段只留两类必要覆盖(压在图片上的浮层、语义色浓度补偿)。
   - 顺手修掉一条**从未生效**的选择器 `html[data-scheme=light] html[data-scheme=light] .dash-new-card`(自嵌套)。
   - 新增 `--ok-ink / --warn-ink / --danger-ink`：语义色块上的字色(浅色下翻白字)，通知计数由 3.46:1 → 5.0:1。
   - 勾选/选中态在浅色下补回鎏金：`.asset-check.on`、`.wb-check.on`、`.ig-pick-item.sel .ig-pick-check`；并把浮层组的白字限定在**标签类**浮层上，勾选框的 `color: transparent` 交还组件。
3. **金字走 `--gold-text`**：29 条小号金色文字规则(`.avatar`、`.ws-ref-count`、`.ig-res-title b`、`.ws-param > label b`、`.pl-chip`、`.ws-add-shot`、`.wb-script-btn`、`.ws-recs-run` …)。深色下 `--gold-text == --gold`，视觉零变化。
4. **浅色层级与底色微调**：`--ink-3` #6c7482 → #636b79(分页/次要文字在 `--surface-2` 上由 4.4:1 提到 4.88:1)，`--elev-2/--elev-3` 改双层阴影(紧影+散影，白面板压白页面才分得开)，弹窗遮罩 .30→.34，主题色板小圆点加 1px 描边。
5. **路由切换收掉右击菜单**：`App.route()` 里清 `.ctx-menu`。

### 验证

新增 `test/verify-round44-light-menu.js`：**199 项全过**，五段 ——
A 静态契约(`--film` 存在且浅色翻转、组件底纹不再出现白雾字面量、浅色段不得再整条覆盖 `.btn/.cat-chip/.icon-btn/.wb-tbtn/.em-size-tag/.input/.select/.textarea`、浮层组不得给勾选框强设白字、无自嵌套失效选择器、`.page-head` 有 z-index、入场动画不用 `both`)；
B 运行时量测 × 深浅 × 12 页面(文字对比度 AA、控件与所在表面同色、被别的内容盖住的可见控件、文字裁切、文档横向溢出、深色残留 —— ≥20px 才算「表面」，品牌/语义填充按令牌值白名单放行)；
C 三个「更多」下拉 + 右击菜单的每一项中心点必须命中面板自身(深浅各测)；
D `.page-head` 动画结束后 `transform` 必须为 `none`、浅色主按钮实心且比次按钮醒目、选中芯片/当前页/勾选框与未选中可分辨、未勾选的对勾仍然隐藏、切路由后 `.ctx-menu` 不残留；
E 窄屏 980×620 与矮屏 1440×560 回退整页滚动后，「更多」面板依然完整可点。

回归：`verify-round17d-studio.js`(仅 1 项数据性过期断言「时长档位 13 档」，第三十九轮已记录)、`verify-round22.js`、`verify-round29-uiux.js`、`verify-round32-srcref-tasks.js`、`verify-round40-modelcfg.js`、`verify-round42-text.js`(67 项)全绿；`verify-round23.js` 2 项、`verify-round28-fixes.js` 2 项仍是既有的故意过期断言(字面色值 `#d4af6e`、第三十三轮前的「短边 × 1.5」换算)。



## 第四十三轮修复(刷新不再跳回第一个标签 · 后台子标签进地址栏)

现象(用户报)：「刷新时都会跳到第一个页面；在任务监控刷新，刷新成功会跳到模型设置」。

实测定位：顶层路由是好的 —— 在 `#/images`、`#/assets` 刷新仍停在原页；**只有后台管理的子标签会丢**，因为它只存在 `AdminView.state.tab` 里，地址栏始终是 `#/admin`，刷新后按初始值渲染成第一个标签(模型管理)。

修复：

1. 子标签写进地址：`#/admin/tasks`、`#/admin/settings` …… `app.js` 的路由把第二段作为 `params.tab` 传给 `AdminView.render`；不在 `ADMIN_TABS` 白名单里的值回落「模型管理」(不白屏)。
2. 点标签改为写 `location.hash` 而不是直接调 `switchTab` —— 于是**刷新停在原标签、浏览器后退能在标签之间回退**，地址还可分享。
3. 顺带修顶部导航高亮：原来 `path === r` 的精确匹配会让 `#/admin/tasks` 这类子路径**丢掉「后台管理」的高亮**(`/projects/xx` 早有特例，admin 漏了)。
4. 同轮补：任务监控里文本任务原先整列显示「—」，现按 `润色剧本 · 91→287 字 · 1s`、`拆分镜 · 118→900 字 · 13 镜` 渲染。

验证：`verify-round42-text.js` 由 60 项加到 **67 项全过**，新增 7 项地址栏用例(直达 `#/admin/tasks` 打开的就是任务监控且有数据行、子路径下顶部导航仍高亮、点标签写入地址、**刷新后停在原标签**、后退回到上一个标签、未知子标签回落不白屏、文本任务参数行可读)。回归 `verify-round29-uiux.js`、`verify-round22.js` 全绿。

已知无关失败：`test/qa-round17b-nav.js` 报 `Cannot read properties of null (reading 'scrollWidth')` —— 它是初版提交里的量测脚本，量的是 `.ws-nav` / `.ws-crumb`，而 v4 改版已明确取消 `ws-nav`(见 `public/js/views/projects.js` 注释)，属陈旧探针，与本轮无关。


## 第四十二轮优化(接入文本模型 · 剧本与文字处理)

需求:「添加常用文本处理模型(gpt、claude、deepseek…)，能够处理剧本和文字」。

### 现状盘点(全部免费查得)

平台此前**没有任何文本模型代码**(`chat/completions` 全库零命中)，剧本字段是 `shots.script`(分镜级)与 `episodes.script`(分集级)。手上 Key 能出的文本模型:

| 来源 | 可用文本模型 | 备注 |
|---|---|---|
| Agnes(两把 Key) | `agnes-3.0-flash`、`agnes-2.5-flash/pro/pro-alpha/pro-beta` | `.cn` 端点实测 2.3s 返回；`apihub` 那把 Key 对 chat 返回 401(两把 Key 不通用) |
| 智谱 | 11 个 GLM(`glm-4.5` … `glm-5.3-flash/flashx`) | Flash 档免费，本轮未接入 |
| 百炼 | 180 个模型，含 `deepseek-v4-flash/pro`、`kimi-k3`、`qwen3.8-max/flash` | 有免费额度，本轮未接入 |
| 中转站 ys666 | **无 chat 模型**(只列媒体) | gpt/claude 走不通这家 |

### 接入的模型(3 个，均实测通过)

| 模型 | id | 计费 |
|---|---|---|
| `Agnes 3.0 Flash 文本（免费）` | `m-1e470555e38fb184` | `is_free=1`，0 积分 |
| `中转站 GPT-6.1 Sol 文本` | `m-8c9b3be73e9fe338` | 1 积分/次 |
| `中转站 DeepSeek V4 Flash 文本` | `m-278e574f3c8e41f8` | 1 积分/次 |

默认文本模型 = 免费那个(系统设置可改)。**⚠ 提醒**:后两个会把剧本文本发到站外第三方域名(其中一家的真实域名是 punycode 编码的中文域名)，且 API Key 已出现在会话记录里 —— 建议用轮换就轮换，敏感剧本别走第三方通道。

### 实现

1. `models.type` 新增 `text-generation`。此前 `POST/PATCH /api/admin/models` 会把未知类型**强转成 `image-to-video`**，`normalizeRulesInput` 的协议白名单也不认 `openai-chat` —— 两处都补上；模型有效性检查同步放行。
2. 新增 [server/textgen.js](server/textgen.js)：`openai-chat` 适配器(`rules.create.path/body/timeout_ms/headers` + `response.content_path` 可配，延续「不写死网关」)与 **5 个内置任务模板**：润色剧本 / 扩写细节 / 压缩精简 / 转成视频提示词 / 拆成分镜。**system 提示词只在服务端**，前端只能传 `task` 枚举 + 待处理文本 —— 这个端点不是通用 LLM 代理。
3. 新增 [server/api/text.js](server/api/text.js)：`GET /api/text/models`(模型 + 任务枚举 + 单价)、`POST /api/text/complete`。按次计费(新设置 `creditPerText`，免费模型恒 0)，每次调用落一条 `tasks`(`type='text-generation'`，`params` 记 `chars_in/chars_out/usage/ms`)让后台任务监控看得到失败原因，**失败自动退分**；字数上限按模型 `rules.limits.max_chars`(默认 2 万)。
4. 拆分镜的 JSON 容错(实测模型会加 ```json 围栏、把 duration 写成字符串、混入无文案项)：剥围栏 → 截首个 `[...]` → 逐条校验 → `duration` 转数字并夹到 1–60 → 丢弃空文案 → 全空则报可读错误。
5. 前端**复用既有入口，不新增常驻占位**：分镜「剧本文案」标题行右侧一个 `✨ AI 改写` 按钮 → 菜单四项(带计价标注)+「撤销上一次 AI 改写」+ **底部直接列全部文本模型可一键切换**(当前项打勾并禁用，选择记在 localStorage，只影响本机、不改别人的默认)；工具栏 `✂ AI 拆分镜` 按本集原文批量追加分镜(**只追加、绝不覆盖已有分镜**)；系统设置加「文本处理单价」与「默认文本处理模型」。

### 顺带修掉的五个真问题

- `server/db.js` 的「空参数模板补标准参数」迁移会把文本模型的空 schema 填成**视频参数(时长/帧率/运动/种子)**——已排除 `text-generation`，并还原被写坏的 3 行。
- `/api/styles/models` 对文本模型走的是**视频适配器**探测，后台把 `openai-chat` 标成「Agnes Flash 适配」——按类型分流到 `textgen.detectProtocol`。
- `✨ AI 改写` 按钮被卡片右缘裁字(`.ws-icon-btn` 固定 26px 见方)——放开宽度并让提示文字可截断。
- 后台「检查 / 自检」没跟着文本模型走：`runModelCheck` 的协议白名单只有视频/生图，于是文本模型一律报 **`生成规则协议未知: openai-chat`**；探活又固定按视频协议打 `/videos`（实测消息里出现「创建路径 /videos 探活通过」）。现在按类型分流：文本模型校验 `openai-chat`、探活打 `/chat/completions`(无效模型名，不建单不计费)。
- 文本模型点「端到端自检」原先会掉进**视频**自检分支(造测试源图 + 提交 image-to-video 任务)。现改为真发一次极短 chat 请求并落 `tasks`(带 token 用量)，超时上限 45s 快速失败；免费文本模型自检 0 积分。
- `PATCH /api/admin/settings` 对 allowed 清单里的**所有**字段统一做 `Number()` 转换，于是字符串型的 `defaultTextModel` 被转成 `NaN → null`，「默认文本模型」选了也存不住(实测该键落库为 `null`，界面永远显示「自动」)。现按字段分流：`gpuPool`/`defaultTextModel` 走字符串，其余走数字，且设置的 id 必须是**已启用的文本模型**，否则 400。

### 验证

- 新增 `test/verify-round42-text.js` **67 项全过**(第四十三轮又补了 7 项地址栏用例)：A 段单元 12 项(模板枚举、system 不可注入、拆分镜四类脏输出、计价优先级)；B 段 Mock chat 网关 11 项(请求体形态、`rules` 改 path/内容路径、HTTP 错误、空内容、超长/未知任务拦截)；C 段真实接口 14 项(模型清单、四类 400、`tasks` 落库与 token 用量、免费 0 分/付费扣分、默认文本模型能存住且真的生效、文本模型不混入生图列表)；E 段后台链路 7 项(文本模型检查通过且探活打 /chat/completions、自检走 chat 落 tasks 且免费不扣分、错配 openai-video 仍被拦、临时模型清理干净 —— 用 Mock 网关保证不依赖服务商当天的排队速度)；D 段界面 22 项(入口存在且不被裁切、菜单四项带计价、模型可一键切换且请求带上 model_id、后台类型与协议、设置页字段)。**套件本身零真实费用**(D 段只开菜单不发请求)。
- 真实调用(免费模型 + 1 次 DeepSeek)：`polish` 91 → 287 字；`to_video_prompt` 输出一段式可用提示词；`split_shots` 13 镜；`condense` 走 DeepSeek 扣 1 分(余额 10037 → 10036)。
- **浏览器端到端**(临时项目，跑完已删)：`AI 拆分镜` 1 → 10 镜(标题/时长/画面描述都成立)；`扩写细节` 49 → 396 字且 textarea 同步、工作记录持久化 10 镜；`压缩精简` 64 → 27 后菜单出现「撤销上一次 AI 改写」，点击还原到 64 字并清除撤销栈；无横向溢出、无未捕获异常。
- 回归：`verify-round22.js`、`verify-round25-imagegen.js` 40 项、`verify-round29-uiux.js`、`verify-round39-quota.js` 39 项、`verify-round40-modelcfg.js` 28 项、`verify-round41-async-image.js` 17 项全绿。其中 round40 的一处断言修好了依赖：它按**精确大小写前缀**找模型选项，管理员把 `agnes-image-2.5-flash` 改名成 `Agnes-image-...` 后静默读到上一个模型的读数 —— 改成大小写不敏感并在找不到时显式失败。


## 第四十一轮修复(中转站异步生图「已扣费却没有结果图片」→ `rules.async` 收单)

### 现象与根因

用户配置 `gpt-image-2.5-sunburst` `m-4002e640ddb6f973`(中转站 `https://ys666.site/v1`),站内显示已扣费,平台任务 `t-239ed85c1c9d30bb` 却失败,错误是 `生图响应中没有结果图片: {"data":[],"id":"creative_06f3…","status":"queued"}`。

根因:该模型(及同系 `-flare`)在 OpenAI 兼容端点上是**异步受理** —— POST 立刻回 HTTP 200 + `status:"queued"` + `data:[]`,图要另走「任务状态 → 素材清单 → 素材内容」三段取件。平台的 `openai-image` 只认同步响应,于是「已受理」被当成「无结果」判失败,而网关照常计费(实测 `actual_cost` 0.08 美元/张)。

### 实测契约(三段取件全部要求 `x-creative-contract-version: 1`,缺头返回 409 `CREATIVE_CONTRACT_VERSION_MISMATCH`)

| 步骤 | 端点(相对 `api_base`) | 要点 |
|---|---|---|
| 提交 | `POST /images/generations` | OpenAI 兼容体 `{model,prompt,n,size}`;**`size` 不参与预校验**(`1x1` 照样受理),`n`/`prompt` 会 400 |
| 状态 | `GET /creative/tasks/<job_id>` | `queued → running → completed`;带 `output_count / success_count / actual_cost`,**不含图片地址** |
| 清单 | `GET /creative/assets?job_id=<job_id>` | 返回 `[{id, mime_type, size_bytes,…}]`;只有 `job_id=` 过滤生效(`task_id=`/`job=` 会被忽略返回全量) |
| 内容 | `GET /creative/assets/<asset_id>/content` | 图片字节(PNG,内嵌 C2PA 出处元数据) |

顺带记录:该站还有 `GET /v1/creative/tasks`(任务列表)、`GET /v1/videos/<id>`(视频侧取件,同一个契约头),而 `GET /v1/models` 会返回每个模型的 `parameter_schema` 与 `x-operations` —— **免费的契约发现入口**,排查新网关先打它。

### 修复

1. `server/imagegen.js` 新增**规则驱动**的异步收单 `rules.async`:`job_id_path / pending_field / pending_values / task_path / task_headers / status_field / status_values / error_field / assets_path / assets_data_path / asset_id_field / content_path / interval_ms / timeout_ms`。路径一律相对 `api_base`,`<job_id>` `<asset_id>` 令牌自动 URL 编码;素材清单里每条都落盘,下载仍走按魔数嗅探的 `writeImageBuffer`;超时/失败都带上 task id 与「图仍在服务方,可到站内核对」的提示。
2. `normalizeRules()` 的合并键补上 `async` —— 原来只并 `create/response/limits`,新规则会被静默吞掉(测试第一条就抓到了)。
3. 未配 `rules.async` 时不再抛误导性的「响应中没有结果图片」,改为点明「网关已受理(task …)但按异步出图,请补 `rules.async`,否则图取不回来而网关照常计费」。
4. `downloadImage()` 支持带请求头(取件端点要契约头)。
5. `m-4002e640ddb6f973`(sunburst)已按上表配好规则并跑通。同系另外两个也建成模型:`中转站 gpt-image-2.5-flare` `m-c152926aaeaabec4`(像素尺寸形态,复用同一段 `async`)与 `中转站 Nano-banana(gemini-3.1-flash-image)` `m-f688afb4fdf6f778` —— 后者按 `/v1/models` 的 `parameter_schema` 是**档位收参**(`resolution` 512/1K/2K/4K + `aspect_ratio`),故 `create.body` 用 `<resolution>`/`<aspect_ratio>`(`size_mode=tier`);两者的 `async` 段是惰性兜底,网关若同步返回则完全不参与。两个新模型只做了**零成本可用性预检**(`n=99` → 400 `invalid_n`,证明 model id 与 Key 权限通过、未建单),真实出图尚未验证;图生图能力先关掉(其 multipart `/images/edits` 路径未验证,不暴露会计费却可能失败入口)。

### 验证

- 新增 `test/verify-round41-async-image.js` **17 项全过**:Mock 网关复刻 `queued → running×2 → completed`、缺契约头 409、两条素材全部落盘、PNG 魔数、按 `job_id` 过滤、失败态与超时态文案、未配 `async` 的可读报错。全程零真实费用。
- **平台内真实端到端**:`t-51edd408b654ef89`(16:9 · 2K)→ **36s completed · cost 2 积分**,资产 `a-f4c61c922b38bf3d` → `data/uploads/u-admin/a-f4c61c922b38bf3d.png` **1536×1024 · 1.85MB PNG**,画面与提示词完全一致(银发仙冠、红丝带、银黑多层汉服、纯白背景全身立绘)。
- 回归:`verify-round25-imagegen.js` 40 项、`verify-round39-quota.js` 39 项、`verify-round40-modelcfg.js` 28 项全绿。
- 后端有改动,3088 已重启为最新代码(PID 97643,日志 `/tmp/vf-3088.log`);重启前按第四十轮的教训把「有 `processing` 任务就不重启」做成了硬门槛。

### 诊断成本(如实记录)

为定位这套契约,除用户原任务外又建了 **3 个异步单**(`size:"1x1"` 探针、首发 A、重投 B,各 0.08 美元)。原因:该网关的 `size` 不参与预校验,所以「用非法参数探契约、不建单不花钱」这条老办法对它无效 —— 对异步受理型网关,只能靠 `/v1/models` 元数据与站内已有 task id 反查。用户原先那张已付费的图已从站内取回:`/tmp/recovered-06f3e122-1.png`(2.34MB PNG)。


## 第四十轮修复(模型计费/额度可手动设置 · 画幅比例参数在生图页丢失)

### 改前实测

1. **生图页没有「画幅比例」下拉**:`百炼 Qwen-Image 3.0（免费额度）` 与 `智谱 CogView-3-Flash（免费）` 的面板只有「分辨率 + 张数」(用户截图印证),而两者 `params_schema` 里都实打实写了 5 个比例档。根因是前端 `ImagesView.ratioDef()` 只认 **`ratio`** 键,而这两类模型(以及全部视频模型)的模板键是 **`aspect_ratio`** —— 服务端 `imagegen.ratiosOf()` 与 `tasks.js` 早就双键兼容,**只有前端漏了**,所以「后台设了参数、生成时选不了」。
2. 后台编辑器同样只按 `ratio` 回显比例标签,保存时又写回 `ratio` → 键名继续分裂,下次改模型还会把 `aspect_ratio` 悄悄换掉。
3. 「支持的分辨率档」留空时编辑器**一律塞 `1K,2K,4K`**,于是只支持单档的智谱模型也有三档可选:实测 `t-131adb74ae60951f` 选了 4K,服务端就近吸附回 1024x1024,但任务参数里记的是 `resolution:"4K"` —— 属于「能选但无效」。
4. `is_free` 字段后端 `POST/PATCH /api/admin/models` 都不接收,第三十七 / 三十九轮的免费标记全靠 SQL 置位。

### 修复

1. **后端**:`POST /api/admin/models` 的 INSERT 与 `PATCH` 都接受 `is_free`(免费 = 不扣平台积分,与服务商是否收费无关)。
2. **编辑器新增控件**:「计费方式」(免费 ⇄ 按积分)与「免费额度」(总量 + 单位 自动/张/秒,写入 `rules.quota`,留空即取消登记);选免费时积分输入禁用、hint 改为「此价不生效」。至此模型侧**不需要再手写 JSON 或改库**就能设:启用、并发、计费、免费额度、积分单价、能力勾选、比例/分辨率/尺寸清单、张数上限、协议规则。
3. **清单同源**:保存生图模型时把界面上的分辨率档与画幅比例一并写回 `rules.limits.resolutions` / `rules.limits.aspect_ratios`,让「下拉能选什么」和「服务端按什么吸附」永远一致。
4. **双键读取**:`ImagesView.ratioDef`、分镜生图弹窗 `renderParams`、编辑器回显三处统一 `aspect_ratio` 优先 + 兼容 `ratio`;编辑器保存改写 `aspect_ratio`。存量 `ratio` 模型(本地占位、`agnes-image-2.5-flash`、`gpt-image-2`)行为不变,下次保存自动归一。
5. **档位不再强塞**:`parseResTiers()` 留空时优先取 `rules.limits.resolutions`,两者都没有才回退 `1K/2K/4K`;输入框回显同样优先取规则清单。
6. **数据修正**:`智谱 CogView-3-Flash（免费）` 的 `params_schema.resolution` 由 `["1K","2K","4K"]` 改回 `["1K"]`,与 `rules.limits.resolutions` 对齐。

### 验证

- 新增 `test/verify-round40-modelcfg.js` **28 项全过**:A 段在**隔离实例**(`PORT=3097` + `DATA_DIR` 临时库,跑本轮新代码)验证 `is_free` 建/切、`rules.quota` 登记与取消、按张累计已用、切按积分后真实扣分、视频 `unit` 缺省推断为秒 —— 全程只用本地占位生图(`img-ffmpeg`),不外呼任何网关;B 段在真实页面验证 `ratioDef` 双键、智谱/百炼生图页重新出现画幅比例、旧键模型不受影响、编辑器回显与控件联动、参数模板预览键名归一。
- 回归:`verify-round39-quota.js` 39 项、`verify-round26-imgopts.js` 37 项、`verify-round29-uiux.js` 全绿。

### 交付时注意

- 后端 `is_free` 改动需要重启 3088 才生效,已重启为最新代码(PID 90370,日志 `/tmp/vf-3088.log`),并用一个临时本地模型验证过 `POST is_free=1 → PATCH 0 → PATCH 1 → 列表 free_quota → 删除` 全链路。
- **本轮重启有一次打断**:重启瞬间库里正有一条 `processing` 的生图任务 `t-c0bcfdf97c02fd91`(它的模型 `m-2fea401c7891d1b2` 也已被删除),被一起带走。开机清扫把它重投后,worker 在调用网关前就因「生图模型不存在」判失败并**自动退回 2 积分**(`refunded=1`),平台侧无损失;但那一瞬间上游可能已受理计费,这是第三十八轮就写进错误文案的老风险(计费请求不自动重试)。教训:**重启前的 `processing` 判定必须能中止重启**,不能只查不拦。
- 顺带确认:任务进行中删除模型不会留下孤儿任务 —— worker 会重读模型行,以「生图模型不存在」判死并退分(另一条 `t-e69a35f592779012` 同样如此收尾)。


## 第三十九轮优化(智谱 CogView-3-Flash 接入 · 免费额度余量标注)

### 接入前先实测(零成本探针优先)

1. **探针**:`POST https://open.bigmodel.cn/api/paas/v4/images/generations` 带 `size:"1x1"` → **HTTP 400 · 0.2s**
   `{"error":{"code":"1214","message":"size的长宽均需满足512px-2880px之间,且为16整数倍,并保证最大像素数不超过2^21px"}}`
   —— 鉴权与端点确认,参数在服务端预校验阶段就被拒,**不建任务、不消耗额度**,顺带把尺寸约束问全。
2. **真实出图**:`cogview-3-flash`(**免费档,标价 0 元**;`cogview-3` / `cogview-3-plus` 是付费档,未碰)· 1024x1024 → **HTTP 200 · 8.5s**,结果在 `data[0].url`,免费模型**不返 `usage`**。
3. **坑:URL 名义 `.png`,字节是 baseline JPEG**(魔数 `ffd8ffe0`,文件名还带 `_watermark`)。平台 `writeImageBuffer` 本来就按魔数嗅探格式,所以落盘自动成 `.jpg` + `mime=image/jpeg`,**无需改代码**;画面肉眼也无水印。

### 平台内新增模型(纯 rules 配置,无代码分支)

`智谱 CogView-3-Flash（免费）` `m-c3e336b531429365`,复用 CogVideoX-Flash 那把 Key 与 `openai-image` 协议:

```json
{"protocol":"openai-image",
 "create":{"path":"/paas/v4/images/generations","edit":"none",
           "body":{"model":"<model_id>","prompt":"<prompt>","size":"<size>"}},
 "response":{"data_path":"data","url_field":"url"},
 "limits":{"max_count":1,"resolutions":["1K"],
           "sizes":["1024x1024","1344x768","768x1344","1152x864","864x1152","1440x720","720x1440"],
           "aspect_ratios":["1:1","16:9","9:16","4:3","3:4"]},
 "caps":["text-to-image"]}
```

- `is_free=1`(管理端模型接口没有这个字段,仍按前几轮做法 SQL 置位)。
- **端到端**:`t-16e87936c4ab7def`(1:1)→ **8.7s completed · cost=0**,资产 `a-399077a7e6dd40a0` → `data/uploads/u-admin/a-399077a7e6dd40a0.jpg` **1024×1024 · 154KB**,模型统计 `success_count=1 · avg 8701ms`。
- `limits.resolutions` 收成 `['1K']`:智谱合法尺寸都在 1K 量级,此前界面默认送 `resolution:"4K"` 虽被就近吸附不出错,但任务参数里记的是 4K —— 属于「让用户选出会被服务端改掉的选择」。
- 顺带修正:`agnes-image-2.5-flash(免费)` `m-85b87771f761af19` 名字写免费但 `is_free=0`,一直按全局 `creditPerImage=2` 扣积分(历史 38 个任务共扣 316 分,**未追溯退还**),现已置 `is_free=1`。

### 免费额度余量标注(本轮需求 2)

额度总量登记在模型规则 `rules.quota = {"total":10,"unit":"image"}`(`unit` 省略时按模型类型推断:生图=张 / 视频=秒),统计口径与展示面:

1. 新模块 `server/quota.js`:已用量 = **平台内成功任务**的消耗(生图累加 `params.count`,视频累加 `params.duration`;失败/取消不计),`remaining = max(0, total - used)`,用满置 `exhausted`;`rules` 非法或未登记 → `declared:false`,不报错。一批模型只查一次 `tasks`。
2. `/api/styles/models` 与 `/api/images/models` 新增 `free_quota` 字段(付费模型为 `null`)。
3. 界面**复用既有文案位,不新增常驻占位**(公共函数 `modelOptionLabel()` / `freeQuotaText()` 在 `public/js/ui.js`);下拉项里名称已含「免费」的模型(如「百炼 Qwen-Image 3.0（免费额度）」)不再重复标注,只追加余量 —— `<select>` 宽度有限,重复后缀会把余量挤出可见区:
   - 生图页、分镜生图弹窗、工作台视频模型下拉:`百炼 Qwen-Image 3.0（免费额度） · 剩 8/10张`(名称不含「免费」时才是 `xxx(免费 · 剩 8/10张)`);
   - 生图页模型提示行:`免费模型 · 不消耗积分 · 额度剩 8/10张(平台内已用 2张)`,用满时整行变 `⚠ 平台内已消耗满登记额度(10张)，继续提交可能被服务商拒绝`;
   - 后台「模型管理 → 积分」列:`免费 / 额度 剩 13/30秒 · 已用 17`,未登记额度的免费模型显示**「未登记额度」**,tooltip 直接给出 `rules.quota` 的写法。
4. **口径边界(重要)**:只统计走平台的消耗 —— 直连网关、控制台、其他工具的用量平台看不到,所以文案统一写「平台内已用」;也**不做提交前拦截**(百炼已开「用完即停」,超了由服务商拒,平台不替用户猜)。

已登记额度的模型与当前快照(2026-10-26 实测):

| 模型 | 登记额度 | 平台内已用 | 剩 |
|---|---|---|---|
| 百炼 Wan3.0-Video（免费额度） | 30 秒 | 17 | **13 秒** |
| 百炼 Wan3.0-Video Prime（免费额度） | 30 秒 | 10 | **20 秒** |
| 百炼 Qwen-Image 3.0（免费额度） | 10 张 | 2 | **8 张** |
| 百炼 Qwen-Image 3.0 Pro（免费额度） | 10 张 | 3 | **7 张** |
| 百炼 Qwen-Image 2.1 Pro（免费额度） | 10 张 | 0 | **10 张** |
| 百炼 Qwen-Image 2.1 Turbo（免费额度） | 10 张 | 1 | **9 张** |
| 智谱 CogView-3-Flash / CogVideoX-Flash、Agnes 视频与生图、本地占位 | 未登记 | — | 免费池按并发限流,无固定张数,不编数字 |

### 验证

- 新增 `test/verify-round39-quota.js` **39 项全过**:A 段隔离库(`DATA_DIR`)单测统计口径 8 项(张数/秒数累加、失败与取消不计、超出归零、未登记与非法 rules、非免费模型、批量索引);B 段真实库接口契约 + 与直接 SQL 交叉核对 19 项;C 段无头 Chrome 界面 12 项(下拉两种文案形态、提示行、后台额度列与 tooltip、无横向溢出、无未捕获异常)。**全程不调用付费模型,也不提交真实生成任务。**
- 回归:`verify-round25-imagegen.js` 40 项、`verify-round26-imgopts.js` 37 项、`verify-round22.js`、`verify-round29-uiux.js` 全绿。
- `verify-round17d-studio.js` 有 1 项失败「时长档位 13 档(3-15s)」:现有视频模型的时长档是 9 / 29 / 1 档,**已不存在 3–15s 的模型**,属数据性过期断言,与本轮改动无关,按惯例记录不修(不为凑绿灯回退数据)。
- 后端有代码改动,3088 已用新代码重启(PID 78313,日志 `/tmp/vf-3088.log`);重启前确认无 `processing` 任务,`t-845afcc2b35e9bc2`(Agnes 排队延后)的 `next_at` 原样保留,未提前触发。


## 第三十八轮修复(中转站生图「已扣费却失败」:超时放宽 + 断流错误可读)

现象:用户在后台配置中转站 `https://ys666.site/v1` 的 `gpt-image-2`(模型 `m-a926e5630f047611`),中转站显示已扣费,平台任务 `t-59070521afa2daab` 却失败,错误信息只有光秃秃一个词 **`terminated`**(进度 15%,正好是「等网关返回」那一步)。

### 根因

1. `server/imagegen.js` 的 `postJSON` 只把 `fetch()` 包在 try 里,**`await res.text()` 在 try 外面**。网关已受理并在回传响应体中途掐断连接时,undici 抛的是 `TypeError("terminated")`,它绕过所有友好文案分支直接成为任务错误 —— 既看不出发生了什么,也不知道钱已经花了。
2. 生图是同步长请求,超时原先写死 **120s**;gpt-image 一类模型经中转站单张常要 30s~数分钟,稍有抖动就整段失败,而上游已经出图计费。

### 修复

1. 新增 `fetchText(url, init, label)`:**发请求与读响应体同在一个 try**,中断/超时统一输出「生图请求在 Ns 后中断(…);网关可能已经出图并扣费,请先在服务商处核对账单再决定是否重试(重试可能重复计费)」。文生图与图生图(multipart)两条路径都改走它 —— 计费动作**不做自动重试**,避免重复扣费。
2. 默认超时 **120s → 900s**,并可按模型 `rules.create.timeout_ms` 覆盖(延续「参数不写死」)。
3. `downloadImage` 的 `res.arrayBuffer()` 也移进 try 并保留 3 次重试(拉取已生成的图片不重复计费,可以安全重试)。
4. 同一 bug 家族在视频侧一并修掉:`server/agnes.js` 与 `server/adapters.js` 创建任务时的 `res.text()` 同样在 try 外,现输出「创建任务响应读取中断…网关可能已建单并扣费,请到服务商核对账单后再重试」。

### 验证

- `verify-round25-imagegen.js` 新增「响应中途断流」用例(Mock 网关发完响应头就 `res.destroy()`):**40 项全过**,断言错误文案含「中断 + 核对账单」且不再是裸 `terminated`。
- **平台内真实端到端**:`t-2e3bd9f1e6078ced`(gpt-image-2 · 1K · 16:9)→ **32 秒 completed**,成片 `AI生图_t-2e3b.png` **1536×1024 · 1.84MB** 入库,画面与提示词一致(古风仙侠尊主全身立绘、银冠红绫、纯白背景)。
- 直连对照:同一 Key 直连 `POST /v1/images/generations` **34.8s** 返回 `{created, data:[{revised_prompt, url}], usage}`,图片 URL 2.3s 可下载 → 中转站与模型本身正常,失败纯属平台侧读流处理。
- 回归:`verify-round7-agnes-fix.js` 26 项、`verify-round26-imgopts.js` 37 项、`verify-round27-imgpolish.js` 16 项、`verify-round37-dashscope.js` 23 项、`verify-round37-bigmodel.js` 11 项全绿。

### 顺带修掉的测试隐患

`verify-round7-agnes-fix.js` 的 V2 测试模型不是免费模型,每跑一次会**真实扣掉 admin 50 积分**;余额降到 11 后该场景提交被 402 拒掉、断言拿到 `null`,误报 2 项失败。现测试模型一律 `is_free=1`,并已把上次误扣的 50 积分退回 admin(余额 11 → 61,`credit_logs` 留有「回归脚本误扣退还」说明)。

### 补充:模型「端到端自检」对单取值/窄范围模型一律失败

智谱 `cogvideox-flash` 点自检报:`模型检查未通过:参数 duration: max 需大于 min`。两个真问题:

1. **校验器不允许单一取值**(`server/api/admin.js` 的 `def.max <= def.min`)。只支持 5 秒的模型本来就该声明 `min=max=5`,平台其它环节(`clamp`、工作台时长清单)也都支持单值 range。改为只禁反向区间 `max < min`,并给出「单一取值时让 max 等于 min 即可」的提示。
2. **自检任务参数写死** `{duration:2, fps:24, motion:0.3}` —— 对 `cogvideox-flash`(只支持 5s/30fps)和百炼 wan3.0(2–30s)都是非法值,即使检查通过也会被网关判错。新增 `selftestParams(m)`:参数一律取自该模型 `params_schema` 的默认值(select 取默认项、range/number 取默认或下限),缺省才回退 5s/24fps。

另外两条提示属正常语义,不是故障:「创建路径 … 探活通过(网关应答业务校验: 模型不存在)」是**故意**用假模型名探测路由是否存在;「API 连接成功,但服务未返回模型列表」是这些网关没有 `{base}/models` 列表接口,不影响调用。

验证:智谱自检现在提交 `{"duration":5,"resolution":"1080p","aspect_ratio":"16:9","fps":30}` → 模型检查 `ok`,任务因免费池饱和返回 429 并按阶梯自动重投(观察时已第 5 次、下次 285s 后);百炼自检提交 `{"duration":5,"resolution":"480p",…}` → **completed**,成片入库 `生成结果_t-3ceb.mp4` **854×480 · 5.04s · 1.68MB**。回归 `verify-round12-adapters.js` 29 项、`verify-round22.js`、`verify-round29-uiux.js` 全绿。


## 第三十七轮优化(百炼接入 · 适配器规则能力补齐 · 只用免费额度)

横评五家视频网关(Agnes / Vercel AI Gateway / Hugging Face 路由 / fal.ai / 阿里云百炼)后发现:现有 `openai-video` 适配器只能表达「顶层字段 + `GET ?video_id=`」一种形态,其余网关都卡在**配置表达力**上而不是接口本身。本轮补齐能力,并把百炼的免费额度模型接进平台。

### 适配器能力(`server/adapters.js`,全部由 rules 驱动)

1. **`create.headers`** —— 自定义请求头,值支持 `<model_id>` / `<api_key>` 令牌:百炼要 `X-DashScope-Async: enable`,Vercel 要把模型名放 `ai-model-id` 头。
2. **`create.id_path`** —— 按点路径从创建响应里取任务 ID(百炼是 `output.task_id`);不配时仍按顶层 `video_id/id/task_id`。
3. **`query.path` 支持 `<video_id>` / `<model_id>` 令牌** —— 任务 ID 走路径的 REST 风格(百炼 `GET /api/v1/tasks/<video_id>`)。
4. **`create.nested_media` + `deepFill()`** —— 令牌可用在模板任意深度,百炼的 `input.media:[{type:'first_frame',url:'<first_frame>'}]` 才配得出来。顺带修掉一个老问题:`<first_frame>` / `<images>` 令牌此前解析成内部哨兵 `<__MEDIA_FIRST__>`,写在模板里会把哨兵原样发给网关。
5. 配合既有 `status_values / data_path / video_url_field / error_field` 与上一轮的 `<size_px>`,百炼的 `SUCCEEDED + output.video_url` 无需改代码即可识别。

### 百炼接口契约(实测)

- 提交 `POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`(带异步头)→ `200 {output.task_id}`;轮询 `GET /api/v1/tasks/{task_id}` → `PENDING|RUNNING|SUCCEEDED|FAILED|CANCELED|UNKNOWN`,结果在 `output.video_url`(**24 小时过期**,worker 立即下载入库)。
- `parameters`:`resolution ∈ 480P|720P|1080P`、`ratio ∈ 21:9|16:9|4:3|1:1|3:4|9:16|adaptive`、`duration = -1 或 2..30`;输出固定 30fps、原生带音轨。
- `input.media[].type ∈ first_frame|last_frame|reference_image|reference_video|reference_audio|file|link`;**url 接受 data URI**(网关自行转存 OSS),因此本地开发无需公网回调地址;首帧图最低 240×240。
- 管理端点:`GET /api/v1/tasks/` 列任务、`POST /api/v1/tasks/{id}/cancel` 取消。
- 失败任务不计费(按成功输出秒计费),但**校验通过的调用会真出片**:枚举模型名时 15 个空输入任务秒败(不计费),`wanx2.1-t2v-plus` 空提示词却成功产出 5 秒并计费(样本留作核对)。

### 平台内新增模型(只用免费额度,不碰付费)

`百炼 Wan3.0-Video（免费额度）` `m-c7ee4025027afebe` 与 `百炼 Wan3.0-Video Prime（免费额度）` `m-530e2da19dec2478`:账号侧各 **30 秒免费额度**且控制台已开「**用完即停**」(超出直接被拒,不产生费用),两模型 `is_free=1` 不扣平台积分;参数面板只开放百炼支持的档位(时长 2–30s、480p/720p/1080p、6 种画幅、帧率固定 30)。

### 百炼生图(qwen-image)同样纯 rules 接入

千问生图走**同步** `POST /api/v1/services/aigc/multimodal-generation/generation`,请求体是三层嵌套(`input.messages[0].content[0].text`)、尺寸要 `"宽*高"` 星号格式、结果嵌在 `output.choices[0].message.content[].image`(地址 24 小时过期,失败不计费)。为此 `server/imagegen.js` 补两处:

- **`fillTemplate` 改为递归** —— 生图模板以前只替换顶层键,嵌套位置原样发出;现在任意深度都能用令牌。
- **`sizeModeOf` 认 `<width>/<height>`** —— 用宽高令牌拼尺寸的网关(百炼这种 `宽*高` 形态)同样按 `limits.sizes` 就近吸附,不再被误判成「档位形态」。

新增 4 个模型(各 `is_free=1` 不扣平台积分;对应账号里每个模型 10 张免费额度、控制台已开「用完即停」):`百炼 Qwen-Image 3.0（免费额度）` `m-51b03174a33139c1`、`3.0 Pro` `m-dc384281257c5c91`、`2.1 Pro` `m-1075eb5428bccf42`、`2.1 Turbo` `m-0231065a43596947`。规则里 `limits.max_count=1`、`resolutions=['1K','2K']`(4K 会超开「总像素 ≤ 2048×2048」的限制)、`caps=['text-to-image']`(该端点不做图生图,生图页因此不出现参考图入口);`qwen-mt-image-2.0` 是「图内文字翻译」不是文生图,未接入。

- 平台内真实端到端:`t-cf5d950a3476812a`(1K + 1:1)→ **10 秒 completed**、`cost=0`、参数记录 `size=1024x1024 / size_mode=pixels`,成片入库 `AI生图_t-cf5d.png` **1024×1024 · 1.05MB**;消耗免费额度 **1/10 张**。
- 生图页显示(无头 Chrome):模型清单出现 4 个百炼模型并带「免费」标记、分辨率只剩 `1K/2K`、张数只剩 `1 张`、无参考图入口、输出尺寸读数显示 `1024×1024 · 1K` 并列出该模型支持的尺寸清单,无未捕获异常。

### 智谱 bigmodel(cogvideox-flash)注册为免费视频模型

同一套 rules 能力直接覆盖智谱的异步视频协议,**无需再改适配器**:

- 端点 `POST https://open.bigmodel.cn/api/paas/v4/videos/generations` → 顶层 `id`;轮询 `GET /api/paas/v4/async-result/<video_id>`(命中本轮新加的 `query.path` 令牌);状态 `PROCESSING|SUCCESS|FAIL`,结果在顶层 `video_url`。
- 模型 `智谱 CogVideoX-Flash（免费）` `m-5140d8c72574b472`,`is_free=1`。免费模型只支持 5 秒 / `1920x1080` / 16:9,因此 `params_schema` 把时长、分辨率、画幅、帧率都收成单档 —— 工作台实测四个下拉各自只剩一个值,不会让用户选出被服务端改掉的选择。图生视频走 `create.first_frame_field: "image_url"` 自动注入(支持 URL 或 Base64,≤5M)。
- 顺带修 `openAiNormalize`:失败响应里 `error` 是对象(智谱 `{error:{code,message}}`)时,原先 `String()` 会输出 `[object Object]`;现按 `detailText` 序列化透出真实原因。
- 真实现状:`cogvideox-flash` 免费池按**并发**限流,本机提交持续返回 `429 {"code":"1305","message":"该模型当前访问量过大"}`(同 Key 调 `glm-4-flash` 对话正常,证明是模型容量而非鉴权/请求形状)。429 属第三十六轮的可重试信号,平台会自动延后重投最长 60 分钟,不需要人工盯着。
- 新增 `test/verify-round37-bigmodel.js`(11 项,Mock 智谱):请求体字段与类型、`image_url` 自动注入、`async-result/<video_id>` 轮询路径、`SUCCESS + video_url` 下载成片、`FAIL` 错误对象可读、`429` 抛出 `retryable`。

### 验证

- 新增 `test/verify-round37-dashscope.js`(23 项,Mock 百炼:视频 16 + 生图 7):缺异步头即被拒(反证 `create.headers` 生效)、`input.media` 嵌套结构正确、`duration` 保持数字、`resolution` 出 `480P` 大写档、空 `negative_prompt` 字段被丢弃、`create.id_path` 取到 `output.task_id`、轮询只打 `/api/v1/tasks/{id}`(未回退 `/videos/{id}`)、`SUCCEEDED + output.video_url` 识别并下载成片。
- **平台内真实端到端**(3088 新代码):任务 `t-27c71c11b3d7f0ed` 用 640×360 源图 + `480p / 16:9 / 2s` 提交 → **77 秒 completed**、`cost=0`、远端 ID `288dd4ec…` 记录在案,成片入库 **854×480 · 2.02s · 0.77MB · h264+AAC · 30fps**;仅消耗免费额度 2 秒(剩 28 秒)。
- 回归:`verify-round12-adapters.js` 29 项、`verify-round7-agnes-fix.js` 26 项、`verify-round12-e2e.js` 28 项、`verify-round36-busy-requeue.js` 27 项、`verify-round22.js`、`verify-round29-uiux.js` 全绿。`verify-round28-fixes.js` 有 2 项失败(`2048×16:9 → 3072x2048`、`768×9:16 → 768x1152`),断言的是第三十三轮之前的「短边 × 1.5」旧换算,与现行 `deriveSize`(短边=档位像素 → 3640×2048 / 768×1366)冲突,属陈旧断言,与本轮无关。
- **工作台参数跟随模型**(顺带修):`resolutionOptionsOf` 原先只看 `rules.limits`,不读模型 `params_schema` 的分辨率清单 → 百炼模型会错显平台档位(含不支持的 960P/2K);时长清单原先写死 3–15s。现两处都跟随模型声明(实测分辨率 `480P 854×480 / 720P 1280×720 / 1080P 1920×1080`、时长 2–30s 共 29 项、帧率只剩 30fps、画幅 6 项),载入时的持久化夹取放宽到 1–120 并由 `snapShotSpec` 按模型收敛。


## 第三十六轮优化(视频网关排队已满 → 自动延后重投,不再 50 秒判死)

第三十四/三十五轮补充验证里,`agnes-video-2.5-flash` 已经在 `.cn` 网关端到端出过片,但项目内再次提交仍报 `HTTP 503 video_queue_full`(13:39 的任务 `t-c52ef8f611b5ae97`)。核查:同一账号远端上一条任务 `progress=100` 已完成、没有在途任务占槽,直连间隔 20s 连投 3 次依旧 503 —— **拥堵是分钟级的、且间歇复现**;而创建任务的退避只有 5s/15s/30s(合计约 50 秒),窗口一过就把任务判成「失败」、退积分、等用户手动点「重试」。

### 改动

1. **可重试信号下沉**:`server/util.js` 新增 `BUSY_STATUS / busyError / retryAfterMs`,HTTP 429/502/503/504 抛带 `retryable` 标记的错误,并解析网关的 `Retry-After`。
2. **不再原地干等**:`server/agnes.js` 与 `server/adapters.js`(Agnes Flash / V2 / OpenAI 通用视频三条创建路径)删掉 5s/15s/30s 的进程内退避 —— 排队时占着任务槽没有意义,把等待交给队列。
3. **worker 延后重投**(`server/worker.js` 新增 `failTask()`):命中可重试 → 任务回到 `queued`、写 `next_at`(默认阶梯 **60/120/180/240/300s**)、`params.busy_attempts / busy_since` 记累计;累计等待超预算(默认 **60 分钟**,等待期间不占任务槽、可随时取消)才终态失败,文案写明「视频网关排队已满(…s 内已自动重试 N 次)」。等待期间 **不写 error、不退积分、不计模型失败次数**,首次延后发一条站内通知。
4. **节奏不写死**(承接需求九):模型「生成规则」可写 `busy: { hold_ms: [..] 或 单值, budget_ms: .. }` 逐模型覆盖(阶梯每档 ≥1s、预算 ≥5s 才生效),`Retry-After` 优先于阶梯 —— 新增网关只配规则即可。
5. **队列配套**:`pump()` 只取 `next_at` 到点的任务(按 `COALESCE(next_at, created_at)` 排序,延后任务插队到队尾);`enqueue()` 清 `next_at` 与累计等待 —— 手动点「重试」等于重置预算;`processTask()` 开跑时清 `next_at`。
6. **前端可读**:生成记录在延后期间显示「Ns 后重试」倒计时与「网关排队,已自动重试 N 次」小字,不再呈现为失败态。

### 验证

- **Mock 网关专项**(隔离副本 + 独立数据库,21 项全过):
  - A. 503×2 → 回到 `queued` 且 `next_at` 在未来、`error` 为空、未退积分 → 最终 `completed`,成片入库(640×360),`busy_attempts=2`、远端 ID 已记录、`next_at` 归零;
  - B. 阶梯配 9s 但网关回 `Retry-After: 2` → 实际延后约 2s(头优先);
  - C. 一直 503 + `budget_ms=5000` → 终态 `failed`、错误含「排队已满」、积分只退一次(`credit_logs` 1 条)、模型 `fail_count` 只 +1;
  - D. 延后等待期间点「取消」→ 9 秒后仍是 `cancelled`,不会被 `pump` 复活。
- **回归**:`verify-round7-agnes-fix.js`(26 项)、`verify-round12-adapters.js`(29 项)、`verify-round22.js`、`verify-round29-uiux.js` 全绿;新增 `test/verify-round36-busy-requeue.js`(27 项,独立 `DATA_DIR` + Mock 网关,不碰常驻服务的队列)。
- **工作台显示**(无头 Chrome 1680×1050,真实拥堵网关下的在延后任务):记录行状态「排队中」+ 可取消,进度条下方显示「115s 后重试」并逐秒递减到「111s 后重试」(轮询签名不含 `next_at`,故加了 1s 轻量 ticker 只改文案节点),元信息写明「网关排队,已自动重试 6 次」,不再出现失败红字 —— 截图 `test/shots-v36/busy-requeue-countdown.png`。
- **真机**:`.cn` 网关 13:53 起持续拥堵,项目链路任务 `t-2406c9d05c52d1ce` 按 60/120/180/240/300s 阶梯自动重投 **8 次 / 29.5 分钟**,全程不显示失败、不退积分、可取消,预算用尽后才终态失败:`视频网关排队已满(1768s 内已自动重试 8 次) … 请稍后点「重试」` —— 即当天服务商排队已满可持续半小时以上(13:05 那次成功是窗口期)。
- **常驻实例回归**:重启 3088 后,把 13:39 失败的那条 `t-c52ef8f611b5ae97` 点「重试」,25 秒后状态为 `queued · busy_attempts=1 · 35s 后再投 · error 为空`,并收到通知「遇视频网关排队已满,已自动延后重试(60s 后,最长等待 30 分钟)」—— 不再 50 秒判死。
- **生效前提**:改动在 `server/*`,已启动的服务进程需**重启**才加载新 worker。

### 补充(同日 · 反馈「任务一直卡着不动」)

后台「任务监控」在延后期间只显示「排队中 · 5%」,数字不动 → 看着像卡死;实测那条任务其实正在自动重投(`busy_attempts=7`,29 秒后再投,已等 24 分钟)。

- **等待原因可见**:任务监控行在状态下方标注「网关排队已满」,进度列改显示「**Ns 后重投 · 第 k 次**」;工作台记录行同样显示「Ns 后重试」与「网关排队,已自动重试 k 次」。
- **倒计时真的在走**:两处列表的轮询签名里都没有 `next_at`(整表重绘会打断正在输入的表单),所以倒计时不会自己刷新 —— 新增 `public/js/ui.js` 的 `ensureWaitCountdown / stopWaitCountdown` 共享定时器(1 秒一次,只改 `[data-wait-until]` 文案节点),工作台在 `renderStudioBody()` 末尾接上,后台在 `renderTaskData()` 末尾接上,离开视图时随轮询一起停。
- 默认等待预算 **30 → 60 分钟**:当天 `.cn` 网关从 13:39 起连续拥堵 2 小时以上,30 分钟预算仍会在疏通前判死;等待期间不占任务槽、可随时取消,放宽更划算(仍可按模型 `rules.busy.budget_ms` 覆盖,且**改规则即时生效、无需重启**)。
- 验证(真实实例 3088 + 真实拥堵网关):后台行显示「排队中 / 网关排队已满 / 9s 后重投 · 第 2 次」并在 7 秒观察窗内递减到 2s;工作台记录行「69s 后重试 → 64s 后重试」;截图 `test/shots-v36/admin-busy-waiting.png`、`test/shots-v36/studio-busy-countdown.png`。回归:`verify-round36-busy-requeue.js` 27 项、`verify-round22.js`、`verify-round29-uiux.js` 全绿。


## 第三十五轮优化(项目优化 26 续 · 页头压缩 · 填充式布局:顶部与侧栏固定、内容分栏各自滚动)

上一轮的「整页滚动 + 侧栏 sticky + 隐藏内部滚动条」是个折中,实测仍不满足两个诉求:AI 生图操作区一屏放不下(要滚才能点到「开始生图」),资产库滚动时页头会划走、左侧栏只是「跟着粘」而不是「不动」。本轮改成**填充式布局**,把这两处一次性解决。

### 改动

1. **页头压成一行**(全站生效):眉标 + 标题 + 说明并排,标题 `22px → 17px`,说明单行省略(不再占 3 行),`margin-bottom` 从 20px 收到 12px —— 实测各页页头高度 **27~36px**(此前 ~85px),首页 hero 不变。
2. **填充式页面(资产库 / AI 生图)**:路由进入时给 `body` 加 `page-fill`,`content` 不再滚动,页头 / 筛选行 / 分类 chips 固定,内容栏各自滚动 —— 资产库左侧文件夹栏与右侧网格各占一栏、分页条吸附在网格栏底部;AI 生图左侧创作面板固定、右侧「生成记录」头与 chips 固定而卡片区滚动。**窄屏(≤1080px)与矮屏(≤620px)自动回退整页滚动**,避免两栏堆叠时被压成一条缝。
3. **AI 生图操作区一屏放得下**:模型与风格并排一行;提示词与负面提示词合并为同一输入区(字数计数并入标签行,负面词作紧凑副输入);质量 / 种子收进「更多参数」折叠行;费用与「开始生图」并排成一行(按钮不再 `width:100%` 压住费用提示);面板内边距与分节间距整体收紧一档。
4. **宽屏不再两侧大片留白**:内容宽度上限 `--content-w` 从固定 1560px 改为 `min(1840px, 100%)`(≥2100px 视口再放宽到 2320px)。限宽方式也换掉了 —— 原先给 `.content > *` 加 `max-width + margin:auto`,但子元素各自的 `margin` 简写(如 `.page-head`)会盖掉居中的 auto 边距,宽屏下内容整体偏左;现改为 `.content` 的自适应内边距 `padding-inline: max(var(--sp-8), calc((100% - var(--content-w)) / 2))`,一处生效、不与子元素抢 margin。

### 验证(无头 Chrome 1440×900)

- 页头高度:生图 / 项目 / 风格库 36px、后台 27px;生图页 `.content` 已不可滚(`overflowY:hidden`,溢出 0)。
- 创作面板:内部溢出 **0px**、无需滚动,「开始生图」按钮完整可见,提示词与负面词在同一输入区。
- 资产库:网格滚动 795px 时页头 / 筛选行 / chips / 左栏顶点坐标分毫不动(88 / 136 / 184 / 226),每页仍 20 条,分页条吸附可见。
- 可见滚动条:两页各 **1 根**(分别在 `.ast-main` / `.ig-res-scroll`);1000×720 与 1440×560 均正确回退为整页滚动;无未捕获异常。
- 宽度:1440 视口内容 1376(左右各 32)、2000 视口 **1840(左右各 80)**、2560 视口 **2320(左右各 120)**,左右对称且无横向滚动;改宽后资产库「顶部/左栏不动、每页 20 条、单滚动条」与生图页「面板零溢出、按钮可见」复测依旧通过。
- 回归:`verify-round17d-studio.js`、`verify-round22.js`、`verify-round29-uiux.js` 全绿。


## 第三十四轮优化(项目优化 26 · 分页可见性 · 左栏跟随滚动 · 模型规则驱动参数)

续接上一轮(需求清单第二十六条的 6–9 条)。三条是「上一轮改了但没到位」的复盘,一条是架构性的纠偏。

### 改前实测

- **分页看不见**:分页条排在网格末尾 —— 20 张卡约 1700px 高,首屏根本看不到,于是被当成「资产库没有分页」(26·6)。
- **左栏不跟随**:上一轮为了消灭双滚动条,把 AI 生图创作面板的 `sticky` 一并去掉了,结果向下一滚面板就离开视野(26·7)。
- **尺寸参数被服务端写死**:平台固定发像素 `size=1536x1024`、不带画幅字段。Agnes 图片网关只认 `size=1K/2K/4K` + `ratio=16:9`,收到不认识的像素值就自行「标准化」—— 实测选 16:9 却拿回 **1248×832(3:2)**,用户选的比例与分辨率被静默吞掉;Gemini 的画幅档清单、Agnes Flash 视频的 `720P` 固定档、秒数区间、参考图上限同样都写死在代码里(26·9)。

### 改动

1. **分页条吸附可见**:`.pager` 改为 `position: sticky; bottom` 的浮动工具条(带底色与描边),在资产库、生图记录、风格库、项目列表、两个素材选择弹窗里都常驻滚动区底部,不必滚到末尾;只有一页时依旧整体不渲染,不占位。
2. **左栏跟随滚动**:资产库文件夹栏 `.ast-side` 与生图创作面板 `.ig-form` 恢复 `sticky`;面板超高时内部照常可滚(滚轮/触控板),但**不显示滚动条**(`scrollbar-width:none` + `::-webkit-scrollbar{display:none}`),滚到面板底部后滚动链自然交回页面 —— 实测面板在 `scrollTop` 520 与 1200 处顶点一致(104px,确实钉住),面板内可滚 189px 而占位宽度 0,整页仍只有一条可见滚动条。
3. **参数一律按模型规则走,不预设任何网关写法**(`server/imagegen.js` + `server/api/images.js`):
   - 请求体新增令牌 `<resolution>`(档位字符串)、`<ratio>`/`<aspect_ratio>`、`<width>` `<height>` `<max_side>` `<min_side>`、`<quality>`;
   - **尺寸形态自动判定**:模板里出现 `<size>`(或走 OpenAI multipart 图生图)= 像素模式,提交前按 `比例 × 档位` 换算并向 `rules.limits.sizes` 就近吸附;只写 `<resolution>`/`<ratio>` = 档位模式,像素换算值仅用于展示与本地渲染,不再被尺寸清单改写;
   - 图生图新增 `create.edit:"json"` + `create.images_field`(Agnes 这类「单端点 + `image:[url|base64]`」网关),需要专有字段直接写进 `create.body` 字面量;
   - Gemini 的画幅档与 `imageSize` 档改读 `rules.limits.aspect_ratios` / `resolutions`;视频侧 `flashBody` 的固定输出档、秒数区间、参考图上限全部改读 `rules.limits`(`fixed_size` / `min_seconds` / `max_seconds` / `max_images`);
   - 服务端把 `size_mode` / `res_tiers` / `ratio_options` / `supported_sizes` 随模型下发(`/api/images/models`、`/api/styles/models`),前端下拉与「输出规格」读数按它渲染,不再硬编码 1K/2K/4K;
   - 提交任务时按模型声明的清单收敛(`api/tasks.js` 的 `applyModelSpec`):设 2K 提交到只有 720P 的模型 → 落库参数即 `720p`,不再等网关回 400;
   - 后台模型表单新增「支持的分辨率档」输入框(逗号分隔,改一下默认档下拉与参数模板同步重算)与「填入档位网关模板 / 填入 OpenAI 像素模板」一键按钮(只覆盖 `create`/`limits`/`caps` 相关键);
   - 分镜工作台的画幅比例 / 分辨率 / 帧率三个下拉跟随所选模型,换模型即刻重画参数栏(如 Agnes Flash 只剩 `720p` 一档、画幅按该模型 `params_schema` 的六个比例)。
4. **已按新规则配置线上模型**:`agnes-image-2.5-flash`(档 `1K/2K/4K`)与 `agnes-image-2.1-flash`(档 `1K/2K`)的 rules 换成档位模板,与 `doc/AI 生图接入指南.md` 的示例一致。

### 验证

- **真实 Agnes 生图**(agnes-image-2.5-flash):`16:9 + 1K` → 返回 **1312×736**(严格 16:9);`9:16 + 2K` → **1472×2624**(严格 9:16);任务参数记录 `size_mode=tier`、生效档位与画幅。改档位模板前同一入口发像素尺寸,网关回的是 1248×832(3:2)。
- **模型元信息**:`/api/images/models` 对档位网关回 `size_mode:"tier"`、`res_tiers:["1K","2K","4K"]`、8 个画幅;本地引擎仍为 `pixels`。
- **界面**(无头 Chrome 1440×900):资产库在 `scrollTop=0` 即可见分页条(`sticky`,bottom 852 < 视口 900);生图面板两处滚动位置顶点相同(104/104)、内部滚动条占位 0;资产库 / 生图页 / 工作台「可见滚动条」均为 1 条;无未捕获异常。
- **回归**:`verify-round7-agnes-fix.js`(26 项,含 Flash/V2 请求体)、`verify-round12-adapters.js`(29 项)、`verify-round22.js`、`verify-round29-uiux.js` 全绿。`verify-round23.js` 有 2 项失败,断言的是 `.ws-gen-btn { background:#d4af6e !important }` 这行字面 CSS —— 主题令牌化后该色值早已不在样式表里,与本轮无关。
- **未能验证**:`agnes-video-2.5-flash` 真机连跑三次均被网关挡回 `HTTP 503 video_queue_full`(任务未创建、积分已退),属服务商侧排队拥塞;该链路改由 mock 网关的 round7 套件覆盖(固定档 `720P` 与秒数/图片上限已确认按 rules 取值)。

#### 补充验证(同日稍后,视频链路已真机跑通)

把视频模型的地址换成 `https://api.agnes-ai.cn/v1` 后,`agnes-video-2.5-flash` **端到端生成成功**。直连与应用内各跑一次:

- **直连**:按用户给的载荷 `{model, prompt, seconds:"5", mode:"text", size:"720P", aspect_ratio:"16:9"}` 提交,轮询到 `completed` 后下载,成片 **1280×720 / 4.48s / H.264 + 音轨**;`GET /videos/agnesapi?id=…` 查询接口同样可用。
- **应用内**(任务 `t-59f05a9a07f5ab06`):首次仍撞 `503 video_queue_full`,平台行为正确 —— 退避重试、失败后退回积分、记录保留「重试」按钮;再次重试后走通,进度 `processing 5% → 13% → 68% → 100%`,参数落库 `{"duration":4,"aspect_ratio":"16:9","fps":24,"resolution":"720p","engine":"api","remote_video_id":"task_OmTJ…"}`,成片入库 **1646×720 · 4.46s · 2.48MB**,总耗时 603s(几乎全是排队),免费档不扣积分。
- 结论 ①:`video_queue_full` 是**间歇性**的服务商容量问题,两个网关都会出现,不是集成故障;「重试」按钮是主要恢复手段(本轮之后由第三十六轮的队列自动延后重投接管,不再依赖手动点「重试」)。
- 结论 ②:**keyframe(图生视频)模式下 Agnes 以首帧图的宽高比为准**,`aspect_ratio` 实际只在 text 模式生效。要严格控制画幅,得先把源图裁成目标比例再生成。


## 第三十三轮优化(项目优化 26 · 列表分页 / 查看器空白关闭 / 生图规格真生效 / 去双滚动条 / 项目出片参数)

对应需求清单「二十六、项目优化」1–5 条。改前用无头 Chrome(1440×900,demo 账号:129 项资产、50 条生图记录)实测:

- **一次渲染整库**:资产库 `.content` 滚动高度 **8803px**(可视 576px),生图记录页 **4608px**,滚轮一拖就过头。
- **双滚动条**:AI 生图页左侧表单 `.ig-form`(943/526,sticky + `overflow-y:auto`)套在 `.content`(4608/576)里 → 同屏两条竖滚动条;参考图挑选弹窗 `.ig-pick-grid`(1980/358)套在 `.modal-body`(444/437)里 → 弹窗内再叠一条;`html { scrollbar-gutter: stable }` 让根文档常年预留 **10px** 空槽(实测 scrollWidth 比 clientWidth 小 10),看着又像一条。
- **画幅比例 / 分辨率是哑参数**:非方形一律按 `短边 × 1.5` 换算,选 16:9、4:3、3:2 得到的都是 **1536×1024**;Gemini 协议只发 `aspectRatio`,`imageSize` 根本不传 → 分辨率选了等于没选;档位显示成 512/768/1024… 读不出含义;结果卡一律 1:1 裁切,换了比例看不出差别。
- **查看器点空白关不掉**:只有 `e.target === mask` 才关闭,而 `.viewer-stage` 铺满整个中部,点图片上下的大片黑区毫无反应。
- **项目没有出片规格**:分镜恒 30fps / 16:9,本地 ffmpeg 管线写死 **1280×720** —— 分镜里选了 2K、9:16,出来的还是 1280×720。

### 改动

1. **资源/素材列表每页 20 条**:`GET /api/assets` 支持 `limit/offset` 并返回 `total`(不传 `limit` 仍返回全量,分镜工作台、`[占位符]` 名称匹配等内部调用方零改动);资产库、生图参考图挑选、工作台资产库弹窗、风格库、项目列表、AI 生图生成记录统一按 20 条分页,共用 `renderPager()`(`ui.js`)。计数条同步显示「共 N 条 · 第 x/y 页」;换筛选条件回第 1 页,翻页保留跨页勾选;「全选当前结果」改为按筛选条件取全量并明确 100 项批量上限;首页项目概览最多 20 个并给出「管理全部」入口。
2. **查看器点空白即关**:`.viewer-stage` 内的空白(非媒体、非操作条/翻页键)也视为「图片外面」,`mousedown` 即关闭;图片本身单击仍是 1:1 缩放切换。
3. **生图画幅比例与分辨率真正生效**:分辨率档改成 **1K / 2K / 4K**(服务端 `resolutionToPx()` 同时兼容历史数字档与任务参数);`deriveSize()` 按真实比例换算长边并取偶数、长边封顶 4096(16:9+1K → **1820×1024**,4:3+1K → 1366×1024,9:16+1K → 1024×1820,16:9+2K → 3640×2048,4K 收到 4096×2304);Gemini 适配器补 `imageConfig.imageSize`(可用 `rules.create.image_size:false` 关闭);生图页与工作台生图弹窗新增**输出尺寸实时读数**,并在模型有固定尺寸清单时直接写明「仅支持 …,提交时就近吸附」;结果卡缩略图按图片真实宽高比呈现;记录元信息展示 `比例 · 档位 · 尺寸`。`/api/styles/models` 为生图模型补 `caps / supported_sizes / protocol`,工作台快捷生图因此与生图页同能力(此前连「参考图」入口都不出现)。
4. **去掉双滚动条**:移除 `html` 的 `scrollbar-gutter: stable`;`.ig-form` 不再 sticky + 内滚(整页单滚动);弹窗内 `.alib-side / .alib-main / .ig-pick-grid` 取消自带滚动,统一由 `.modal-body` 滚动;窄屏(≤1080)工作台 `.ws-main` 改为随 `.ws-body` 滚动。全站复检:资产库 / 生图 / 挑选弹窗 / 工作台均只剩一条滚动条。
5. **项目级出片参数**:`projects` 新增 `fps / aspect_ratio / resolution / shot_duration`(幂等迁移,老项目取默认 30fps · 16:9 · 720p · 10s);新建项目弹窗与「项目设置」直接设定这四项(分辨率选项带出换算尺寸,项目设置里实时显示「成片尺寸 480×854 · 30fps · 单镜 6s」),非法值服务端按名单收敛;`/api/config` 下发 `aspectRatios / fpsOptions`;分镜工作台新增分镜、以及从工作记录恢复的历史分镜(值不在名单内时)都按项目规格初始化;分镜「帧率」下拉跟随所选模型的 `params_schema`(模型只支持 24fps 时不再提供会被静默丢弃的 60fps);折叠态摘要与生成记录子行显示实际 `宽×高 · fps`,本地渲染把 `分辨率 × 画幅` 真正交给 ffmpeg(`videoWH()`,不再写死 1280×720),并把 `out_width/out_height` 回写任务参数。

### 验证(按要求本轮不新增测试脚本,以下为一次性实测)

- 接口:分页 20/页 + `total` 正确、翻页不重不漏、不传 `limit` 返回全量;项目规格落库与非法值收敛;`16:9/4:3/9:16/2K/4K` 任务参数尺寸互不相同且实际出图宽高一致(2K 2.0s、4K 4.0s 渲染完成);9:16 + 480p 的项目经本地 ffmpeg 出片实测 **480×854**(改前恒 1280×720)。
- 界面(无头 Chrome):资产库第 1 页恰好 20 卡、翻页生效、计数条显示「138 项 · 第 1/7 页」;查看器点舞台空白即关闭;生图页分辨率为 1K/2K/4K 且读数随比例/档位变化(1024×1024 → 1366×1024 → 4096×3072);参考图弹窗 20 张/页 + 分页控件;新建项目 → 工作台分镜继承 9:16 / 480p / 6s,分辨率选项带出 480×854;全站无未捕获异常。
- 回归:`verify-round17d-studio.js`、`verify-round22.js`、`verify-round29-uiux.js` 全绿(round29 需先把该分集工作记录的 `tab` 置为分镜设计 —— demo 库里的历史工作记录停在「剪辑预览」页,与本轮改动无关)。


## 第三十二轮优化(查看器适配 · 分镜源图引用 · 后台任务监控可用性)

本轮由「点开图片不能完全显示,操作仍不方便,还有很多 bug」的反馈驱动:先修被点名的 bug,再用页面级体检把同类问题一次性扫出来。

### 修复与改动

1. **查看器图片显示不全(根因是 CSS 尺寸解析)**:`.viewer-stage` 原为 grid,隐式行高由内容决定,图片的 `max-height:100%` 解析到不确定高度上等于没有约束 → 竖图/方图按原始尺寸渲染后被舞台裁掉。改为 flex 容器 + 子项 `margin:auto` 居中(flex 内容盒高度确定,百分比生效),`object-fit:contain` 完整适配;`img.viewer-media` 单击切原始尺寸并可滚动查看(`.zoomed`),再点还原。实测竖图 660px 完整落在 676px 舞台内、四边无裁切。
2. **参考资产单击不再弹全屏**:`.ws-ref-item` 单击只做「选用为源图」(右侧分镜闪动反馈 + `已选` 角标),放大查看改由悬停放大镜角标或双击触发 —— 之前想安静地换一张源图必须每次关掉遮罩。
3. **分镜源图改为「只在缺失时提示」**：图生视频的源图取值优先级是 `文案 [占位链接] > 左侧已选中 > 参考列表首张图片`，此前完全隐式。先在生成按钮上方加了一枚常驻源图芯片，实测后判定它不值一行常驻高度 —— **指定源图的入口本来就该是文案里的 `[资产名]` 引用**，于是撤掉芯片行，只保留「左侧一张图片都没有」时的前置条件提示（引入参考图 / 按本镜文案生图两个一键入口）并禁用生成按钮，不再等到提交后才报错。`ProjectsView.shotSource()` 收敛为唯一取值口径（渲染判断与提交共用）。
4. **后台任务监控重做**:`GET /api/admin/tasks` 增加 `counts`(按全量 `GROUP BY status`)与 `total`,统计卡不再显示「最近 200 条里的数量」;搜索扩展到任务 ID / 用户 / 模型 / 提示词;前端拆为「静态筛选外壳 + 可重绘数据区」,新增状态 chips(带计数)、280ms 防抖搜索与每次 30 行的「显示更多」分页 —— 旧实现每 3s 轮询重建最多 200 行,任务进度一跳就整表重画并抢走搜索框焦点。页面不可见时暂停轮询。参数列按任务类型渲染(生图显示 `16:9 · 2 张`,不再是一串 `—s @ —fps`)。
5. **通知/菜单弹层被自己关掉**:全局 `document` 点击收起逻辑把「点在弹层自身的标题栏 / 内边距 / 滚动区」也算作点了外部 → 通知面板一点就没了。现在落在 `#topUserPop / #notifPanel / #navMorePop` 内的点击不触发收起。
6. **弹窗分组一致性**:分镜工作台的快捷「AI 生图」弹窗补 `.form-sect` 三段(模型 / 画面描述 / 输出规格),与 AI 生图页同构。
7. **其他**:`.ws-pl-chips` 空态与 `.viewer-count:empty` 不再占位;资产库/风格库/后台的搜索统一防抖;新增 `.td-empty` / `.table-more` / `.cat-chip .chip-n` 样式并回收一处行内样式空态。

### 验证

- 新增 `test/verify-round32-srcref-tasks.js`(无头 Chrome CDP):源图不在界面常驻、`[资产名]` 引用即决定提交源图、缺图提示与按钮禁用;任务监控的 chips 计数、30 行分页、状态筛选、后端搜索、轮询期间焦点保持、空态与停轮询 —— 22 项全通过,测试用一次性项目跑完即删。
- 页面级体检脚本扫描 19 个页面状态 × 深浅两套主题:文字裁切、可点区域 < 14px、元素被遮挡(`elementFromPoint` 命中判定)、文档横向溢出、未捕获异常 —— 全部为 0。
- 回归:`test/verify-round22.js`(占位符链接与参考资产交互,其中「单击参考卡弹全屏」一项按本轮新交互改为角标/双击)、`test/verify-round29-uiux.js`、`test/verify-round17d-studio.js` 全部通过。
- 注意:后台统计改动含服务端 `/api/admin/tasks` 响应结构,已运行的旧进程需重启才能看到全量计数。


## 第三十一轮优化(全站信息架构与外壳统一 · 设计系统 v4)

本轮由「优化后界面仍不友好、操作杂乱」的反馈驱动,先做量测盘点再动手,范围覆盖全站而非单点修补。

### 盘点结论(改前实测)

1. **顶栏挤满且静默裁切**:72px 一条横栏承载 8 组功能(品牌 229px + 6 项导航 567px + ⌘K 114 + 积分 75 + 项目切换 122 + 通知 36 + 账号 140),1440px 下左簇 810 / 右簇 530,中间仅剩 16px 余量;`.top-nav` 为 `overflow-x:auto`,**1320px 以下导航被横向裁切且无任何可滚动提示**(实测 567px 内容只露出 467/438/352/269px)。
2. **三套并行外壳**:主站 `.topbar`、分集列表 `.wb-nav`(`body.wb-mode` 直接把主顶栏 `display:none`)、分镜工作台 `.ws-nav`,各自重复实现品牌、面包屑、账号菜单、积分与退出 —— 每进一层换一套导航语言。
3. **设计令牌失控**:同屏字号 首页 12 种 / 生图 10 种 / 后台 8 种;`--radius` 定义为 10px 但组件硬编码 7–22px 共 12 种;卡片底色有 5 套。
4. **CSS 是 30 轮叠加的补丁层**:`.content` 定义 3 次、`.topbar` 4 次、`.stat-cards` 3 次、`.modal-xl` 2 次且取值冲突、`@keyframes spin` 2 次;后层用整块 `!important` 压前层;**浅色模式规则里残留字面量 `undefined`**(两处语法垃圾);`.dash-hero::after` 先定义为胶片齿孔条、后一层改成「映」字水印,前者彻底失效;`dh-title::before` 把「WORKSPACE · 创作指挥台」写进 CSS。
5. **功能断链**:浅色模式有 300 行样式 + `App.toggleScheme()` + 三处 `#schemeBtn` 样式,但 index.html 里**根本没有这个按钮**,也没有读 localStorage 的引导脚本 → 整套浅色模式不可达。
6. **JS 用到但完全没有样式的类**:`.em-size-tag`(后台模型弹窗的比例开关,渲染成纯文字、看不出可点)、`.em-rules-box`、`.ws-ref-zoom`、`.folder-tree`、`.ig-results`、查看器 `.pv-*`;另有 116 个死样式类。
7. **动作入口重复**:首页 Hero 4 个按钮 + 网格首卡「新建项目」+ 统计卡「积分余额」;分镜工作台顶部与底部各一个「追加分镜」;资产库一行 7 个控件把「上传」和「自动分类/全选」平级摆放。
8. **不可达死代码**:`ProjectsView.openEpisodeDetail` 及其场景/片段编排(约 140 行)、`drawWaveform`、`breadcrumb` 均已无调用方。

### 本轮改动

1. **设计系统 v4 重写 `public/css/app.css`**(3297 → 1985 行):建立单一令牌层 —— 间距 4 的倍数(4/8/12/16/20/24/32/40)、字号 8 档(11/12/13/14/17/22/28)、圆角 4 档、表面三级(`--surface/-2/-3`)、阴影三级;合并 v3/v17 与历轮增量,消除全部重复定义与 `!important` 压制链(现存 9 处均为必要覆盖);删除 116 个死类、`undefined` 语法垃圾、CSS 注入文案、四张卡片上的 hover「取景括号」装饰与巨型水印。
2. **全站一条顶栏**:取消 `body.wb-mode` 隐藏主顶栏的做法,新增 `App.setContext({back, eyebrow, title, tabs})` —— 项目 / 分集层级由顶栏左侧「返回 + 层级标识 + 视图切换」接管,`.wb-nav`、`.ws-nav`、`.wb-account` 与其中重复的品牌/账号/退出/积分全部删除。顶栏右侧瘦身为 ⌘K / 积分 / 通知 / 主题 / 账号,**移除独立项目切换器**(其能力由 ⌘K 的项目分组承担,列表上限 10 → 40)。实测 1440px 下左右簇间距由 16px 增至 273px,1440/1320/1200/1080/960 全宽无溢出、标题不再被挤没。
3. **导航收纳不再静默裁切**:≤1360px 主导航转图标,≤1080px 折叠为「导航」下拉(沿用当前页名作为按钮文案),彻底替代原先的横向滚动裁切。
4. **恢复浅色模式可达**:补 `#schemeBtn`(图标由 `applyScheme` 按目标态渲染)+ `<head>` 内首帧前读 localStorage / 跟随系统的引导脚本。
5. **动作分层**:每屏一个主行动 —— 首页 Hero 由 4 个按钮减为「新建项目 + AI 生图」,统计卡去掉与顶栏重复的存储项;资产库拆为「页头动作(上传 / 更多)」+「筛选行(搜索 / 类型 / 共享 / 选择模式 / 计数)」,自动分类·全选·新建文件夹收进「更多」菜单;项目列表把邀请码输入折进弹窗并新增名称搜索;分镜工作台把顶部工具行与底部重复的「追加分镜」合并为一处,「全部折叠 / 全部展开」合并为随状态切换的单按钮;后台模型表操作列由 5 个按钮减为 3 个 + 行内菜单(检查 / 自检)。
6. **可读性与一致性**:新增 `--gold-text`(小号金色正文专用,与装饰金分离)并把 13 处小字金切换过去;次要文字 `--ink-3` 两套主题分别加深;浅色下语义色加深;`mc-msg` 检查信息限两行;生成记录折叠态补 56×32 缩略图;资产卡勾选框改为悬停 / 选择模式才出现,不再常驻遮挡缩略图;⌘K 支持函数式条目(新增「切换深浅色」「上传素材」);中文文案标点全角化 441 处。
7. **补齐缺失样式**:`.em-size-tag` 系列(比例开关现在有明确的选中态)、`.em-rules-box`、`.ws-ref-zoom`、`.folder-tree`、`.pv-*`、`.form-sect`(生图面板分「模型 / 画面描述 / 输出规格」三段)。
8. **删除死代码**:`openEpisodeDetail` 及场景/片段编排、`drawWaveform`、`breadcrumb`、`App.PAGE_TITLES`。

### 验证

- 同源 iframe 量测:8 条路由 × 1440/1320/1280/1180/1024 宽度,顶栏与内容均无横向溢出;沉浸模式 `.content > *` 居中收窄问题已修(`margin: 0`)。
- 同屏字号种类:首页 12 → 6,资产库 12 → 5,后台 8 → 5。
- 对比度脚本(带 alpha 合成)全站扫描:浅色模式低于 WCAG AA 的小字从多处降为 0(仅 11px 阈值下 4.4:1 的边缘项已一并加深)。
- 无头 Chrome 截图复核:仪表盘 / 资产库 / 项目列表 / 风格库 / 后台 / 登录 / 分集工作台 / 分镜工作台(深 + 浅),并注入参考资产与三种状态生成记录验证工作台渲染。
- 交互回归:⌘K 面板、导航下拉、主题切换与持久化、弹窗体系、积分中心、右键菜单、统一查看器翻页与动作、分镜标签切换、参考栏折叠、批量管理模式、分集搜索、项目设置弹窗均实测通过;全部 JS `node --check` 通过。
- 既有回归套件复跑:`test/e2e.js` 全通过、`verify-round29-uiux` 全通过(其中「Hero 含上传入口」断言已按本轮 IA 决策改为断言「上传归位到资产库页头」)、`verify-round22` 全通过(剧本 15px / 行高 1.85 / chips 12.5px·26px 属占位符镜像对齐调校值,已从字号阶中豁免并在 CSS 内注明)、`verify-round25`(38)、`round26`(37)、`round27`(16)、`round28`(14)、`round17d-studio` 全通过。
- 本轮为纯前端改动,未触碰 `server/`;主题导出/导入仍读写 `public/css/app.css`,与新样式表兼容。

## 第三十轮优化(全站布局与可读性 · 截图盘点驱动)

1. **全站截图盘点机制**:`node test/audit-round30-shots.js` 一键抓取全部页面(深/浅两套 + 后台)到 `test/shots-r30-audit/`,本轮据实审阅后整改,后续每轮可复用。
2. **AI 生图页布局系统重建(最大痛点)**:此前工作区缺失整套 `.ig-*` 布局 CSS,页面散架成单根巨柱。现补齐完整设计:左创作面板(408px,吸顶滚动)+ 右生成记录两栏网格;头部标题行 + 计价胶囊;能力徽章 / 参考图 chips / 记录卡(封面网格、进度条、错误块、状态徽章单行、下载/再次生成/删除行内动作);参考图挑选弹窗网格(勾选角 / 放大镜 / 名称浮层)与大图浏览;≤1120px 自动转单列。深浅双主题适配。
3. **浅色模式可读性修复(历史漂移)**:统计数值 #f2e7cf 奶黄字打在白底几乎不可见 → 浅色下转浓墨;顶栏激活页签浅色转墨字。
4. **顶栏收纳**:移除与导航高亮重复的居中页标题;⌘K 触发按钮去「快速操作」文字只留快捷键徽标,拥挤度明显下降。
5. **首页最近成果**由 12 格网格改为**单行横滑条**(固定 208px 格,细滚动条),不再把页面撑成两行。
6. **细节**:资产卡 meta 单行省略不再折行;风格库卡片改纵向 flex(标签并排、操作行吸底)。
   - 回归验证:round29(全站统一成果查看)、round22(引用排版)全部通过;全站 19 张深/浅截图人工复检无布局破损。

## 第二十九轮优化(全站操作与结果查看统一)

1. **全局统一「成果查看器」(`public/js/viewer.js`)**:黑场沉浸式大图 / 视频 / 音频预览 —— 键盘 ← → 循环翻页、Esc 关闭、点空白关闭、图片点击缩放;底部操作条 = 下载 + 场景自定义动作。替代此前四套各自为政的预览弹窗,全站统一结果查看:
   - **AI 生图页**:成果图点击放大,本任务多张图直接翻页,可一键「复制提示词」;
   - **分镜工作台**:完成视频记录由「常驻 video」改为**封面卡**(缩略图 + 播放角标 + 时长角标),点击进查看器大屏播放,页面更轻更整洁;记录头整行可点击折叠/展开;
   - **批量审片 / 工作日志**:完成记录新增「查看」按钮直接放大;
   - **资产库**:点击资产卡进查看器,以当前筛选列表为翻页上下文,内置「重命名 / 设置分类 / 共享 / 删除」动作(只读共享资产自动隐藏编辑动作);
   - **首页「最近成果」**:最新生成图片 / 视频 12 格成果墙,点击放大。
2. **AI 生图页操作整理**:生成记录新增**状态筛选 chips(全部 / 进行中 / 已完成 / 失败,含计数)**;完成记录新增**「再次生成」**(同参数新任务、重新计价);提示词行点击即复制;计价芯片改为「按张计价 · 全局默认 X 分/张」。
3. **修复存量致命问题**:`index.html` 漏引 `/js/views/images.js` 导致 AI 生图页无法打开;顶栏导航与用户菜单补上「AI 生图」入口。
4. **风格库「应用」**点击后给出可执行引导提示(到分镜创作页「视频风格」中套用)。
5. **回归修复(历史漂移)**:恢复二十二轮引用排版规格(工作台正文 15px / 行高 1.85、令牌圆角 9px、缩略图 14px、纵向 2px 内边距、下方 chips 26px 头像 / 12.5px 字号、占位提示 12px、无图令牌左右 4px 呼吸边);`plink.js` 字号适配计入 letter-spacing 补偿,长资产名不再截断。
   - 回归验证:`node test/verify-round29-uiux.js`(真实链路:免费生图 2 张 + 免费视频 1 条 → 无头浏览器断言筛选 chips / 查看器翻页与 Esc / 资产查看器动作 / 封面卡 / 审片「查看」/ 记录头折叠,截图 `test/shots-v29/`);round22(38)、round25(38)、round27(16)、round28(14)、round17d、qa-round17b-plink、e2e 回归全部通过。

## 第二十五轮优化(二十三 · AI 生图)

1. **全新「AI 生图」模块(二十三·1)**:顶栏新增「AI 生图」页(`#/images`),提示词 → 图片独立成坊,与图生视频共用任务队列 / 积分体系 / 资产库:
   - **创作面板**:生图模型下拉(免费模型标注「免费 · 不消耗积分」)、风格模板(可把 `{subject}` 注入提示词)、提示词(2000 字计数)、负向提示词、**参考图(图生图)**(弹窗挑选本人图片资产,可搜索、可移除)、尺寸与张数(1–4 张,受模型 `limits.max_count` 约束)、实时费用提示(`creditPerImage` × 张数)与余额;Ctrl/⌘+Enter 快捷提交;
   - **生成记录**:右侧任务卡片轮询进度条,完成后按张展示网格图,点击放大预览;失败展示错误原因;支持重试 / 取消 / 删除(与视频任务同一套 `/api/tasks/:id/retry|cancel`);轮询采用签名比对避免重渲染闪烁,全部任务终态后自动停止;
   - **成果自动入库**:每张图片复制进资产库(`source='imggen'`,分类「分镜」,标签 `imggen`),生成缩略图、计入存储配额,可直接用作图生视频源图;任务记录 `result_asset_ids`(JSON 数组)+ 首图 `result_asset_id`,接口 `GET /api/tasks` 统一返回 `result_assets` 摘要;
   - **分镜工作台集成**:工具栏「AI 生图」按钮与每个分镜卡头的生图快捷键(按本镜文案预填提示词),生成完成后**图片自动加入该镜参考资产**(标记「AI 生图」),空参考时自动选中,立即可以用作 `[占位符]` 引用与图生视频源图;
   - **免费体验模型**:内置「本地占位生图(免费)」(`m-img-free`,img-ffmpeg 协议)——不调外部 API、0 积分,按提示词哈希决定渐变色系,ffmpeg `gradients` 滤镜本地渲染(不支持时回退 `color`),用于零成本体验与联调。
2. **可插拔生图协议注册中心(二十三·2,后续接入零代码)**:`server/imagegen.js` 参照视频适配器设计,新增模型只需在后台填表,无需改代码:
   - **openai-image**(OpenAI Images 兼容):文生图 `POST {base}/images/generations`(JSON);带参考图自动切换 **multipart** `POST {base}/images/edits`(图生图);响应同时支持 `b64_json` 与 `url`(自动下载),混用也可;
   - **gemini-image**(Google Gemini / Imagen):`POST {base}/models/<model_id>:generateContent`,`x-goog-api-key` 鉴权,`inlineData` 解析,画幅自动换算为 Gemini 支持档位(1:1 / 3:4 / 4:3 / 9:16 / 16:9 / 21:9,就近吸附);
   - **img-ffmpeg**:本地占位渲染(免费测试引擎);
   - **协议识别**:模型 rules 显式 `protocol` > 按 `model_id`/`api_base` 自动嗅探(gemini/imagen → gemini-image,有 api_base+model_id → openai-image,否则本地);请求体用 `<token>` 模板(`<model_id>` `<prompt>` `<negative_prompt>` `<n>` `<size>` 等),空值令牌自动剔除;
   - **接入步骤**:后台 → 模型管理 → 新建模型,类型选「AI 生图」,填 API 地址 / API Key / 模型 ID(或 rules 里显式指定 protocol 与 body 模板)即可;「检测」按钮会校验协议规则并试渲一张占位图,「自检」对生图模型发起真实 1 张生图任务;
   - **计价**:新设置项 `creditPerImage`(默认 2 积分/张,后台「系统设置 → 积分定价」可改),免费模型恒 0;按张数扣减,失败 / 取消自动退还。
   - 回归验证:`node test/verify-round25-imagegen.js`(38 项:协议识别 / 规则归一化 / Mock OpenAI 网关 JSON+multipart / Gemini 双请求与画幅换算 / 本地占位 PNG 落盘 / 路由与迁移种子),另全栈冒烟(真实队列跑通 `m-img-free` 三张生图 → 资产入库 → `result_assets` API);round12 适配器与 e2e 回归无影响。


## 第二十六轮优化(生图模型参数化 · 能力勾选 · 多图合成 · 参考图大图浏览)

1. **模型能力勾选(文生图 / 图生图 / 多图合成)**:后台「模型管理」编辑生图模型时新增能力勾选面板,存入模型 `rules.caps`(`text-to-image` / `image-to-image` / `multi-image`),API 层强校验:
   - 未开「图生图」→ 提交带参考图直接 400(「xx 未开启图生图能力」);未开「多图合成」→ 一次只能带 1 张参考图;
   - 能力蕴含:勾「多图合成」自动具备图生图与文生图(`modelCaps` 归一化);`GET /api/images/models` 向前端暴露 `caps`,生图页按能力显示「文生图 / 图生图 / 多图合成」芯片,不支持参考图的模型隐藏选择器;
   - 同时可配 **单次张数上限**(`limits.max_count`,1–4),前台张数下拉按模型上限渲染。
2. **模型参数模板可配(比例 · 分辨率 · 质量 · 种子)**:后台弹窗按勾选的画幅比例(1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9)+ 分辨率基准档(512–2048)自动生成 `params_schema`(ratio + size 联动选项,另可选 quality 与 seed),右侧实时预览生成的参数模板 JSON;前台创作面板完全由模型模板驱动渲染,不再写死尺寸表:
   - 选比例自动联动最近宽高比的尺寸档;openai 协议仅在模型未给 size 时按比例换算(`sizeFromRatio`);请求参数与 openai 模板新增 `<aspect_ratio>` 令牌;Gemini 优先用显式 `aspect_ratio`;
   - 画幅比例来源优先级:params_schema 显式 `ratio` > 请求 `aspect_ratio` > 由 size 推导(如 1536x1024 → 3:2)。
3. **多图合成(多参考图融合)**:提交 `ref_asset_ids` 数组(≤8 张,兼容旧 `ref_asset_id` 单图),worker 构建 `refAssets` 数组传给适配器:
   - **openai-image**:multipart 单图用 `image` 字段、多图用 `image[]`(gpt-image-1 多图合成约定);
   - **gemini-image**:每张参考图注入一个 `inlineData` part 融合生成;
   - 任务参数记录 `ref_asset_ids` 与 `ref_count`,生成记录卡展示「参考 N 张(合成)」。
4. **参考图挑选弹窗重做(可浏览 · 可多选)**:生图页与分镜工作台共用:
   - 网格多选(多图合成模型一次勾选 ≤8 张,勾角金色对勾),单能力模型单选;
   - 悬停出现 **放大镜** → 大图浏览(lightbox):大图 + 名称 + 「i / n」计数 + 上一张/下一张(支持 ← → 方向键)+ 「选用这张」;
   - 参考图行显示缩略图 chips,可单个移除、继续添加,页脚「使用选中的 N 张」。
5. **内置免费模型升级**:`m-img-free` 迁移补齐 ratio 参数模板与全能力声明(文生图 + 图生图 + 多图合成),零成本即可体验多图合成链路。
6. **验证**:`node test/verify-round26-imgopts.js`(37 项:modelCaps 能力归一化 / sizeFromRatio / Mock 网关 multipart `image[]`×3 与单图 `image` / Gemini 双 `inlineData` + 显式画幅 / 真实服务 e2e:后台创建带能力勾选与参数模板的模型 → PATCH 勾选切换 → API 层能力拒绝 400 → 2 图合成任务参数校验 → 免费模型迁移);round25 回归 38/38 不受影响。

## 第二十七轮优化(模型积分单价 · 自定义比例尺寸 · 参考图缩略 · 种子随机刷新)

1. **模型积分消耗生效(生图)**:生图模型在后台设置的「积分消耗」即**每张价格**,提交时按 `模型价 × 张数` 扣分(此前误用全局 `creditPerImage` 默认价);0/留空回退全局定价,免费模型恒 0;`GET /api/images/models` 新增 `price_per_image`,生图页与分镜生图弹窗费用提示均按模型价实时计算;后台弹窗字段文案按模型类型自动切换为「积分消耗(每张)」;
2. **比例 / 尺寸支持手动输入(后台参数面板)**:画幅比例除预设标签外,可手动输入自定义比例(如 `4:5`、`2.35:1`,回车或「添加比例」生成新标签);新增「自定义尺寸」输入(逗号/空格分隔,如 `1024x1024, 2048x1152, auto`),填写后生图页尺寸下拉完全按该清单显示(不再按比例×分辨率自动换算),参数模板预览实时更新;
3. **参考图不显示修复**:图片上传时服务端即生成缩略图(此前只给视频生成);挑选弹窗、参考图 chips 一律优先用缩略图,旧资产走 `GET /api/assets/:id/thumbnail` 按需生成,参考图网格真实显示图片;
4. **随机种子随机刷新**:种子输入旁新增「🎲 随机」按钮一键刷新随机种子;本地占位引擎在种子为 -1/空时每次生成加入随机分量(同提示词重生成出新图),固定种子仍精确复现同一张图(ffmpeg gradients/noise 滤镜全部显式播种);种子与质量参数按模板校验后写入任务参数传给适配器;
5. **验证**:`node test/verify-round27-imgpolish.js`(16 项:图片上传即有缩略图 + thumbnail 接口 / 模型价 3 分×2 张=6 分正确计费 / 自定义比例 `4:5` 与尺寸 `2048x1152` 模板生效 / 种子 -1 两次生成结果不同 + 固定种子 42 逐字节复现);round25/26 回归 38/38、37/37 不受影响。
- **回归验证**:`node test/verify-round29-uiux.js`(第二十九轮:全站统一成果查看器 / 生图筛选与再次生成 / 资产查看器动作 / 分镜封面卡与审片查看)。
## 第十一轮优化(视频创作工作台)

1. **提示词占位链接来源显示优化**:
   - 修复镜像层高亮错位:宽高严格对齐 textarea 内容区,不再向下溢出;
   - 修复滑动跟随:镜像层高度固定为 textarea 可视区高度,滚动时 scrollTop/scrollLeft 同步;
   - 更新显示风格:链接成功 → 金色来源下划线胶囊;未链接 → 灰色虚线;
   - 悬停占位符显示来源资产名(浮动气泡),点击自动滚动左侧参考面板使该资产可见;
   - 样式随 CSS 变量变化,一致性好。
2. **分镜卡可折叠/展开**:
   - 每张分镜卡头部有折叠按钮,点击头部亦可折叠/展开;
   - 折叠态显示摘要:剧本前 48 字 · 时长 · 已链接资源数 · 生成状态;
   - 顶部工具条提供「全部折叠」「全部展开」批量操作;
   - 折叠状态持久化,刷新/重开不丢失。
3. **布局优化,操作更方便**:
   - **主栏置顶工具条**:分镜数 + 全部折叠/全部展开/追加分镜,长列表时操作无需滚到底部;
   - **左侧参考资产面板可折叠**:点击折叠按钮收缩为窄条,展开恢复、状态持久化;
   - **分镜排序**:每张卡片头部提供上移/下移按钮,轻松调整分镜顺序;


## 第十二轮优化(模型适配器 · 生成规则)

1. **后续新增视频模型免改代码,提交任务后自动按模型规则适配**:
   - 新增 `server/adapters.js` 模型适配器注册中心,worker 提交任务后按模型「生成规则」自动选择引擎并适配请求体 / 轮询 / 结果解析,不再硬编码在 `server/agnes.js` 里;
   - 内置 4 个适配器(protocol):**Agnes Flash 兼容 / Agnes V2.0 兼容 / OpenAI 视频通用协议(规则可配) / 本地 ffmpeg**;
   - **自动识别**:`models.rules.protocol` 显式指定优先;未指定时按 model_id 特征匹配(含 flash → Flash 适配、v2.0 → V2 适配),配了 api_base 的模型默认走 OpenAI 通用协议 —— 添加新模型只填 API 地址 + Key + 模型 ID 即可,无需繁琐配置;
   - **生成规则 JSON**(models.rules 列):`create`(请求路径/请求体模板 + 媒体字段名)、`query`(轮询路径/参数/状态字段)、`limits`(参考图上限/秒数范围/固定尺寸)、`busy`(网关排队已满时的延后重投阶梯与等待预算,见第三十六轮);
   - 后台模型管理:模型列表新增「生成协议」徽章;编辑弹窗新增「生成规则 / 协议适配」区(协议下拉 + 规则 JSON 编辑器,保存即生效);新增 `GET /api/admin/models/adapters` 返回可用适配器列表;
   - 回归验证:`node test/verify-round12-adapters.js`(规则/自动识别/请求体模板,29 项)、`node test/verify-round12-e2e.js`(Mock 网关全链路,28 项)、`node test/verify-round12-ui.js`(无头浏览器 UI 验证);已用真实服务器 API 创建规则模型提交任务端到端生成成功。


## 第十三轮优化(视频创作页面 · 资产库)

1. **视频创作页面 – 左侧资源类型多选导入**:
   - 点击左侧「+角色」「+场景」「+物品」「+分镜」「+音频」「+视频」按钮,弹出与资产库页面同款的**资产库窗口**(文件夹树 + 分类 chips + 类型筛选 + 名称搜索 + 媒体卡片网格),支持多选素材导入;
   - 弹窗内可直接上传素材,上传后自动刷新列表;
   - 每项带勾选框,底部「导入选中 (N)」确认按钮;导入后自动加入左侧参考资产列表,支持移除已有参考资产。
2. **取消冗余功能按钮**:
   - 取消「补全参考图」按钮(统一由资源类型按钮导入);
   - 取消「工具箱」下拉菜单(项目设置/导出等入口移至其他位置);
   - 取消导航栏「简约版/完整版」模式切换,统一为完整视图。
3. **弹窗风格统一优化**:
   - 统一所有模态框按钮高度(36px)、最小宽度、间距等样式,采用与「新建项目」弹窗一致的标准 modal 结构(标题 + 关闭 + 取消 + 主按钮);
   - 将工作台 `--ws-*` 颜色变量复制到 `#modalRoot`,修复弹窗内 `.wpk-chip.on` 等因 CSS 变量作用域缺失而把选中按钮渲染成黑色的问题;
   - 提示词中的资源占位符(如 `[女主]`)统一采用「可用占位」金色样式(未链接也显示金色下划线胶囊),视觉一致。
4. **工作日志点击显示详细信息**:
   - 每行日志新增「详情」按钮,点击展开参数(帧率/比例/分辨率/运动强度/种子)、负向词、模型、消耗积分、错误信息、结果资产链接、任务 ID 等完整信息;
   - 支持点击日志行切换展开/收起。
5. **资产库自动分类**:
   - 新增服务端 `autoCategorize()` 函数:音频→音频、视频→视频、图片按文件名关键词打分自动归类(角色/场景/物品/分镜);
   - 上传时自动归类(含中文文件名乱码修复 — `decodeUploadName` 将 latin1 解码回 UTF-8);
   - 资产库工具栏新增「自动分类」按钮,一键为未分类的资产批量归类;
   - 新增 `POST /api/assets/auto-categorize` 端点。
6. **资产库增删功能**:支持上传(已存在)、删除(已存在)、文件夹新建/删除,保持完好。
   - 回归验证:`node test/verify-round13-ui.js`(无头浏览器 UI 验证:多选导入/按钮取消/工作日志详情)。

## 第十四轮优化(项目优化)

1. **资产库鼠标框选 + 全模块勾选/全选/批量删除**:
   - 资产库网格支持**按住左键拖动绘制选框**,松开后自动选中框内全部资产(可选中的资产卡片实时高亮 + 勾选),同时自动进入选择模式并弹出批量分类浮条;
   - 选框采用 `position:fixed` 挂到 body,拖动时 `preventDefault()` 阻止图片原生拖拽/文本选择,保证在缩略图上拖动也能正常框选;
   - **资产库 / 项目分集 / 风格库三大模块统一支持勾选**:媒体卡片、项目卡片、风格卡片常驻勾选框(悬停加深、选中变金色),工具栏均有「全选」按钮,底部弹出批量操作浮条;
   - **勾选后支持批量删除**:新增 `POST /api/assets/batch-delete`、`POST /api/projects/batch-delete`、`POST /api/styles/batch-delete`,按权限批量删除(资产删除文件并扣减存储,项目/风格删除管理数据),选中后点「删除选中」确认即可;
   - 项目工作台「资产库窗口」(素材多选导入)的媒体卡片同样常驻勾选框。
2. **后台任务监控显示模型 + 点击查看完整提示词**:
   - 任务监控表格新增「模型」列(`LEFT JOIN models` 返回 `model_name`,展示模型名称,模型被删时回退显示模型 ID);
   - 提示词列改为可点击按钮,点击弹出详情弹窗,展示**完整提示词 / 负向提示词 / 模型 / 状态 / 积分 / 耗时 / 任务参数 / 错误信息 / 任务 ID / 提交时间**。
3. **视频生成积分消耗按后台配置计价**:
   - 生成任务的积分扣减始终由后台「系统设置 → 积分定价」驱动(`creditPerSecond` + 段时长覆盖价 `creditOverrides`),免费模型恒为 0 分,失败/取消自动退还;
   - 默认 10s 视频按定价表消耗 50 积分,管理员修改定价后新任务立即按新价格计费,前端生成按钮旁的积分提示同步刷新。
   - 回归验证:无头浏览器 CDP 实测——框选选中 6 项资产并弹出批量分类浮条;任务监控表格含模型列、72 条可点击提示词且弹窗展示完整内容;单机卡片预览不受影响。

## 第二十四轮优化(二十二 · 视频创作优化)

1. **参考资产门控引用(二十二·1,bug 修复)**:修复「参考资产中没有导入资产,提示词中却还能引用」——此前 `[占位符]` 匹配的是**整个资产库**,左侧参考面板空着也能把库内素材链接成金色高亮。现与设计口径统一:**仅左侧「参考资产」已引入的素材可被 `[资产名]` 引用**:
   - `attachPlaceholderLinker` 增加「参考资产 / 全库」双名单,链接匹配只查参考资产;库里有同名但未引入的一律按未链接虚线渲染;
   - 悬停未链接占位符给出可执行指引:「××× 未引入参考资产,请先在左侧引入后再引用」;
   - 提示词下方「可用占位」提示只来自参考资产(不再兜底展示资产库全部素材);参考面板为空时显示引导文案「左侧暂无参考资产 —— 请先从上方分类引入素材」;
   - 折叠态摘要「已链接 N 项」与提示词同口径(只统计参考资产),生成时 `linked_asset_ids` 亦只会包含已引入素材。
2. **点击引用资源放大查看(二十二·2)**:
   - 提示词下方「圆角矩形」已链接 chips 变为可点击(悬停提亮上浮 + 放大镜角标),点击弹出**大图预览弹窗**:图片大图 / 视频直接播放 / 音频播放器,附名称、类型、大小、尺寸、时长与「已加入参考资产」标记,支持一键下载;
   - 点击左侧参考资产同样弹出放大预览(同时保留原「选用 + 右侧分镜闪动」反馈),卡片悬停浮现放大镜角标提示可点。
3. **引用字体与形状放大(二十二·3)**:提示词正文字号 14 → **15px**、行高 **1.85**,行内引用芯片同步放大——资产名 **13.5px 起步**(旧版 10~12px),令牌过窄时缩略图为名字让位、按 13.5→11px 逐级取最大可容字号,大而完整不截断;芯片圆角 7 → 9px、缩略图 10 → 14px、上下加 2px 内边距(不影响镜像对齐);下方 chips 放大至 26px 头像 / 12.5px 字号,浅色主题悬停转霁蓝语言。
   - 回归验证:`node test/verify-round22.js`(无头 Chrome CDP 38 项:参考资产门控、空参考引导文案、chips/左侧资产点击放大、引用字号与形状断言、镜像对齐回归);历史脚本契约同步 —— verify-round17d-studio(参考面板注入 + 新字号断言 + 分辨率取白名单档)、qa-round17b-plink、verify-round4-ui(先引入参考资产再验证占位链接)全部通过;verify-round17c(全过)、round20-ui(36/36)、round21-ui(52/52)回归无影响。

## 第二十三轮优化(二十一·项目优化:积分计价 / 任务参数 / 生成按钮)

1. **积分显示 = 实扣(二十一·1)**:「API 模型接入」添加的模型(Agnes-video-v2.0 等)此前 params_schema 为空,提交任务时「时长」被整段丢弃 → 一律按默认 5s 计价(显示 30 实扣 50、显示 100 实扣还是 50)。修复:
   - `server/api/tasks.js` 增加**标准参数兜底**:模型参数模板未定义的 时长/帧率/运动/种子 照常读取(模型模板已定义的仍按模板范围校验),任意模型提交后计价、生成都用真实时长;
   - `server/db.js` 启动迁移:为历史库中空参数模板的模型自动补写标准模板(Agnes-video-v2.0 / Agnes-video-v2.5 / 跃数sora / 跃数sd2.0 均已自动补齐);
   - `server/api/admin.js`:新建模型未提供参数模板时自动补默认模板;前端 `projects.js` 新增 `effDuration()`,积分提示与提交时长同一口径(模型模板限定了时长范围时同步收敛),**显示即实扣**。
2. **任务参数(分辨率/时长/帧率)后端照常读取(二十一·2)**:
   - Agnes V2.0 适配器修复「设 5s 出 4s」:`num_frames` 此前按 floor 向下取 8n+1(5s@24fps=113 帧≈4.71s),现按官方文档推荐**向上取** 8n+1(5s@24fps=121 帧=5.04s,10s@24fps=241 帧),实际时长恒 ≥ 用户设置;
   - `frame_rate` 直接采用用户所选帧率(此前丢失恒为 24);
   - 分辨率真实生效:按「分辨率档 × 画幅比例」计算 width/height(480p/720p/960p/2k,档位作用短边:720p/16:9→1280×720、9:16→720×1280、2k/1:1→1440×1440),替换原先写死的 1152×768 —— 网关自动标准化到最近预设档;
   - OpenAI 通用协议 `<size>` 解析优先级:风格显式 size > 用户所选分辨率档(960p→"960P") > 规则 fixed_size;`<seconds>`/`<fps>` 同样取用户值。
3. **后续新增模型免配置可用(二十一·3)**:标准参数兜底 + 新模型默认模板 + 迁移补齐三重保障,后台「API 模型接入」填地址/Key/模型 ID 即添加,任务参数与积分计价开箱即用,无需先补参数模板。
4. **「生成融生视频」按钮高对比配色(二十一·4)**:原「玄墨底+月白字」在深色页面里近乎隐形、辨识度差 —— 生成键改为**高对比实底**:暗色主题 = 香槟金实底(#d4af6e)+ 墨字,浅色主题 = 霁蓝实底(#1e4380)+ 白字;悬停提亮、按下加深、禁用降饱和,与其余按钮(仍为墨底体系)明显区分,一眼可辨。
   - 回归验证:`node test/verify-round23.js`(30 项:3s→实扣 30、10s→实扣 100、3s 任务端到端生成时长 2.96s、V2.0 请求体帧数/帧率/宽高、通用协议 size/seconds、按钮配色断言);verify-round7(26)、round12-adapters(29)、round12-e2e(28)、round20b-features(23)、round20b-ui(12)、round20-ui(36)、round21-ui(52,断言常量同步二十二轮色板与新生成键规格)全部通过;测试产生的任务/资产/积分已清理还原。

## 第二十二轮优化 · 续(浅色对比度强化 + 全面去绿字 + 「黛金」双色调)

1. **浅色可读性强化(二十二·1)**:正文/背景区分度不足问题根治——次级文字 #5e5d55→**#4a4941(9.0:1)**、弱化文字 #96948b→**#6e6c62(5.3:1,达 AA)**,页底瓷白加深一档 #f1f1ed(白卡片层次立现),描边 .11→.14、输入控件边框 .26→.34 且转纯白底,滚动条同步加深。
2. **全面去绿字(二十二·2)**:浅色下所有绿色文字(链接 / 积分芯片 / 状态「已完成」/ 标签 / 徽章 / 免费标记 / 保存状态等 28 类部件)统一转**黛青**——accent-2 / ok / ws-purple 三个 token 及硬编码绿色 rgba 由脚本自动生成浅色覆盖;存储条/完成按钮等绿色渐变件同步转黛青。暗色模式的语义绿保持不变。
3. **「素」→「黛金」双色调(二十二·3)**:浅色重塑层次与美感——品牌字 / 登录题 / 海报题 / 统计数值 / ⌘K 徽标由平面墨色恢复**金属渐变字**(浅色为黛韵 #3a507a→#1b2a45,暗色恢复鎏金香槟并加悬停提亮);顶栏发丝线改**沙金-黛青织线**,区块标题侧条改黛→沙金竖向双色,Hero 眉题转沙金;卡片悬停描边转暖金;氛围光晕改黛金双色调;墨底按钮增加**一道极细内高光**(哑光触感,非辉光)。
4. **首页黄色字体不可见修复(二十二·4)**:顶栏激活页签「首页」在浅色下沿用暗色奶油黄 #f6edd8(白底上几乎不可见)→ **浓墨 #1b1a15**,激活下划线改黛金织线;Hero 大头像白字白底不可见 → **玄墨底 + 月白字**(与按钮同语言);Hero 眉题沙金加深 #8a6f3c→#6e5726(7.2:1)。
   - 回归验证:node test/verify-round21-ui.js 52/52(新增:浅色顶栏激活页签墨字、Hero 头像月白字断言)、node test/verify-round20-ui.js 36/36;截图 test/shots/r21-*.png 已刷新。

## 第二十一轮优化 · 续(「玄墨·月白」按钮去金化 + 浅色「月白·黛」 + 阴影再轻量化)

1. **按钮体系「玄墨 · 月白 INK & BONE」(二十一·1)**:香槟金字(#ecd9a8)的黄相仍是「土气」来源,本版**把金色从按钮家族中彻底请出**——主行动键(主按钮 / 生成键 / 工具键 / EP 票签等 10 类)统一改为**玄墨底(#1a1814 中性暖黑)+ 月白骨字(#e9e7df 无黄相)+ 素描发丝线**;选中/激活态(页签 / 分类芯片 / 占位芯片等)**月白薄雾底 + 骨字 + 素描线**;按钮对比度 14.3:1(AAA);进度条填充 / 统计卡顶线改**素面沙金 #b6ac90**(低饱和,只作点缀);键盘聚焦环转月白灰调;工作室 --ws-gold 同步降饱和(#d4b87e)。暗色鎏金渐变只保留给品牌字等**文字金属感**。
2. **浅色模式重立「月白 · 黛」(二十一·2)**:彻底摒弃传统「米黄褤纸」——底色转**瓷白 #f5f5f2(中性微冷,不再泛黄)**、卡片纯白、描边中性石墨;文字由暖褐灰转**石墨系**(正文 #1b1a15 / 次级 #5e5d55 / 弱化 #96948b);交互强调色由深金转**黛青 #2e4160**(深靛蓝,链接 / 焦点 / 选中 / 表格悬停全线跟随),品牌字 / 海报题 / 统计数值仍为浓墨;新增**画廊图录式排版签名**:标签与表头 letter-spacing .14em 的字距呼吸感(浅色限定);--grad 在浅色下转中性墨韵;工作台 / 弹层 --ws-* 作用域(含 --ws-gold→黛青)一并同步;浅色文字对比 16:1。
3. **阴影再轻量化(二十一·3)**:深色 --shadow 0 14px 34px @34% → **0 10px 26px @26%**(--shadow-glow 转纯黑调),全站暗色投影透明度统一 ×0.55(弹窗 75%→41%、⌘K 72%→40%、卡片 22%→13%、媒体悬停 30%→17%,白色内高光 ×0.6 去油腻感),遮罩 .62/.74→.52/.62;浅色阴影整体再 ×0.72(卡片 0 10px 24px@.05、弹窗 20px 48px@.14→0 18px 40px@.10、遮罩 22%→15%);中途发现的 v16b 层遗留 :root --shadow 旧值与 .btn-primary 金底 !important 死代码一并清理;旧紫蓝极光氛围(暗色 body::before、工作台紫色聚焦环)统一转暖墨/月白调,清除全部紫色残留。
   - 回归验证:node test/verify-round21-ui.js(深/浅双模式计算样式审计 48 项:玄墨底+月白骨字无渐变无阴影、对比度、浅色瓷白底/黛青强调/石墨文字/字距签名、阴影上限、EP 票签、ws 作用域、访客态认证页;截图 test/shots/r21-*.png);二十轮脚本常量已同步新体系保持通过。

## 第二十轮优化 · 续(墨金按钮 + 浅色「墨韵画廊」 + 阴影轻量化)

1. **按钮体系重立「墨金 INK & CHAMPAGNE」(二十·1)**:金底填充(深古金 #b08d45 / 丰盈古金 #c9b892 两版)仍显土气,本版彻底弃用「金色填充按钮」——主行动键(主按钮 / 生成键 / 墨金工具键 / EP 票签等 10 类)统一改为**墨底(#211a10 暖黑)+ 香槟金字(#ecd9a8)+ 金发丝描线**;选中/激活态(页签 / 分类芯片 / 占位芯片等)**香槟薄雾底 + 金字 + 金线**,不再实心填充;悬停仅提亮墨底与描线,无渐变、无扫光、无辉光、无重阴影;进度条填充 / 统计卡顶线改素面香槟;键盘聚焦为细金聚焦环。鎏金渐变只保留给品牌字、统计数值等**文字金属感**(暗色),且渐变中段由灰米调提正为香槟(#ecd9a8→#d9b878→#a87f36)。
2. **浅色模式重立「墨韵画廊」(二十·2)**:由冷灰「画廊白」转为**画廊骨白 #f4f2ec + 浓墨字 #211c11 + 暖发丝线**;浅色下品牌字 / 登录标题 / 海报题 / 统计数值 / 命令面板快捷键标等「金色渐变文字」全部转**浓墨实色**(画廊标牌气质),金色仅留发丝线与小点缀;--grad 在浅色下转墨韵渐变;背景氛围光晕近乎隐去,卡片纯白 + 一层发丝影;工作台 / 弹层 --ws-* 作用域变量同步;修复上一版浅色卡片与弹层规则中残留的 `undefined` 空洞(弹层菜单底色规则曾被清空)。
3. **阴影全面轻量化(二十·3)**:深色 --shadow 由 0 22px 54px @68% 收至 **0 14px 34px @34%**(末层 70px@74% 同步收窄),卡片 / 统计 / 弹窗 / ⌘K / 批量条 / 工作台面板等 30 余处重投影统一降档(去金色辉光,悬停位移 4px→3px);浅色下全部转**发丝影**(0 1-2px + 0 10-24px,rgba(70,60,40,.04~.10)),弹窗遮罩 78%→62%(浅色 22%),输入聚焦环改金调细环。
   - 回归验证:`node test/verify-round20-ui.js`(深/浅双模式计算样式审计:墨底香槟金按钮无渐变无阴影、扫光移除、EP 票签、浅色浓墨品牌字/数值、发丝影、--ws-gold 作用域;截图见 `test/shots/r20-*.png`)。

## 第十九轮优化(素面金按钮 + 浅色「画廊白」配色)

1. **烫金按钮简约化(十九·1)**:全站金色填充件(主按钮 / 生成按钮 / 工具按钮 / 激活页签 / 选中筛选芯片 / 徽章等 16 类)统一改为**素面古金纯色 + 墨字**(`--btn-gold` #b08d45,悬停 #a17e39,按下 #92702f),**去掉渐变、扫光动画、金色辉光与文字阴影**;键盘聚焦改为细金聚焦环;进度条填充与统计卡顶线同步素面金。鎏金渐变仅保留给品牌字等文字金属感,不再用于按钮。
2. **浅色模式配色重调(十九·2)**:由米黄「暖纸色」(#f4efe3 系)整体转向**暖调中性「画廊白」**——背景 #f5f3ed、卡片纯白 #ffffff、描边中性暖灰,环境光晕/顶栏发丝线/标题哑金梯度全部降饱和;工作台与弹层作用域变量(--ws-*)同步新配色;素面金按钮浅色下自动用更深一档(#9a7a35)保持层次。
   - 回归验证:`node test/verify-round19-ui.js`(深/浅双模式审计:按钮背景为纯色无渐变无阴影、扫光已隐藏、`--ws-gold` 作用域值、浅色卡片纯白、帧率下拉 8 档;截图见 `test/shots/r19-*.png`)。

## 第十八轮优化(烫金柔化 + 浅色模式 + 常见帧率)

1. **烫金按钮渐变柔化(十八·1)**:主渐变 `--grad` 由 #efca85→#dfa94e→#c08a30 降亮度与饱和为 **#d4af6e→#b18a41→#8c662a**(135° 金属质感保留、不再刺眼);登录卡片/首页横幅顶部装饰金线、生成按钮扫光高光(白 .5→.28)、悬停图标的亮金同步替换;浅色模式改用更深的 #d2a860→#ad8038→#85601f,纸底上沉稳。
2. **浅色模式(十八·2)**:顶栏新增 ☀/☾ 切换按钮;`html[data-scheme="light"]` 全套浅色变量(暖纸底 #f4efe3 / 墨色文字 / 深鎏金强调 / 深定位绿),覆盖卡片、面板、输入控件、弹层、菜单、工作台与认证页;`index.html` 首帧前脚本按 localStorage('vf-scheme') > 跟随系统确定方案,避免加载闪烁;工作台 `.ws` 与弹层 `#modalRoot` 的作用域变量(金 / 面板 / 线 / 灰阶)浅色下一并覆盖,浅绿高亮文字压暗保证纸底可读。
3. **常见帧率(十八·3)**:分镜规格「帧率」下拉内置 8 档常见规格 —— 23.976(电影 NTSC)/ 24(电影标准)/ 25(PAL)/ 29.97(NTSC)/ 30(默认)/ 48(高帧率)/ 50(PAL 高清)/ 60(流畅);`COMMON_FPS` 单一数据源(下拉渲染与工作记录恢复校验共用),与后台模型参数帧率选项、内置/ffmpeg 引擎(fps clamp、zoompan/fps 滤镜)保持一致。
   - 回归验证:`node test/verify-round18b-ui.js`(深/浅双模式计算样式审计:按钮渐变、`--ws-gold` 作用域值、帧率下拉 8 选项)、`node test/verify-round18c-auth-modal.js`(登录页双模式)。

## 第十七轮优化 · 续(规格四项布局放宽 + 提示词编辑字号提升)

1. **规格四项改两行两列(十七·6)**:画幅比例 / 分辨率 / 帧率 / 时长由单行四列(300px 参数栏下每格不足 70px,过于拥挤)放宽为 **2×2 两行两列**,格宽升至 131px;单元格标签 10 → 10.5px,下拉字号 11 → 12px、内边距放宽,选项文案同步更完整(「16:9 横屏 / 9:16 竖屏 / 24 fps」),时长 10s 档恢复「默认」标注;≤1240px 堆叠模式下网格自动获得更宽空间(204px),四档视口几何审计零重叠、零截断;
2. **剧本文案占位高亮芯片放大(十七·7)**:芯片资产名 **10 → 12px**(与输入区 13 → 14px 新字号同步),缩略图改为**恒显**(不再依宽度省略,长名场景不再丢失「图+文字」样式);名称字号按芯片剩余宽度 12/11.5/11/10px 逐级适配 + 亚像素安全余量,保证任何名字都完整显示无省略号截断;镜像层对齐、光标让位等既有行为不变;
3. **提示词编辑区文字放大(十七·7)**:剧本文案输入区 **13 → 14px**(最小高度 128 → 140px),负向词输入框 12 → 12.5px;
4. 回归验证:`node test/verify-round17d-studio.js`(断言更新为两行两列 + 芯片恒显图标 + 字号提升 + 无截断,ALL PASS)、`node test/verify-round17c-studio.js`(修复单分镜环境下「独立展开」检查的选择器越界,ALL PASS)、`node test/qa-round17b-plink.js`(PLINK PASS),另以四档视口(1680/1440/1240/1100)几何审计确认网格两行两列、零重叠零截断、无 JS 异常;截图更新于 `test/shots-v17d/`。

## 第十七轮优化(全站风格再进化 · 视频创作工作台重设计)

1. **全站风格「玄金大观 MONOLITH」(17·1)**:
   - 大字衬线标题 / 编辑部读数条 / 取景框签名 / 鎏金扫光按钮;静态化氛围层修复周期性闪屏;`html scrollbar-gutter` 稳定不再顶跳版面;轮询重渲染静默化(不重播入场动画)。
2. **视频创作页面(分镜工作台)布局与样式整体重设计(17·2)**:
   - **单行顶部导航**:原独立工具栏(录入原文 / 批量审片 / 工作日志 / 补给资产)并入顶栏右侧紧凑工具组,省出一整行高度给创作区;视图切换(分镜设计 / 剪辑预览)带图标;≤1120px 自动收缩为纯图标;分集徽章改为鎏金「EP 01」票签;
   - **分镜卡「参数左 · 创作右」双栏**:左侧 300px 参数栏(视频模型 / 风格 / 画幅比例 / 分辨率 / 帧率 / 时长 / 运动强度 / 种子),右侧为剧本文案编辑区(题帽 + 大输入区 + 占位链接 chips + 负向词 + 生成键),纵向分隔线分区;≤1240px 自动堆叠且提示词排前、参数收进下方两列网格;≤1420px 参数栏收窄至 272px;
   - **时长改下拉**:3-15s 整档下拉直选(10s 标注「默认」),替代滑杆;运动强度保留滑杆;
   - **删除分镜二次确认**:点击删除弹出确认弹窗(取消保留 / 确认删除),防误触;
   - **生成记录分区折叠**:每张分镜的生成记录带分区头(记录数 + 进行中标记 + 收起/展开),顶栏「折叠记录 / 展开记录」一键全部收起省出页面空间,状态持久化、单镜可独立展开,提交新任务自动展开该分区显示进度;
   - **分段控件替代下拉**:比例(16:9/9:16)、分辨率(480p/720p/1080p)、帧率(24/30/60)改为单点直达的分段单选,沿用原 change 委托与参数语义;
   - **行内标题编辑**:分镜标题直接在卡头输入框编辑并持久化;排序 / 删除不再覆盖自定义标题;标题点击不触发卡片折叠;
   - **种子骰子**:一键随机种子并同步输入框;
   - **Ctrl/⌘ + Enter 快捷生成**:光标在剧本文案内直接提交该分镜;
   - **读数条信息升级**:分镜数等宽数字 + 「生成中 N」实时计数 + Ctrl+Enter 快捷键提示;主栏工具条吸底渐变背景;
   - **样式全面对齐 MONOLITH**:暖黑面板(#14110d)+ 金色发丝线 + 卡片悬停取景括号 + 鎏金扫光生成键 + 完成视频带封面帧 poster;工作台 `--ws-*` 变量弃用旧偏蓝面板,与 `#modalRoot` 一并对齐暖金体系;批量审片 / 工作日志 / 资产挑选弹窗复用件同步换肤;
   - **可访问性**:分段控件支持键盘焦点环,`prefers-reduced-motion` 降级(去扫光 / 停旋转)。
   - 回归验证:`node test/verify-round17b-studio.js`(结构 12 项 + 交互 9 项)、`node test/verify-round17b-final.js`(终检 11 项,含删除确认弹窗)、`node test/verify-round17c-studio.js`(参数左置 / 时长下拉 / 删除弹窗 / 记录分区折叠,20 项)、`node test/qa-round17b-plink.js`(占位链接镜像对齐 / chips / 点击联动)、`node test/qa-round17b-layout.js` + `qa-round17b-nav.js`(1680→1080 六档宽度溢出 / 重叠 / 顶栏收隘审计),全部通过且零控制台报错;截图见 `test/shots-v17/studio-{before,after,after-narrow,after-edit,final,r2-final}.png`。

## 🔌 主要 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/auth/register · /login · /logout | 认证 |
| POST | /api/assets/upload | 上传素材(multipart,可带 category) |
| GET/POST/PATCH/DELETE | /api/assets, /api/assets/folders | 资产与文件夹管理(支持 ?category= 筛选) |
| POST | /api/assets/batch-category | 批量设置资产分类 |
| POST | /api/assets/auto-categorize | 按文件类型/文件名关键词自动分类(未分类资产) |
| POST | /api/assets/:id/share | 共享资产 |
| POST | /api/images/generate | 提交 AI 生图任务(按张扣积分,支持 ref_asset_id 图生图 / project_id 分镜关联) |
| GET | /api/images/models · /api/images/assets/:id | 可用生图模型(含 perImage 定价)/ 生图关联资产简表 |
| POST | /api/tasks | 提交图生视频任务(按段时长扣积分,支持 linked_asset_ids 占位链接) |
| GET/POST | /api/tasks, /api/tasks/:id/cancel · /retry · /regenerate · DELETE /:id | 任务管理(取消/失败自动退积分;终态记录可删除) |
| GET/PUT/POST | /api/episodes/:id/studio | 分镜工作台工作记录读取/自动保存(POST 兼容 sendBeacon) |
| POST | /api/admin/models/detect | 填入 API 地址 + Key 检测可用模型列表(OpenAI 兼容) |
| GET/POST/PATCH/DELETE | /api/projects, /api/episodes/:id, /api/scenes/:id, /api/clips/:id | 分集管理 |
| POST | /api/projects/join · /api/projects/:id/leave · GET /:id/members | 邀请码加入/退出项目 |
| GET | /api/credits · POST /api/credits/apply | 积分汇总/申请积分 |
| POST | /api/scenes/:id/copy | 跨分集复制场景 |
| GET | /api/projects/:id/export?episode_id=&width=&height= | 导出 MP4 |
| GET/POST/PATCH/DELETE | /api/styles, /api/styles/:id/favorite | 风格库 |
| GET | /api/admin/models/adapters | 可用模型适配器列表(生成协议下拉) |
| POST | /api/admin/models/:id/check · /:id/selftest | 模型有效性检查(含生成规则校验) / 免费模型端到端自检 |
| GET/POST | /api/admin/credit-requests, /api/admin/users/:id/credits | 积分审批 / 手动调分 |
| PATCH | /api/admin/settings(creditPerSecond · creditOverrides · videoResolutions · creditPerImage) | 全局每秒定价 / 段时长覆盖价 / 生成视频尺寸白名单(480p/720p/960p/2k)/ AI 生图每张积分 |
| PATCH | /api/admin/models(credit_per_second) | 模型每秒积分消耗(>0 时优先于全局定价,免费模型恒 0) |
| GET | /api/config | 平台配置(登录用户可读):生成视频尺寸白名单与默认档 |
| GET/POST/PATCH/DELETE | /api/admin/users · /tasks · /models · /settings | 后台管理 |

## 📝 说明

- 平台中的"AI 推理"由本地 ffmpeg 渲染管线模拟(zoompan 推拉 + 风格化调色),真实模型接入时替换 `server/ffmpeg.js` 的 `generateI2V` 即可,任务队列/进度/统计等基础设施完全复用。
- 上传文件与生成结果存放在 `data/` 目录;重置演示数据:停止服务后删除 `data/` 再启动。
- 完整端到端验证:`node test/e2e.js`(API 流程)、`node test/browser-check.js`(无头 Chrome 渲染各页面)、`node test/verify-round3.js`(导航栏固定/资产分类/纯色 UI 专项)、`node test/verify-round5.js`(第五轮 API 专项)、`node test/verify-round5-ui.js`(第五轮 UI 专项)、`node test/verify-round12-adapters.js`(模型适配器/生成规则)、`node test/verify-round12-e2e.js`(Mock 网关全链路)、`node test/verify-round12-ui.js`(第十二轮 UI)、`node test/verify-round20b-features.js`(资产日期时间/模型每秒积分/生成尺寸配置 API 专项)、`node test/verify-round20b-ui.js`(同三功能 UI 专项)、`node test/verify-round25-imagegen.js`(第二十五轮 AI 生图:协议识别 / Mock OpenAI+Gemini 网关 / 本地占位 / 迁移种子)、`node test/verify-round26-imgopts.js`(第二十六轮生图:能力勾选 / 参数模板 / 多图合成 multipart 与 Gemini 多 inlineData / 真实服务 e2e)、`node test/verify-round27-imgpolish.js`(第二十七轮生图:模型积分单价 / 上传缩略图 / 自定义比例尺寸 / 种子随机刷新与固定种子复现)、`node test/verify-round36-busy-requeue.js`(第三十六轮:视频网关「排队已满」的队列级自动延后重投 —— 独立 DATA_DIR + Mock 网关,27 项)、`node test/verify-round37-dashscope.js`(第三十七轮:百炼契约 —— 视频自定义头/嵌套任务 ID/路径令牌/嵌套媒体模板 + 生图深填充与深层结果解析,23 项)、`node test/verify-round37-bigmodel.js`(第三十七轮:智谱 cogvideox-flash 异步视频契约,11 项)。

#### 功能增量:资产日期时间 · 模型每秒积分消耗 · 生成视频尺寸后台配置

- **资产库日期时间**:资产卡片与预览弹窗显示上传日期时间(`YYYY-MM-DD HH:MM`),工作台「资产库窗口」挑选弹窗同款;
- **模型每秒积分消耗**:后台「模型管理」编辑弹窗可为单个模型设置 积分/秒,该模型按 `秒数×单价` 向上取整计价,优先于全局每秒单价与段时长覆盖价;留空/0 回退全局定价;免费模型恒 0;模型表格新增「积分/秒」列,工作台成本提示即时跟随;
- **生成视频尺寸后台配置**:后台「系统设置 → 生成视频尺寸」勾选 480p / 720p / 960p / 2k(至少一项),分镜工作台「分辨率」下拉按配置渲染;任务提交的分辨率按白名单校验,历史值(如 1080p)自动回退默认档 720p。

#### 网关诊断增强(跃数等中转站)

- **协议识别修正**:`as-sd2.0-fast`、`sora-v3` 等模型不再因 ID 含 "2.0" 被误判为 Agnes 协议;Agnes 专属适配仅在模型 ID / 网关域名明确指向 Agnes 时启用;
- **创建路径自动试探**:openai-video 通用协议在 `/videos` 404 时自动尝试 `/videos/generations`、`/video/generations`(试通后进程内记忆,显式配置的 `create.path` 不回退);
- **REST 查询候选**:自动识别模型的查询端点跟随 `创建路径/{id}` → `/videos/{id}` → 旧版 `/agnesapi`;
- **模型检查新增创建路径探活**:检查阶段即发现「网关不支持视频 API / 路径不存在」,不再出现"检查通过但生成必失败";跃数网关的应答会原样透出(如 *Videos API is not supported for this platform*)并附行动建议;
- **排查结论(跃数AI / ys666.site)**:其 OpenAI 兼容口对 sora/sd 系列仅提供模型列表,视频创建路由应答"未开放视频 API",内部 AI 视频接口仅认网页登录态(不认 sk- Key),chat 方式上游持续 502——需联系跃数开通视频 API 后方可使用。
