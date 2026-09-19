---
title: 函数与作用域：词法、闭包与错误
order: 7
tags: 函数, 词法作用域, 闭包, lazy evaluation, tryCatch
summary: 函数定义与惰性求值（默认参数在调用时才算）、返回值约定、R 的词法作用域与闭包、... 传参与 do.call、stop/tryCatch 的错误处理三件套，以及函数化分析代码的工程路线。
---

R 的函数是一等对象（可赋值、传参、返回），作用域是**词法的**（函数在定义处找变量）——这两条加上惰性求值，构成 R 函数的全部底层机制。它们与[Python 篇](../python/04-functions.md)、[MATLAB 篇](../matlab/05-functions.md)的对应概念同构，差异点在于细节方向。

## 1. 函数的基本形与返回

```r
fit_summary <- function(data, var, na.rm = TRUE) {
    v <- data[[var]]
    out <- list(
        n    = sum(!is.na(v)),
        mean = mean(v, na.rm = na.rm),
        sd   = sd(v, na.rm = na.rm)
    )
    out                       # ★ 最后一个表达式即返回值（return(out) 亦可，惯例用于早退）
}

fit_summary(mtcars, "mpg")$mean
```

三条惯例：**最后一个表达式的值是返回值**（`return()` 只在早退时用）；**参数名清晰 + 默认值表意**（`na.rm = TRUE` 这类动词式默认）；**函数体尽量短**（一屏以内，超过就拆）。

### 1.1 惰性求值：默认参数在「用到时」才算

```r
f <- function(x = rnorm(1), y = x * 2) {
    list(x = x, y = y)
}
f()$x; f()$y          # 每次 y 都「现算」x*2 —— 默认值可以引用前面的参数

set_seed <- function(n = sample(1e6, 1)) {
    if (missing(n)) message("使用随机种子")    # missing()：判断是否真的传了
    set.seed(n)
}
```

R 的参数是**惰性**的：默认表达式在**首次使用时**求值（不是调用时）——因此可以有「引用前面参数的默认值」「用 missing() 区分没传与传了 NULL」。与 Python 的「定义时求值默认」（[python 篇](../python/04-functions.md)可变默认陷阱）方向相反：**R 的惰性让可变默认无害，但让「参数什么时候算」需要留心**。

## 2. 词法作用域与闭包

```r
k <- 10
adder <- function(x) x + k        # 函数体里的 k 在「定义处」的环境找

make_adder <- function(k) {       # 闭包工厂：捕获 make_adder 的 k
    function(x) x + k
}
add5 <- make_adder(5)
add5(3)                           # 8 —— 闭包记住了 k=5
k <- 100
add5(3)                           # 仍是 8：捕获的是「定义时的环境」，不是全局的 k
```

R 的查找链是「函数内 → **定义时所在的环境** → 全局」（词法作用域，与 Python 同向）。闭包捕获的是**环境的引用**——`<<-` 可以从内层函数修改闭包变量（可变闭包状态，计数器的 R 形态）：

```r
make_counter <- function() {
    n <- 0
    function() { n <<- n + 1; n }     # <<= 向外层环境赋值
}
c1 <- make_counter(); c1(); c1()      # 1, 2 —— 状态活在闭包环境里
```

`<<-` 的定位与 [Python 的 nonlocal](../python/04-functions.md) 相同：**有正当用例（闭包状态），但每个用例都要过「重入/测试/并发」三问**。

## 3. ... 传参与 do.call

```r
my_plot <- function(df, x, y, ...) {      # ... 收集剩余参数
    plot(df[[x]], df[[y]], ...)           # 原样转给 plot（col/pch/main...）
}
my_plot(mtcars, "wt", "mpg", col = "red", main = "Miles vs Weight")

do.call(rbind, list_of_dfs)               # ★ 把 list 展开成位置参数调用
do.call(max, as.list(c(3, 1, 4)))         # max(3, 1, 4)
```

`...` 是 R 接口设计的透传通道（包装函数把美学参数转给 ggplot、把统计参数转给 lm）；`do.call` 是「参数在 list 里」时的调用形态（与 [python 的 *args 解包](../python/04-functions.md)对应）——rbind 多个表、pmap 类操作的底层机制。

## 4. 错误处理：stop / warning / tryCatch

```r
process <- function(path) {
    if (!file.exists(path))
        stop("文件不存在: ", path, call. = FALSE)     # error：终止（调用方 tryCatch 可接）

    result <- tryCatch(
        {
            heavy_load(path)
        },
        error = function(e) {                          # 错误 → 返回替代值
            warning("加载失败，返回空结果: ", conditionMessage(e))
            NULL
        },
        finally = close_connections()                  # 无论如何执行（[第 9 篇 with 的对应物]）
    )
    result
}

res <- tryCatch(parse_file(f), error = function(e) NA)   # 批处理中的容错形态
```

三件套的分工：**stop 抛错（代码问题/契约违反）、warning 提示（结果可能不对但流程可继续）、message 进度信息**；tryCatch 的处理器按条件类型（error/warning/message/自定义 condition）分派。R 的条件系统支持自定义 condition 类（`customError` 类似异常类型）——但工程惯例通常停留在 error/warning 两层 + identifier 字符串判断。

