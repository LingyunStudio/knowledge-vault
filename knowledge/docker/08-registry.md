---
title: 发布链：registry、tag 策略与 CI
order: 8
tags: registry, tag, CI, buildx, 供应链
summary: 从「本地构建」到「CI 构建推送」的发布链全流程、registry 的选择与认证、tag 策略的设计（语义版本/git SHA/latest 陷阱）、buildx 多架构构建、以及镜像扫描与 digest 钉住的供应链纪律。
---

容器的交付终点是：**CI 构建镜像 → 推送 registry → 生产拉取部署**。这条链的每一环都有设计决策：tag 怎么命名（可追溯性）、构建在哪做（一致性）、镜像扫不扫（供应链安全）。本篇把「一个镜像从代码到生产」的完整路径走通。

## 1. 发布链全景

```text
代码 push → CI 构建（docker build）→ 测试 → tag（版本）→ push registry → 生产 pull 部署
                ↑                                        ↓
            Dockerfile（[第 4 篇](04-dockerfile.md)）         生产环境只认 registry 的镜像
```

「构建发生在 CI 而不是生产服务器」的理由：**一致性**（同样的代码永远产出同样的镜像）、**可追溯**（镜像与代码 commit 绑定）、**生产最小化**（生产机不需要构建工具链与源码）——这是不可变基础设施的执行环节。

## 2. registry 的选择与认证

| registry               | 定位                  | 特点                                    |
| ---------------------- | --------------------- | --------------------------------------- |
| Docker Hub             | 公共默认               | 官方镜像多；拉取限速（匿名 100/6h）        |
| GHCR（ghcr.io）        | GitHub 生态           | 与 repo 权限联动、私有包额度               |
| 云厂商（ECR/ACR/GAR）  | 生产正解              | 与 IAM/网络/扫描集成、内网拉取快           |
| Harbor（自建）         | 企业私有              | 完整功能：扫描/签名/审计/复制              |

```bash
echo $TOKEN | docker login ghcr.io -u USER --password-stdin   # 密码不走命令行历史！
docker push ghcr.io/org/app:1.2.0
```

认证纪律：**凭据用 stdin 或凭据管理器**（`--password` 会进 shell 历史与 ps）；CI 里用平台原生 secret 机制（GitHub Actions 的 `secrets.*`），绝不硬编码（[第 4 篇](04-dockerfile.md)的秘密注入模型）。

## 3. tag 策略：每个 tag 要能回答「这是什么」

```bash
docker tag myapp:ci-123 myapp:1.2.0        # 语义版本（人工发布）
docker tag myapp:ci-123 myapp:1.2          # 大.中（自动跟随补丁）
docker tag myapp:ci-123 myapp:latest       # ⚠️ 谨慎：只作为「最新稳定」的移动指针
```

生产 tag 的成熟设计（多 tag 并推）：

```text
myapp:1.2.3          完整语义版本 —— 生产部署引用它
myapp:1.2            次版本指针 —— 想自动收补丁的环境
myapp:main-a1b2c3d   分支+commit —— ★ 可追溯到代码（CI 自动打）
myapp:latest         最新发布 —— 仅本地开发/文档示例
```

**git SHA 进 tag** 是可追溯性的关键：看到生产跑的 `main-a1b2c3d`，一条 `git checkout a1b2c3d` 回到构建现场——镜像与代码的因果链闭合。策略纪律：**生产引用精确版本或 digest（[第 3 篇](03-images.md)），latest 只做本地便利**。

## 4. 多架构构建：buildx

```bash
docker buildx create --use          # 创建多架构 builder（一次配置）
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/org/app:1.2.0 --push .  # 一次构建、双架构、直接推送
```

buildx 把多平台构建合入一条命令（交叉编译或 qemu 模拟）——「CI 在 x86 上产出 arm64 可用镜像」覆盖 Apple Silicon 开发者与 ARM 服务器的现实。注意模拟构建的性能代价（编译型语言慢数倍）——原生 runner 构建对应架构或使用交叉编译（Go/Rust 的 GOARCH/target 参数）是提速正道。

## 5. CI 流水线：GitHub Actions 实例

```yaml
name: build
on:
  push:
    branches: [main]
jobs:
  build-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write          # 允许推 GHCR
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}      # 平台原生凭据
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:1.2.0
            ghcr.io/${{ github.repository }}:main-${{ github.sha }}
          cache-from: type=gha        # ★ CI 构建缓存（层缓存跨 run 复用）
          cache-to: type=gha,mode=max
```

这条流水线的骨架是通用的（GitLab CI/Jenkins 同构）：**checkout → login → build-push（带缓存）**。build-push-action 内置了 [第 3 篇](03-images.md)的层缓存机制对接——「CI 构建不慢」的关键就是缓存配置。测试步骤应插在 build 之前或同层（镜像里跑测试：多阶段构建的 test 目标，[第 9 篇](09-dockerfile-best.md)）。

## 6. 供应链安全：扫描、钉住、签名

```bash
# 镜像漏洞扫描（CI 的标准步骤）
trivy image ghcr.io/org/app:1.2.0          # CVE 清单按严重度排序
# --exit-code 1 --severity HIGH,CRITICAL   高危即失败：准入门槛

# 生产钉 digest（[第 3 篇](03-images.md)）
docker pull ghcr.io/org/app@sha256:abc...   # 内容即验证
```

供应链三件套的定位：

