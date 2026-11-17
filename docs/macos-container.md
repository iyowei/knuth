# 在 macOS `container` CLI 上启动 Knuth

Apple 官方推出的 [`container`](https://github.com/apple/container) 工具基于 macOS `Virtualization.framework` 运行轻量化虚拟机容器 (以下操作已基于 `container CLI 1.2.0` 核验)。

## 与 Docker 的核心差异

1. **不支持 Docker Compose**: `container` CLI 没有 `compose` 子命令, 须直接使用 `container run` 启动单个容器。
2. **路径须使用绝对路径**: `-v` / `--mount` 绑定宿主机路径时需使用 `"$PWD/..."` 等绝对路径; 容器内目标路径也必须为绝对路径。
3. **非 root 权限与 VirtioFS / 具名卷差异**:
   - `verdaccio/verdaccio:6.10.1` 容器进程默认以非 root 用户 (`UID 10001 / GID 65533`) 运行;
   - macOS VirtioFS 绑定挂载不会把宿主机用户 (如 `UID 501`) 自动翻译为容器内的 `10001`;
   - 通过 `container volume create` 新建的具名卷 (ext4 文件系统) 初始属主固定为 `0:0` (`root:root`), 不会像 Docker 那样自动复制镜像内目录的已有属主。

## 推荐启动步骤

### 1. 调整 `htpasswd` 路径避开只读/属主冲突

推荐在 `knuth.config.ts` 中将 `auth.htpasswdFile` 显式指向可写存储卷内的路径, 再生成配置:

```ts
auth: {
  htpasswdFile: '/verdaccio/storage/htpasswd',
}
```

然后执行初始化:

```shell
npm run init
# 或快速体验先执行: npm run init -- --example
```

> 若未修改 `htpasswdFile` 而使用默认的 `./htpasswd` (`/verdaccio/conf/htpasswd`), 需确保宿主机 `./conf` 目录对容器内 `10001` 具备写权限; 将 `htpasswd` 放入可写存储卷是最稳妥的隔离方式。

### 2. 启动系统后台服务

```shell
container system start

# 验证系统服务状态
container system status
```

### 3. 创建具名存储卷并初始化 `10001:65533` 属主

使用官方镜像自身 (`--uid 0 --entrypoint sh`) 完成一次性目录权限初始化, 无需额外拉取其它基础镜像:

```shell
container volume create knuth-storage

container run --rm --uid 0 --entrypoint sh \
  -v knuth-storage:/mnt \
  verdaccio/verdaccio:6.10.1 \
  -c 'mkdir -p /mnt/data && chown -R 10001:65533 /mnt'
```

### 4. 启动 Knuth (Verdaccio) 容器

可直接运行 `npm run init -- --commands` 打印与当前配置一致的命令, 或执行以下示例:

```shell
container run -d \
  --name knuth-verdaccio \
  -p 5673:5673 \
  -e VERDACCIO_PORT=5673 \
  -e VERDACCIO_PUBLIC_URL=http://localhost:5673 \
  -v "$PWD/conf/config.yaml:/verdaccio/conf/config.yaml:ro" \
  -v knuth-storage:/verdaccio/storage \
  verdaccio/verdaccio:6.10.1
```

## 常用运维命令

```shell
# 查看运行中的容器
container list

# 查看日志
container logs knuth-verdaccio

# 停止与清理容器 (存储卷 knuth-storage 会保留)
container stop knuth-verdaccio
container delete knuth-verdaccio
```

## 镜像构建差异

`container build` 在独立 BuildKit 虚拟机中运行, 若自建镜像遇内存或 CPU 不足需先扩容 builder VM, 且镜像库与 Docker/Podman 不共享。详情请参阅 [跨平台镜像构建与架构差异](./build-and-platforms.md)。
