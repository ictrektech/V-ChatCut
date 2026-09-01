# V-ChatCut

V-ChatCut 是本地优先、Agent 驱动的多轨视频编辑器，支持素材管理、字幕、动效、智能分析、媒体生成和视频导出。

## Profile

- `amd-with-cuda`：AMD64 NVIDIA CUDA，使用 NVENC 和 GPU 渲染，失败时自动回退软件编码。
- `amd-without-cuda`：AMD64 CPU，使用软件渲染和 libx264。
- `arm-with-cuda`：通用 ARM64 NVIDIA CUDA，启用硬件编码探测。
- `arm-without-cuda`：ARM64 CPU，使用软件渲染和 libx264。
- `l4t`：Jetson / L4T，启用 NVIDIA runtime 和硬件编码探测。
- `thor-spark`：NVIDIA Thor / Spark，启用 NVIDIA runtime 和硬件编码探测。

前端只构建 AMD64 和 ARM64 两种镜像；所有 ARM64 后端 profile 复用 ARM64 前端镜像。

## 数据

V-ChatCut 使用 VOS OIDC Fastpath 验证当前用户，并以不可变的 OIDC `sub` 建立用户目录。每个用户的工程、上传素材、设置、生成任务和导出状态分别保存在 `data/users/<用户哈希>/` 下；浏览器 localStorage、sessionStorage 和 IndexedDB 也按同一身份分区。切换 VOS 用户不会复用上一用户的数据。

VOS 中工程和素材目录由应用映射自动管理，设置页不会向普通 VOS 用户提供本地路径修改入口。

旧版共享在 `data/` 根目录的数据不会自动向所有用户开放。VOS 管理员可显式调用 `POST /api/auth/claim-legacy-data` 将旧工程和媒体认领到自己的用户目录；目标已有数据时接口会拒绝，成功后需要重启应用。

### 导入媒体

- **本机与手机**：素材通过浏览器上传或手机扫码传入，统一保存到应用私有目录。
- **VOS 存储 / Samba**：VOS exposed 是应用级视图，多用户模式默认不开放。只有挂载内容是所有用户均可访问的公共素材库时，管理员才可开启「共享 VOS 授权目录」。
- **WebDAV**：管理员可提供地址默认值；每个 VOS 用户在「设置 → 素材 · 转写 → 远程素材 → WebDAV」填写自己的用户名和密码。
- **AI 相册**：同一 VOS 内会先尝试通过当前登录用户的 OIDC token 访问 `com.ictrek.ai-album`；如果 AI 相册 API 返回 401，或连接独立 Immich，每个 VOS 用户在「设置 → 素材 · 转写 → 远程素材 → AI 相册」填写自己的 API Key。

外部素材导入后均转为 V-ChatCut 管理的 `/media/uploads/` 素材，因此取消目录授权、WebDAV 离线或相册文件变化不会破坏已经导入的工程，但会额外占用应用存储空间。

### 工程包

项目页可导出和重新导入 `.ccproj`。工程包包含剪辑工程数据和工程引用的本地上传媒体；外部素材在导入 V-ChatCut 后也会随包。当前单个随包媒体上限为 512 MiB，缺失、空文件或超过上限的素材会在导出完成提示中列出。

## 性能

CUDA profile 会优先探测 NVIDIA NVENC。硬件编码器或驱动不可用时，V-ChatCut 会回退到 libx264，任务仍可完成但速度较慢。
