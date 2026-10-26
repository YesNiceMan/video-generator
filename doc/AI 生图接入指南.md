# AI 生图接入指南(第二十五 / 二十六轮 · 第三十四轮改为规则驱动尺寸)

> 面向管理员:如何把一个新的生图 API 接进平台 —— **全程后台填表,无需改代码**。

## 一、生图入口

- 顶栏「AI 生图」(`#/images`):独立生图工坊,模型 / 风格 / 负面词 / 参考图(图生图·多图合成)/ 画幅比例 / 尺寸 / 张数(1–4);参考图挑选弹窗支持多选与**大图浏览**(上一张 / 下一张,← → 方向键翻页);
- 分镜工作台:工具栏「AI 生图」或每个分镜卡头的 ✨ 快捷按钮(自动预填本镜文案),生成结果自动加入该镜参考资产;
- 生图结果自动存入资产库(`source=imggen`),可直接用作图生视频的源图。

## 二、内置协议

| 协议 | 适用服务 | 关键行为 |
| --- | --- | --- |
| `openai-image` | OpenAI Images 及一切兼容网关(如各家中转、OneAPI) | 文生图 `POST {api_base}/images/generations`(JSON);图生图有两种形态,由 `create.edit` 决定 —— **`multipart`(默认)** 走 `POST {api_base}/images/edits` 表单(单图 `image` / 多图 `image[]`),**`json`** 仍走 `create.path` 的 JSON 端点、把参考图数组写入 `create.images_field`(Agnes images 这类「一个端点 + `image:[url|base64]`」的网关用这种);响应支持 `url` 与 `b64_json` 两种字段,可混用 |
| `gemini-image` | Google Gemini(2.5 Flash Image 等)/ Imagen | `POST {api_base}/models/<model_id>:generateContent`,`x-goog-api-key` 头鉴权;解析 `candidates[].content.parts[].inlineData`;`generationConfig.imageConfig.aspectRatio` 就近吸附到 `rules.limits.aspect_ratios`(缺省 1:1 / 3:4 / 4:3 / 9:16 / 16:9 / 21:9),`imageConfig.imageSize` 取 `rules.limits.resolutions` 里的档位(缺省 1K/2K/4K);分别可用 `create.aspect_ratio:false` / `create.image_size:false` 关闭 |
| `img-ffmpeg` | 本地占位引擎(内置免费模型 `m-img-free`) | 不调外部 API,按提示词哈希生成渐变占位图,0 积分,适合体验与联调 |

### 「像素尺寸」还是「档位」—— 由模板决定，不写死(第三十四轮)

平台**不预设任何一家网关的尺寸写法**：看模型的 `rules.create.body` 里用了哪个令牌 ——

- 用了 `<size>`(或图生图走 OpenAI 的 multipart 端点)→ **像素模式**：提交前把 `比例 × 分辨率档` 换算成 `WxH`，再向 `rules.limits.sizes` 清单就近吸附(同方向优先)。
- 用 `<resolution>` / `<ratio>` 而没有 `<size>` → **档位模式**：`size` 原样发档位字符串(如 `1K`/`2K`/`4K`)，画幅走 `ratio` 字段；像素换算值只用于界面展示与本地渲染，**不再被尺寸清单改写**。

前台生图页的「输出规格」读数会跟着变：像素模式显示 `输出尺寸 1820×1024`，档位模式显示 `请求参数 size=1K · ratio=16:9(该网关按档位出图…)`。

> 实测对照(agnes-image-2.5-flash)：改档位模板前发 `size=1536x1024` 且不带 `ratio`，网关自行「标准化」成 1248×832(3:2)，用户选的比例被吞掉；
> 改档位模板后发 `size=1K + ratio=16:9` → 返回 **1312×736**(严格 16:9)，`size=2K + ratio=9:16` → **1472×2624**(严格 9:16)。

## 三、接入一个新模型(后台填表)

1. **后台管理 → 模型管理 → 新建模型**;
2. 表单填写:
   - **类型**:选「AI 生图」;
   - **模型 ID**:服务商的模型名,如 `gpt-image-1`、`gemini-2.5-flash-image`;
   - **API 地址**:如 `https://api.openai.com/v1`(openai-image)或 `https://generativelanguage.googleapis.com/v1beta`(gemini-image);
   - **API Key**:服务商密钥(保存后仅显示尾 4 位);
