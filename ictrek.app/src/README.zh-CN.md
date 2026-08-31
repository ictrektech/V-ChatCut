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

工程、上传素材、模型缓存、设置和导出状态保存在 VOS 应用私有目录的 `data/` 下。卸载应用前请按需备份该目录。

### 导入媒体

- **本机与手机**：素材通过浏览器上传或手机扫码传入，统一保存到应用私有目录。
- **VOS 存储 / Samba**：先在 VOS 为 V-ChatCut 授权用户目录或公共目录，然后从素材库的「从 VOS / WebDAV / AI 相册导入」入口选择文件。应用只读浏览授权目录，选中的文件会复制到应用私有素材区；无需在应用内配置 Samba 账号。
- **WebDAV**：安装或升级时填写 WebDAV 地址及可选账号密码。
- **AI 相册**：填写 Immich 地址和 API Key 后，可浏览最近素材或使用 AI 搜索，再导入原始媒体。

外部素材导入后均转为 V-ChatCut 管理的 `/media/uploads/` 素材，因此取消目录授权、WebDAV 离线或相册文件变化不会破坏已经导入的工程，但会额外占用应用存储空间。

### 工程包

项目页可导出和重新导入 `.ccproj`。工程包包含剪辑工程数据和工程引用的本地上传媒体；外部素材在导入 V-ChatCut 后也会随包。当前单个随包媒体上限为 512 MiB，缺失、空文件或超过上限的素材会在导出完成提示中列出。

## 性能

CUDA profile 会优先探测 NVIDIA NVENC。硬件编码器或驱动不可用时，V-ChatCut 会回退到 libx264，任务仍可完成但速度较慢。