1. **扫描（trivy/grype）**：基础镜像与依赖的已知漏洞——CI 准入门槛（高危阻断）。
2. **digest 钉住**：部署清单引用不可变指纹——防「tag 被覆盖投毒」。
3. **签名（cosign）**：证明镜像出自你的 CI——防仓库劫持后的假镜像。（进阶：sigstore 生态）

这三件是「软件供应链」议题在容器层的最小实现——依赖的依赖（基础镜像）同样要扫描与钉住（FROM 的 digest 也该钉）。

## 7. 部署端：拉取与滚动

```bash
# 生产的部署单元（compose 形态）
docker compose pull && docker compose up -d    # 拉新镜像 + 重建变更容器
# 蓝绿/滚动的进阶由编排系统接管（K8s rollout）——compose 手动做：
# 起新容器（不同端口）→ 验证 → 切流量 → 停旧容器
```

回滚 = 部署旧 tag（`docker compose` 改镜像版本 up -d）——**回滚的速度与确定性取决于 tag 策略**（这就是第 3 节多 tag 并推的原因：旧版本镜像还在 registry 里，改个引用就回去了）。

## 8. 陷阱清单

- CI 凭据硬编码或 --password 明文：平台 secret + stdin。
- 只有 latest 一个 tag：回滚无据、环境漂移；多 tag 并推（版本+SHA）。
- 构建在部署服务器上做：环境漂移回来 + 生产机器负担；构建进 CI。
- 不扫镜像直接上生产：CVE 带病上线；trivy 进 CI 门槛。
- FROM 用浮动 tag：基础镜像投毒/漂移；基础镜像也钉版本或 digest。
- 多架构构建在模拟里跑重型编译：数倍慢；交叉编译或原生 runner。
- 忘记 CI 缓存配置：每次构建 20 分钟起步；cache-from/to 配置。

## 9. 小结

- 发布链：CI 构建 → 多 tag 并推（版本 + git SHA）→ registry → 生产 pull——「构建进 CI、生产只认 registry」是不可变基础设施的执行。
- tag 是可追溯性的载体：语义版本给发布语义、git SHA 给代码因果、digest 给内容指纹——三层钉住各有用途。
- registry 按信任域选择：公共实验用 Hub、生产正解云厂商/Harbor；凭据走平台 secret。
- buildx 多架构覆盖 Apple Silicon/ARM 服务器的现实；模拟构建的性能要交叉编译来救。
- 供应链最小三件套：扫描准入（trivy）、digest 钉住、签名（cosign）——基础镜像同样纳入。
- 回滚速度由 tag 策略决定：旧版本镜像留存 + 引用切换 = 秒级回滚。

## 10. 练习

**1.** 搭建完整发布链：本地写 Dockerfile → GitHub Actions（或手动模拟）构建 → 推 GHCR/本地 registry → 另一环境 pull 部署。记录全链每步的产物（镜像 tag/digest 与代码 commit 的对应表）。

> [!TIP]
> 思路对应表就是「审计链」的最小实现：commit a1b2c3 → image 1.2.0 (sha256:abc…) → 部署时间。生产事故的第一问「线上跑的什么版本」从此有答案。

**2.** 实施「多 tag 并推」策略并演练回滚：推 1.2.0/1.2/latest 三 tag，发布 1.3.0，然后回滚到 1.2.0——验证回滚只改引用不重构建，并记录耗时。

> [!TIP]
> 思路回滚耗时应在秒级（pull 旧镜像 + up -d）——「回滚是引用切换」的体感。若你的回滚需要重新构建，tag 策略就有问题。

**3.** 配置 CI 构建缓存：第一次构建记录耗时，加 cache-from/to 后改一行代码重构建——对比分层命中情况（build 输出的 CACHED 行）。

> [!TIP]
> 思路预期：依赖层 CACHED、只有源码层重建——CI 构建从分钟级降到秒级。缓存失效排查也依赖对「层指纹」的理解（[第 3 篇](03-images.md)）。

**4.** 用 trivy 扫描三个镜像（你自己的、一个官方基础镜像、一个陈旧的），按严重度整理结果；在 Dockerfile 里升级基础镜像重新扫描对比——体验「基础镜像管理是供应链的输入端」。

> [!TIP]
> 思路典型发现：基础镜像的 CVE 占大头（你的代码反而干净）——「FROM 什么」是安全决策。自动更新基础镜像（ Dependabot/renovate）是工程化的解。

**5.** 用 buildx 构建一个双架构镜像（含一个 C 扩展的语言项目体验交叉编译的麻烦），在 x86 与 ARM（或模拟）上分别运行验证——写下你遇到的多架构坑。

> [!TIP]
> 思路坑的清单：模拟慢、原生依赖（如 some lib 只装了 amd64）、架构相关的字节序/路径。Go/Rust 交叉编译快而 C/Python C 扩展麻烦——语言生态的多架构友好度差异。

**6.** 讨论：把「镜像签名与 digest 钉住」推广到整个依赖链（基础镜像、CI 构建器、部署清单）意味着什么工程成本？对照 [npm/pip 的锁定文件](../python/08-modules-packages.md)，分析「语言包锁 vs 容器镜像锁」的成熟度差异与原因。

> [!TIP]
> 思路语言包锁（lock 文件）成熟于「纯文本 diff、工具原生支持」；镜像锁（digest/签名）需要额外工具链与流程。供应链安全的成本曲线都在下降——「从最痛的环节开始补」（通常是基础镜像钉版本）是务实的路线图。