3. **保存**:系统自动做有效性检查(协议规则校验 + 本地试渲一张占位图);
4. 前台「AI 生图」页立即出现该模型,可直接生成。

**协议识别规则**(无需手选):

- 模型 rules 里显式写了 `protocol` → 以它为准;
- `model_id` 含 `gemini` / `imagen` → `gemini-image`;
- 有 `api_base` + `model_id` → `openai-image`;
- 都没有 → `img-ffmpeg` 本地占位。

## 四、模型能力勾选与参数模板(第二十六轮)

编辑(或新建)生图模型时,弹窗会出现「生图参数」面板:

1. **模型能力勾选**(存入 `rules.caps`):
   - **文生图**(text-to-image):纯提示词生图,默认必开;
   - **图生图**(image-to-image):允许提交 1 张参考图重绘 / 融合;
   - **多图合成**(multi-image):允许一次提交 2–8 张参考图融合生成(自动蕴含图生图能力);
   - 未勾选的能力会被 API 直接拒绝(如对仅文生图模型带参考图提交 → 400「未开启图生图能力」);
   - **张数上限**(1–4,存入 `rules.limits.max_count`),前台张数下拉按它渲染。
2. **画幅比例**(点选启用,可多选):1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 3:2 / 2:3 / 21:9;
3. **支持的分辨率档(第三十四轮:清单自己填)**:「支持的分辨率档」输入框里写 `1K, 2K, 3K, 4K` 这类档位名，或直接写像素 `1024, 2048`；生图页的「分辨率」下拉**完全按这一行渲染**，留空 = `1K, 2K, 4K`。默认档下拉会跟着清单重算，新增网关不必改代码。
   - 换算规则：短边 = 档位像素，长边按**真实画幅比例**换算(取偶数、长边封顶 4096)，如 `1K + 16:9 → 1820×1024`、`1K + 21:9 → 2390×1024`；
   - **手动输入(第二十七轮)**:比例可输入任意 `宽:高`(如 `4:5`、`2.35:1`)添加为自定义标签;「固定尺寸清单」(`1024x1024, 1536x1024`)仅在模板发 `<size>` 时参与就近吸附;
   - **规则模板一键填入(第三十四轮)**:「生成规则 JSON」下方有「填入档位网关模板(Agnes 式)」与「填入 OpenAI 像素模板」两个按钮，只覆盖 `create` / `limits` / `caps` 的相关键，其余已写的规则原样保留。
4. **质量档**(standard / hd)与 **种子参数**:按目标 API 支持情况勾选;
5. 面板右下实时预览将写入 `params_schema` 的 JSON;前台生图页的「画幅比例 / 尺寸 / 质量 / 种子 / 张数」控件**完全由该模板驱动**,选比例自动联动最近宽高比的尺寸档;
6. openai 兼容网关:模型给了 `ratio` 模板时,请求同时携带 `aspect_ratio`(模板令牌 `<aspect_ratio>`)与按比例换算的 `size`;Gemini 协议把比例写入 `generationConfig.imageConfig.aspectRatio`(就近吸附 1:1 / 3:4 / 4:3 / 9:16 / 16:9 / 21:9)。

> 多图合成请求:前端提交 `ref_asset_ids` 数组;openai-image 用 multipart `image[]` 字段(单图仍用 `image`),gemini-image 每张参考图注入一个 `inlineData` part。免费内置模型 `m-img-free` 已默认全能力,可直接体验。


- 模型 rules 里显式写了 `protocol` → 以它为准;
- `model_id` 含 `gemini` / `imagen` → `gemini-image`;
- 有 `api_base` + `model_id` → `openai-image`;
- 都没有 → `img-ffmpeg` 本地占位。

## 五、自定义请求模板(进阶)

兼容网关字段不一致时,在模型的 **生成规则(rules)** JSON 里覆写模板即可,`<token>` 会在运行时替换:

