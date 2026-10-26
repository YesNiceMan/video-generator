# 🎬 视界引擎 · AI 视频生成与编辑平台

基于 Web 的 AI 视频生成与编辑平台,参考 mikooo.cn/editor 交互模式,为影视制作团队提供一站式创意视频生产工具。包含资产库管理、图生视频、风格库、分集管理(项目 → 分集 → 分镜 → 生成记录)、积分体系与后台模型管理。

## 🎨 设计系统(「鎏金胶片 Ciné Noir」v4)

- **单一令牌层**(`public/css/app.css` 顶部 `:root`):间距 4 的倍数、字号 8 档(11/12/13/14/17/22/28)、圆角 4 档、表面三级、阴影三级;组件不再硬编码尺寸,装饰金与「小号金色正文」分别用 `--gold` / `--gold-text`。
- **配色**:影棚暖黑画布 · 鎏金主色 · 定位绿(成功)/ 琥珀(进行)/ 朱红(失败);顶栏右侧 ☀/☾ 一键切换**浅色「画廊白」**并持久化。
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
