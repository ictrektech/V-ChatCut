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

## 性能

CUDA profile 会优先探测 NVIDIA NVENC。硬件编码器或驱动不可用时，V-ChatCut 会回退到 libx264，任务仍可完成但速度较慢。