## 5. 函数化分析代码：工程路线

从脚本到函数的迁移（与 [MATLAB 重构路线](../matlab/11-pitfalls.md)、[python 测试](../python/12-quality.md)同构）：

```text
1. 数据加载函数  load_clean(path)     —— IO 与清洗隔离
2. 核心计算函数  compute(df, params)  —— 纯函数（无 IO、无全局）
3. 可视化函数    make_plot(df)        —— 只画不改
4. 编排脚本      main.R               —— 参数 → 调用 → 保存
```

纯函数（同输入同输出、无副作用）是**可测试**的：`testthat` 的期望值断言直接可用（[第 11 篇](11-projects-reports.md)）。R 特有的纪律是**把「交互探索的产物」及时函数化**——历史里那 20 段相似代码是函数边界的天然草案。

## 6. 陷阱清单

- 依赖全局变量的函数：词法作用域让它「能跑」，但不可测试不可复用；状态一律显式参数。
- `<<-` 滥用当全局赋值：它找的是「最近的定义环境」不是全局——用例限定在闭包状态。
- 惰性求值的时间点误解：默认参数里的 `Sys.time()`/随机数在「首次使用时」才求值——需要「调用时刻」语义就显式传入。
- tryCatch 只包 error 不放 finally：资源清理丢失（连接/文件句柄）。
- stop 的消息不带上下文（没说哪个参数/值）：错误信息带 `sprintf("%s=%s", ...)` 现场。
- ... 透传时目标函数的参数名冲突（两个下游都要 col）：显式拆分参数而不是全透传。
- sapply 的输出形态随输入漂移：vapply/map 系声明类型（[第 3 篇](03-subsetting.md)）。

## 7. 小结

- 函数三机制：一等对象、词法作用域、惰性求值——默认参数可引用前参、missing() 区分未传、闭包捕获定义环境（与 Python 惰性绑定/值捕获的差异要分清）。
- `<<-` 是闭包状态的合法通道（三问纪律）；`...` 是透传接口、do.call 是 list 展开调用。
- 错误三件套 stop/warning/message + tryCatch(error/finally)——批处理容错与资源清理的完整形态。
- 分析代码函数化的分层：IO/计算/绘图/编排四分离，纯函数是可测试性的入场券。
- 与 python/matlab 的对照学习价值：机制同构（闭包、透传、错误分级），差异在求值时机与作用域细节——跨语言的「翻译检查表」思维。

## 8. 练习

**1.** 验证惰性求值：写一个默认参数带 `Sys.time()` 的函数，连续调用两次对比时间戳；再写一个「默认值引用前参」的函数。总结「参数什么时候算」。

> [!TIP]
> 思路两次调用时间戳不同（每次用到才求值）；若预求值则会相同。对照 [Python 的定义时求值](../python/04-functions.md)：方向相反的两种「陷阱与特性」。

**2.** 写闭包计数器与「多实例独立」验证：两个 counter 实例各自计数互不干扰；再用环境查看器（pryr::where 或 str(environment(f))）看闭包状态存哪了。

> [!TIP]
> 思路闭包状态活在函数的环境对象里——每个 make 返回值带独立环境。这是 R 里「轻量对象」的形态（R6 类的雏形思想）。

**3.** 把一段「读文件→清洗→建模→出图」的 80 行脚本按第 5 节四层重构；为 compute 函数写 3 个 testthat 断言（正常/空数据/缺失列），跑通。

> [!TIP]
> 思路重构的检验就是测试能否独立于 IO 运行——compute 接受 data.frame 而不是文件路径。「测试友好」是纯函数设计的直接收益。

**4.** 写一个「容错批处理」：对文件夹里每个 CSV 调用 process，单个失败不中断（tryCatch 收集错误信息到结果表），最终报告「成功 N 失败 M 及原因」。

> [!TIP]
> 思路`results <- lapply(files, safe_process)` + `purrr::safely` 的现成形态（返回 list(result, error)）。批处理的容错结构与 [python future 的异常通道](../python/11-standard-library.md)是同构思想。

**5.** 设计一个带 ... 的绘图包装函数：固定主题与尺寸、透传几何参数；故意透传一个与主题冲突的参数（theme 覆盖顺序）观察行为，总结 ... 接口的文档义务。

> [!TIP]
> 思路... 的透传顺序决定覆盖关系（后面的赢）——接口文档必须写明「哪些参数透传、与内部设置谁优先」。透传的便利与「参数契约模糊」是同一枚硬币。

**6.** 讨论：R 的 stop/warning 两级（无强制异常层次树）与 [python 的异常类树](../python/09-errors-exceptions.md)、[C++ 的 expected/异常](../cpp/11-errors-exceptions.md)相比，工程上够用吗？从「按类型捕获」「错误信息结构化」两个需求出发，给出 R 社区惯用的补偿方案（自定义 condition/rlang::abort）。

> [!TIP]
> 思路补偿方案：rlang::abort(class = "myapp_error_missing") 的条件类 + tryCatch 按类捕获——把类型语义补回条件系统。「语言给最低配，生态补上层建筑」是 R（也是多数动态语言）的工程现实。
