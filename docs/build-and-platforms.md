# 跨平台镜像构建与架构差异

## 默认推荐: 直接使用官方多架构镜像

`knuth` 默认配置指向官方镜像 `verdaccio/verdaccio:6.10.1`, 该镜像本身已发布为 **Multi-Arch OCI Manifest**, 同时包含 `linux/amd64` 与 `linux/arm64` 变体:

- x86_64 Linux 服务器 / 云主机 -> 自动拉取 `linux/amd64`
- Apple Silicon Mac (OrbStack / Podman / macOS `container`) -> 自动拉取 `linux/arm64`
- 树莓派 4B/5 / AWS Graviton ARM64 Linux -> 自动拉取 `linux/arm64`

**仅做私有仓库部署与配置管理时, 无需在本地维护 `Dockerfile` 或手动构建镜像** (`conf/config.yaml` 通过挂载或 `ConfigMap` 注入即可)。

---

## 何时需要自行构建镜像

- 需要在容器内预装自定义 Verdaccio 插件 (特别是依赖 C/C++ 原生扩展的插件);
- 内网完全离线环境不允许挂载外部目录, 希望将静态 `conf/config.yaml` 与插件一起烘焙进不可变镜像分发。

自定义扩展 `Dockerfile` 示例 (注意必须切回非 root 用户 `10001`):

```dockerfile
FROM verdaccio/verdaccio:6.10.1

USER root
# 示例: 安装自定义插件
# RUN npm install --global --prefix /verdaccio/plugins verdaccio-xxx

USER $VERDACCIO_USER_UID
```

---

## 各平台构建方式与核心差异

| 平台 | 构建命令入口 | 跨架构 (`amd64` / `arm64`) 机制 | 关键注意事项 |
|---|---|---|---|
| **Docker** | `docker buildx build` | 通过 Buildx `docker-container` driver 调用 QEMU 模拟或多节点远程 builder | 原生 `docker build` 单次只产当前架构; 发多架构镜像需加 `--platform linux/amd64,linux/arm64 --push` |
| **OrbStack** | `docker build` / `docker buildx` | Apple Silicon 原生构建 `arm64`, 内置 Rosetta 2 透明加速 `amd64` 构建 | 比传统 QEMU 模拟构建快得多; 与本地 `docker run` 共用同一套镜像缓存 |
| **Podman** | `podman build` + `podman manifest` | 不使用 Buildx driver, 需先建 Manifest 列表再逐平台写入与推送 | 多架构需执行 `podman manifest create` 配合 `podman build --platform ... --manifest ...`, 详见下方 |
| **macOS `container`** | `container build` | 在独立 BuildKit Linux 虚拟机中执行构建, 支持 `--platform` 与 `-o type=oci` | **镜像库与 Docker / Podman 不互通**; 构建含原生编译的大型插件前须先扩大 builder VM 内存与 CPU |
| **Kubernetes** | **不负责构建镜像** | 调度器按节点 `kubernetes.io/arch` 从远端镜像仓库自动拉取对应架构层 | 必须先由上游 CI / Docker / Podman 推入集群可达的 Registry; 异构集群务必推送双架构 manifest |

### 各平台自定义构建命令对比

#### 1. Docker / OrbStack (多架构 Buildx)

```shell
# 首次使用多架构输出需确保存在 docker-container 驱动的 builder
docker buildx create --name knuth-builder --use --driver docker-container || true

# 构建并推送双架构镜像到远端仓库
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/<your-org>/knuth-verdaccio:1.0.0 \
  --push .
```

#### 2. Podman (OCI Manifest List)

Podman 原生把多架构图像管理拆成 Manifest 列表操作:

```shell
# 1. 创建空白 manifest 列表
podman manifest create ghcr.io/<your-org>/knuth-verdaccio:1.0.0

# 2. 分别构建各架构镜像并写入同一个 manifest
podman build \
  --platform linux/amd64,linux/arm64 \
  --manifest ghcr.io/<your-org>/knuth-verdaccio:1.0.0 \
  .

# 3. 整体推送多架构 manifest
podman manifest push \
  ghcr.io/<your-org>/knuth-verdaccio:1.0.0 \
  docker://ghcr.io/<your-org>/knuth-verdaccio:1.0.0
```

#### 3. macOS `container` CLI (独立 BuildKit VM)

```shell
# 若插件含原生编译或依赖较多, 先为 BuildKit builder VM 分配充足资源
container builder start --cpus 4 --memory 8g

# 构建当前默认架构 (Apple Silicon 为 linux/arm64) 并入本地 OCI 镜像库
container build -t knuth-verdaccio:custom .

# 或指定目标平台与输出格式
container build --platform linux/amd64 -t knuth-verdaccio:amd64 -o type=oci .
```

> `container build` 产出的本地镜像仅存于 `apple/container` 私有仓库 (`container image list` 可见), 若要交给 Kubernetes、OrbStack 或树莓派集群使用, 须先 `container image push` 到标准容器镜像仓库 (如 GHCR / Docker Hub / 私有 Registry)。

#### 4. Kubernetes 消费自建镜像时的注意点

1. 在 `knuth.config.ts` 中把 `docker.image` 更新为推入仓库后的完整地址 (如 `ghcr.io/<your-org>/knuth-verdaccio:1.0.0`) 并重跑 `npm run init`。
2. 如私有镜像仓库需要鉴权, 须在对应 Namespace 创建 `imagePullSecret`, 并在生成的 `k8s/verdaccio.yaml` Deployment 中补充 `imagePullSecrets`。
3. 若构建产物仅含单一架构 (如仅 `arm64`), 应在 Pod `spec.nodeSelector` 中显式约束 `kubernetes.io/arch: arm64`, 避免被调度到 `amd64` 节点后出现 `exec format error`。
