---
title: 环境搭建与编译流程
order: 1
tags: 工具链, gcc, 入门
summary: 从源码到可执行文件的四阶段：预处理、编译、汇编、链接，gcc 常用参数一次讲清。
---

C 是编译型语言：源码必须先翻译成机器码才能运行。理解「源码 → 可执行文件」中间发生了什么，是排查一切编译错误的前提——报错出现在**<span style="color:#2d990f">哪个阶段，决定了你该去改什么。</span>**

## 四个阶段

gcc 把翻译拆成四步，每一步的输入输出都不一样：

| 阶段  | 做什么                          | 输入   | 输出    |
| --- | ---------------------------- | ---- | ----- |
| 预处理 | 展开 `#include`、`#define`，删掉注释 | `.c` | `.i`  |
| 编译  | 语法检查、优化，翻译成汇编                | `.i` | `.s`  |
| 汇编  | 汇编代码转机器码                     | `.s` | `.o`  |
| 链接  | 合并目标文件与库，填上函数的真实地址           | `.o` | 可执行文件 |

gcc 一条命令就能跑完全程，也可以用参数停在任意一步——排查问题时，这个能力极其有用。

## 环境与最小示例

Linux / macOS 一般自带或一行装好（macOS 的 `gcc` 实际是 clang 的别名，命令行用法通用）；Windows 推荐 MSYS2 或 WSL：

```bash
# Debian / Ubuntu
sudo apt install build-essential

# MSYS2（Windows）：安装后在 MSYS2 shell 里执行
pacman -S mingw-w64-ucrt-x86_64-gcc

# 验证安装
gcc --version
```

经典的第一个程序：

```c
#include <stdio.h>   // 预处理阶段会把 stdio.h 的内容原样贴进来

int main(void) {
    printf("hello, gcc\n");
    return 0;
}
```

```bash
gcc hello.c -o hello   # 预处理 + 编译 + 汇编 + 链接，一步到位
./hello                # 输出：hello, gcc
```

不带 `-o` 时，Linux 下默认生成 `a.out` 这种毫无辨识度的名字，所以 `-o` 请当成习惯。

## 把四阶段拆开跑

```bash
gcc -E hello.c -o hello.i   # 只做预处理：头文件已展开，注释消失
gcc -S hello.i -o hello.s   # 编译成汇编，能直接看到机器层面的指令
gcc -c hello.s -o hello.o   # 汇编成目标文件（二进制，还不能运行）
gcc hello.o -o hello        # 链接：补上 printf 的实际实现
```

报错时先判断它属于哪个阶段：

- 头文件找不到、宏写错 → 预处理阶段
- 语法错误、类型不匹配 → 编译阶段
- `undefined reference to 'xxx'` → 链接阶段：声明了函数但没提供实现

> [!NOTE]
> `undefined reference` 是链接器的错，`implicit declaration` 是编译器的错。前者查「有没有链接到实现」，后者查「用之前有没有声明」。两类错误查的方向完全不同。

## 常用参数速查

| 参数              | 作用                         |
| --------------- | -------------------------- |
| `-o name`       | 指定输出文件名                    |
| `-c`            | 只编译不链接，生成 `.o`             |
| `-E` / `-S`     | 只预处理 / 只编译到汇编              |
| `-Wall -Wextra` | 打开大部分警告（永远都开）              |
| `-g`            | 生成调试信息，gdb / valgrind 都需要  |
| `-O0` / `-O2`   | 不优化 / 常规优化（调试用 O0）         |
| `-std=c17`      | 指定语言标准（c99 / c11 / c17）    |
| `-I dir`        | 增加头文件搜索目录                  |
| `-L dir`        | 增加库搜索目录                    |
| `-lname`        | 链接 libname 库，如 `-lm` 链接数学库 |

接近实际的开发组合：

```bash
gcc -std=c17 -Wall -Wextra -g main.c -o main
```

> [!TIP]
> 记不住就记一条：**`-Wall -Wextra -g` 当默认配置用**。C 不像 Rust 会把问题拦在编译期，警告是你能白拿的检查——每条警告都可能是编译器替你提前找到的 bug。

## 多文件编译

真实项目由多个 `.c` 组成，靠头文件共享声明（机制见[函数与作用域](07-functions-scope.md)）。编译时先各自生成目标文件，最后统一链接：

```bash
gcc -c main.c     # 生成 main.o
gcc -c utils.c    # 生成 utils.o
gcc main.o utils.o -o app
```

只改一个文件时，重新编译那一个再重链即可——make 工具自动化的正是这个流程。演示阶段也可以一条命令搞定：

```bash
gcc -Wall -Wextra -g main.c utils.c -o app
```

## 练习

- [ ] 用 `-E` 展开 `hello.c`，数一数 `#include <stdio.h>` 引入了多少行（`wc -l hello.i`）
- [ ] 故意调用一个不存在的函数 `foo()`，对比「编译阶段」和「链接阶段」分别报什么错
- [ ] 写两个 `.c` 文件互相调用，体验一次完整的分步编译 + 链接

相关阅读：[基本类型与变量](02-types-variables.md)
