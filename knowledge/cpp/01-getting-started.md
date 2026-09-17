---
title: 环境搭建与第一个程序
order: 1
tags: 工具链, g++, 入门
summary: g++/CMake 最小起步、头文件与命名空间、从 C 到 C++ 的第一个差异。
---

写过 C 的话，C++ 的工具链几乎是白送的：同一套编译流程，`gcc` 换成 `g++` 而已。真正的新东西是标准库的体量（STL）、语言特性的深度（模板、异常），以及「编译期就能做很多事」的心智。本篇把环境、构建、头文件组织一次说清，之后的篇幅不再碰工具问题。

## 从 g++ 开始

```cpp
// hello.cpp
#include <iostream>

int main() {
    std::cout << "hello, cpp\n";   // << 是流插入运算符，可以链式调用
    return 0;
}
```

编译与运行：

```bash
g++ -std=c++17 -Wall -Wextra -g hello.cpp -o hello
./hello
```

和 C 编译的三个关键差异：

- 用 `g++` 而不是 `gcc`：g++ 会自动链接 C++ 标准库 `libstdc++`；用 gcc 链 C++ 程序会得到一屏 `undefined reference to std::...`
- `-std=c++17` 显式指定标准：不指定时老版本 g++ 可能默认 `gnu++14` 甚至 `gnu++98`，现代写法直接编译失败
- `-Wall -Wextra` 从第一天就开：C++ 的警告往往预告真实 bug，见[常见陷阱与工具](12-common-pitfalls.md)

> [!TIP]
> 把这串旗标养成肌肉记忆：`-std=c++17 -Wall -Wextra -g`，调试加 `-g`，发布再加 `-O2`。在学会智能指针之前，先用 `-fsanitize=address` 抓内存错误，收益极大。

## 编译与链接：还是那两步

C++ 沿用 C 的翻译模型，多文件程序先各自编译再链接：

```bash
g++ -std=c++17 -c logger.cpp    # 产出 logger.o
g++ -std=c++17 -c main.cpp      # 产出 main.o
g++ logger.o main.o -o app      # 链接成可执行文件
```

链接错误的根源也和 C 一样：声明与定义对不上。C++ 多了一层名字修饰（name mangling）——函数签名被编码进符号名，所以 C 与 C++ 的目标文件混链时要用 `extern "C"` 关闭修饰。

## 头文件与源文件

声明放 `.h`、定义放 `.cpp` 的分工和 C 一致，但多了一条硬规则：**模板必须放头文件**（原因见[模板](05-templates.md)）。

```cpp
// logger.h
#ifndef LOGGER_H          // include guard：防止重复包含
#define LOGGER_H

#include <string>

void log_line(const std::string& msg);   // 声明，只承诺签名

#endif
```

```cpp
// logger.cpp
#include "logger.h"
#include <iostream>

void log_line(const std::string& msg) {  // 定义，有函数体
    std::cout << "[log] " << msg << '\n';
}
```

`#pragma once` 可以替代 include guard，主流编译器都支持，但严格说不是标准；工程里两者混用很常见。习惯上：头文件保持最小包含，能用前置声明（`class Foo;`）就不 `#include`，能明显缩短编译时间。

## 命名空间：给名字划地盘

C 用前缀模拟命名空间（`list_insert`、`strbuf_append`），C++ 有正式机制：

```cpp
namespace kb {
    struct Article { std::string title; };
    void publish(Article& a);
}

int main() {
    kb::Article a;            // 完整限定名
    using kb::Article;        // 引入单个名字，粒度最小
    Article b;
    kb::publish(b);
}
```

标准库的所有名字都在 `std` 里，所以代码里满是 `std::` 前缀。示例教程常写 `using namespace std;` 一劳永逸，但这条捷径只属于练习代码。

> [!WARNING]
> `using namespace std;` 写进头文件是工程红线。头文件会被别人包含，等于强行把整个 std 塞进对方的作用域，`count`、`data`、`swap` 这类常见名字会莫名其妙产生歧义。`.cpp` 里、函数内部用，无妨。

## 第一个真正的差异：string 与引用

用 C 的方式拼一句欢迎语：

```c
char buf[64];
snprintf(buf, sizeof buf, "hello, %s", name);   // 手动管缓冲区、算长度
```

C++ 的写法：

```cpp
std::string name = "cpp";
std::string full = "hello, " + name;            // 拼接、扩容、释放全自动
std::cout << full << '\n';
```

`std::string` 是第一个让你尝到 RAII 甜头的类型：内存随对象生灭，不碰 `malloc/free`。另一个语法差异是**引用**——函数出参不再需要传指针：

```cpp
void grow(std::string& s) { s += "!"; }     // 传引用，改的是本体
void show(const std::string& s);            // const 引用：只读，还免去拷贝
```

细节在[引用与类基础](02-references-classes.md)展开，这里先记住一条默认礼仪：**大对象传参用 `const T&`**。

## 用 CMake 组织项目

超过三个文件就该上 CMake，手敲 g++ 命令维护不动：

```cmake
# CMakeLists.txt
cmake_minimum_required(VERSION 3.10)
project(kb_demo CXX)

set(CMAKE_CXX_STANDARD 17)               # 等价于 -std=c++17
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-Wall -Wextra -g)

add_executable(hello main.cpp logger.cpp)
```

构建是 out-of-source 的，产物不污染源码目录：

```bash
cmake -B build            # 配置，生成构建系统
cmake --build build       # 编译
./build/hello
```

## 练习

- [ ] 写一个 `Article` 结构体放头文件（只声明），实现在 `.cpp`，用 CMake 编译通过
- [ ] 故意用 `gcc` 链接一个用了 `std::string` 的程序，观察链接错误长什么样
- [ ] 在头文件里写 `using namespace std;`，再定义一个叫 `count` 的全局变量，制造冲突

相关阅读：[引用与类基础](02-references-classes.md)