```json
{
  "protocol": "openai-image",
  "create": { "path": "/images/generations", "body": {
    "model": "<model_id>", "prompt": "<prompt>", "n": "<n>", "size": "<size>" } },
  "edit_path": "/images/edits",
  "response": { "data_path": "data", "url_field": "url", "b64_field": "b64_json" },
  "limits": { "max_count": 4, "sizes": ["1024x1024", "1536x1024", "1024x1536"] }
}
```

可用令牌：`<model_id>` `<prompt>` `<negative_prompt>` `<n>` `<size>`(像素 `WxH`) `<resolution>`(分辨率档位，如 `2K`) `<ratio>` / `<aspect_ratio>`(画幅，如 `16:9`) `<width>` `<height>` `<max_side>` `<min_side>` `<quality>` `<seed>` `<style>` `<task_id>`；令牌值为空时该字段自动剔除，`create.headers` 里的值同样会被替换。

档位网关示例(agnes-image-2.5-flash：`size` 收 `1K/2K/4K`，画幅走 `ratio`，图生图与文生图同一 JSON 端点)：

```json
{
  "protocol": "openai-image",
  "caps": ["text-to-image", "image-to-image", "multi-image"],
  "create": {
    "path": "/images/generations",
    "edit": "json",
    "images_field": "image",
    "body": { "model": "<model_id>", "prompt": "<prompt>", "n": "<n>",
              "size": "<resolution>", "ratio": "<ratio>" }
  },
  "response": { "data_path": "data", "url_field": "url", "b64_field": "b64_json" },
  "limits": { "max_count": 1, "resolutions": ["1K", "2K", "4K"],
              "aspect_ratios": ["1:1","4:3","3:4","16:9","9:16","2:3","3:2","21:9"] }
}
```

- `create.edit:"json"` + `create.images_field:"image"` → 参考图(图生图 / 多图合成)以数组形式写进同一个 JSON 请求体；元素是签名直链或 `data:` URI(取决于系统设置里的公网地址)。单图想发字符串而非数组时加 `"images_single_string": true`。
- 需要 `return_base64` / `extra_body.response_format` 之类的专有字段？直接写进 `create.body` 字面量即可(不含令牌的键会原样发出)。
- 只想改字段名、不改结构？把 `create.body` 里对应键改名即可，例如某网关用 `image_size` 收档位：`"image_size": "<resolution>"`。

gemini 协议的 rules 还支持 `create.aspect_ratio:false` / `create.image_size:false`(关闭对应注入)、`candidates_path` / `parts_path` / `inline_field` 自定义响应路径(支持点分多级,如 `content.parts`)。

## 六、计价

- 生图模型在后台设置的 **「积分消耗」就是每张价格**(留空/0 则回退全局);
- 系统设置 → 积分定价 → **AI 生图每张积分**(`creditPerImage`,默认 2)仅在模型未设价时生效;
- 模型勾选「免费」则恒 0 分;
- 提交时按 `单价 × 张数` 扣减,**失败 / 取消自动全额退还**;

## 七、自检与排障

- 「模型管理 → 检测」:校验协议 rules 与端点格式,本地试渲占位图;
- 「模型管理 → 自检」:对生图模型真实发起 1 张生图任务并核对落盘(免费模型端到端);
- 常见失败:
  - 401/403:API Key 无效或欠费;
  - 400 size:该 API 不支持的尺寸 → 在 rules `limits.sizes` 里收敛白名单;
  - multipart 报错:个别网关 `/images/edits` 不支持 `image[]` → 换用支持多图的网关或去掉参考图(多图合成仅在模型勾选「多图合成」能力后开放);
  - Gemini 无图返回:检查 `finishReason`(如 `PROHIBITED_CONTENT` 触发安全拦截),错误信息会透传给任务卡。

## 八、验证

```bash
node test/verify-round25-imagegen.js   # 38 项:协议识别 / Mock OpenAI(JSON+multipart)+ Gemini 网关 / 本地占位 / 迁移种子
node test/verify-round26-imgopts.js    # 37 项:能力归一化 / 比例换算 / 多图合成(image[] 与 Gemini 多 inlineData)/ 能力拒绝 / 真实服务 e2e
node test/verify-round27-imgpolish.js  # 16 项:模型积分单价 / 上传缩略图 / 自定义比例尺寸模板 / 种子随机刷新与固定种子复现
```
