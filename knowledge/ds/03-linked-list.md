---
title: 链表：用指针换搬迁，以及这笔交易的真实代价
order: 3
tags: 链表, 哨兵节点, 快慢指针, 指针操作, 内存管理
summary: 链表凭什么用节点级 O(1) 插删换来随机访存、分配开销与缓存灾难；从哨兵节点、静态链表到 Floyd 判环与内核侵入式链表，讲清它的账本与边界。
---

数组的每一项都靠「下标 × 元素大小」算地址，所以按下标访问是 O(1)，代价是插入删除要把后面的元素整体搬家。链表把这个因果关系反转过来——地址不再算得出来，改为前一个节点用指针告诉你后一个节点在哪里：插入删除只改几个指针，而按下标访问变成 O(n)。这不是「更好」或「更差」，而是同一笔预算的两种花法：用**可计算的地址**换**可任意改写的链接**。

链表真正难的不是正确性，而是性能：它把「元素在哪儿」的答案从 CPU 能预测的顺序访问，变成了一串必须逐个等待的随机访存。这篇要讲清三件事：指针操作的本质（改链顺序为什么关键）、链表工程化的第一课（哨兵节点）、以及链表在现代硬件与真实系统里到底输在哪、赢在哪。

## 1. 链表存在的理由与它的账单

### 1.1 三个卖点

**节点级 O(1) 插入删除。** 注意「节点级」的限定：前提是你已经拿到了那个节点的引用（或它的前驱）。若只知道下标、还要先走 n 步找位置，那就是 O(n)——链表从来没让「按下标插删」变快，它让「拿着节点引用插删」变成了常数时间。

**元素不搬迁。** 数组在中间插入一个元素要 memmove 一整条尾巴：元素是 1 KB 的结构体、数组有 10 万个元素时，一次插入就是约 100 MB 的拷贝。链表只改两个指针，元素本身一动不动。大对象、或者地址被外部持有的对象（对象注册表、观察者列表）在这里只能选链表。

**任意拼接与拆分。** 两条链表拼接不需要拷贝元素：拿到 A 的尾节点，让它指向 B 的头即可。归并排序的 merge 在数组上是 O(n)（要复制），在链表上是 O(1)。这是链表在算法层面唯一稳定赢过数组的地方。

### 1.2 三笔账单

| 代价      | 具体是什么                                             | 量级                |
| ------- | ------------------------------------------------- | ----------------- |
| 每节点一次分配 | 每个节点独立 malloc/new，还要带分配器元数据（glibc 每块至少 8\~16 字节头） | 16 字节的节点常实占 32 字节 |
| 指针开销    | 单链表 1 个指针、双链表 2 个，都是 8 字节；元素本身可能只有 4 字节           | 密度比数组低 2\~8 倍     |
| 随机访存    | 每次取 next 都要等上一次加载完成，形成依赖加载链；缓存行利用率极低              | 见第 7 节实测          |

### 1.3 心智模型：链表是一份「地址的承诺」

> [!IMPORTANT]
> 链表的正确性全建立在一个不变式上：**从 head 出发，沿 next 恰好走完每一个节点一次，然后到达终点（NULL 或哨兵）**。插入、删除、反转、拼接都只是在这个不变式下重排指针。调试链表 bug 时唯一有效的问题永远是：「哪一条链断了，或者哪两条链变成了环？」

这条不变式解释了两个看起来奇怪的工程习惯：为什么改指针之前总要先保存下一个节点（否则断链后失去唯一的访问路径），以及为什么哨兵节点值钱（它让空表和非空表共享同一个不变式形状）。

## 2. 分类与各自的适用面

### 2.1 四类基本形态

| 形态   | 结构           | 得到什么                    | 付出什么              | 典型用途          |
| ---- | ------------ | ----------------------- | ----------------- | ------------- |
| 单链表  | 每个节点一个 next  | 最简单、指针开销最小              | 不能反向走、删除要前驱       | 栈、哈希桶、一次性前向处理 |
| 双链表  | prev + next  | 删除只需节点自身（不必找前驱）、可反向遍历   | 多一个指针，每次增删要同步改两条链 | LRU 缓存、内核队列   |
| 循环链表 | 尾节点 next 指回头 | 从任一节点都能绕一圈、天然没有 NULL 判断 | 必须有终止条件，忘了就是死循环   | 轮转调度、环形缓冲     |
| 带头哨兵 | 多一个不存数据的头节点  | 空表与首节点特例消失（第 4 节）       | 一个节点的内存 + 一条要守的约定 | 一切要工程化的实现     |

**双链表的最大价值不是「能反向遍历」，而是「删除只需要节点自己」。** 单链表删除一个节点必须知道它的前驱；一旦外部只持有节点引用（缓存、任务队列、订阅关系），单链表就只剩下 O(n) 的删除。多出来的 prev 指针买的就是这个。

选型口诀：需要删除且持有节点引用 → 双链表；只在两端进出 → 带哨兵的（循环）双链表，一次插入同时维护两条链；要遍历到末尾再回头 → 循环链表或双链表；要工程化、代码要短要稳 → 一律加哨兵；没有堆或者要序列化 → 静态链表。

### 2.2 静态链表：用数组模拟指针

没有堆的环境（MCU、内核早期启动、禁用动态分配的安全关键系统）照样能做链表：把「指针」换成**数组下标**，`next[i]` 存下一个节点的下标，`-1` 表示空。

```text
data  : [ 10 | 20 | 30 | -  | 40 | -  | -  | -  ]
next  : [  1 |  2 | -1 | 4  | -1 |  - |  5 | 6  ]      head = 0
索引     0    1    2    3    4    5    6    7

数据链：head=0 → 10 → 20 → 30 → 空        （槽 3 已归还，槽 4 已被占用）
空闲链：free_head=3 → 5 → 6 → 7 → 空
```

删除一个节点时，它不是「被 free」，而是把它的下标**头插进空闲链**——所以每个槽永远只有三种身份之一：在数据链上、在空闲链上、或正被分配出去。

```c
/* 静态链表：用下标代替指针，整个结构是一块可以 memcpy / 放进 ROM 的连续内存 */
#include <stdio.h>

#define CAP 8
#define NIL (-1)

typedef struct {
    int value[CAP];
    int next[CAP];      /* 后继的「下标」；NIL 表示没有后继 */
    int head;           /* 头「指针」也是个下标 */
    int free_head;      /* 空闲链的链头：被删除的槽串在这里 */
    int size;
} StaticList;

static void sl_init(StaticList *l) {
    l->head = NIL;
    l->size = 0;
    l->free_head = 0;                         /* 空闲链：0 → 1 → … → CAP-1 */
    for (int i = 0; i < CAP - 1; i++) l->next[i] = i + 1;
    l->next[CAP - 1] = NIL;
}

static int sl_alloc(StaticList *l) {          /* 从空闲链取一个槽：O(1) */
    int i = l->free_head;
    if (i == NIL) return NIL;                 /* 满了，没有堆可以借 */
    l->free_head = l->next[i];
    return i;
}

static void sl_release(StaticList *l, int i) {    /* 归还槽位：头插回空闲链，O(1) */
    l->next[i] = l->free_head;
    l->free_head = i;
}

static int sl_push_front(StaticList *l, int v) {  /* 头部插入：O(1) */
    int i = sl_alloc(l);
    if (i == NIL) return -1;
    l->value[i] = v;
    l->next[i] = l->head;                     /* 先接后继 */
    l->head = i;                              /* 再改链头 */
    l->size++;
    return 0;
}

static int sl_pop_front(StaticList *l, int *out) {   /* 头部删除：O(1) */
    int i = l->head;
    if (i == NIL) return -1;
    *out = l->value[i];
    l->head = l->next[i];
    sl_release(l, i);
    l->size--;
    return 0;
}

static void sl_dump(const StaticList *l) {    /* 遍历：起点是 head，终点是 NIL */
    for (int i = l->head; i != NIL; i = l->next[i]) printf("%d ", l->value[i]);
    printf("| size=%d\n", l->size);
}

int main(void) {
    StaticList l;
    sl_init(&l);
    for (int i = 1; i <= 4; i++) sl_push_front(&l, i * 10);
    sl_dump(&l);                              /* 40 30 20 10 | size=4 */
    int v = 0;
    sl_pop_front(&l, &v);                     /* 40 出链，槽 0 回到空闲链 */
    printf("pop = %d\n", v);
    for (int i = 0; i < 5; i++)               /* 复用刚归还的槽，把表填满 */
        if (sl_push_front(&l, 100 + i) != 0) { printf("插入失败\n"); return 1; }
    sl_dump(&l);                              /* 104 103 102 101 100 30 20 10 | size=8 */
    if (sl_push_front(&l, 999) != -1) { printf("应该插入失败\n"); return 1; }
    printf("容量是硬上限：第 9 个元素插不进去，程序自己知道\n");
    return 0;
}
```

为什么无堆环境必须用它：

- **没有 malloc 就没有不确定的延迟**。分配器的耗时取决于碎片状况，实时系统不能接受；静态链表的所有操作都是固定几条指令。
- **容量可预算、可静态验证**。数组大小编译期确定，没有内存耗尽崩溃，只有「表满」这个明确的业务错误。
- **可以放进 ROM、直接序列化**。整个结构是一块连续内存，`memcpy` 或 `fwrite` 就是完整快照；用指针的链表做不到（地址是进程私有的）。
- **下标的宽度自己定**。`uint16_t` 下标索引 65536 个节点只占 2 字节，指针在 64 位机器上恒占 8 字节。

代价同样明确：容量固定（超出只能报错或覆盖）、多一份空闲链维护代码、不能像指针那样让多种类型共用一段节点代码。文件系统的 FAT 表、分配器的空闲链、竞赛里的「链式前向星」都是它的变体。

> [!NOTE]
> 静态链表是「索引化」思想的原型。图算法用 `vector<Node>` + 整数下标代替指针（省内存、可序列化、缓存更友好），Rust 里推荐用 `Vec<Node>` + `u32` 索引而不是 `Box` 链表（见第 9 节）——它们都是静态链表的精神后代。

## 3. 指针操作的本质：改链顺序

### 3.1 插入：必须「先接后断」

```text
目标：把新节点 N 插到 prev 与它的后继 B 之间
插入前：  prev ──► B ──► C ──► …            N（还没进链）

正确顺序（先接后断）
  ① N.next = prev.next  →  N 先认住 B          prev ──► B ──► C
                                                   ▲
                                        N ─────────┘
  ② prev.next = N       →  prev 改指 N          prev ──► N ──► B ──► C

错误顺序（先断后接）
  ① prev.next = N       →  B 及其后全部成为孤岛   prev ──► N    [B] ──► [C]
  ② N.next = prev.next  →  prev.next 现在就是 N，于是 N.next = N：自环
                            prev ──► N ──┐
                                      ▲ │
                                      └─┘   后半段永久丢失（C 里就是泄漏）
```

```python
def insert_after(prev, value):
    """在 prev 之后插入一个新节点：两步的顺序不能反。"""
    node = Node(value)
    node.next = prev.next     # 第一步：新节点先认住原来的后继
    prev.next = node          # 第二步：再让前驱改指新节点
    return node


def remove_after(prev):
    """删除 prev 的后继节点：先把后继的 next 取出来用，再断链。"""
    if prev.next is None:
        raise ValueError("prev 是尾节点，后面没有节点可删")
    victim = prev.next
    prev.next = victim.next   # 右边先读出 victim.next，再覆盖 prev.next
    victim.next = None        # 断开被删节点，避免它继续指向链内（悬空引用）
    return victim.value
```

两句话记住：**「新节点先认住别人的后继，别人再改指新节点」**，以及「凡是要覆盖的指针，先用完再覆盖」。

### 3.2 删除：先保存后继，再断链

```text
删除 prev 的后继 B：   prev ──► B ──► C ──► …
  ① victim = prev.next          先抓住 B（下一步就没人指向它了）
  ② prev.next = victim.next     让 prev 跨过 B 直接指向 C
  ③ victim.next = NULL          断开 B 指向链内的指针（C 里紧接着 free(victim)）
结果： prev ──► C ──► …         B 成为孤立节点，交给调用者释放
```

第 ③ 步常被忽略，但它决定 bug 的性质：不置空，被删节点仍指着链内，若它还被别的引用持有，就有人顺着它把已删除的节点当活的用；若它紧接着被 free，那就是一个指向已释放内存的悬空指针（dangling pointer）。

### 3.3 两种典型错误

**丢掉后继指针。** 先执行 `prev.next = node`，再写 `node.next = prev.next`——第二步读到的 `prev.next` 已经是 `node` 自己，结果是一个自环，外加原来那半条链从此不可达。它的可怕之处在于**局部测试全过**：只打印前半段时一切正常。

**悬空指针。** 删除了节点却继续使用它的地址（`free(p)` 之后读 `p->next`、把 `p` 存进了别的表、把 `p` 交给了回调）。它不一定立刻崩：被释放的内存可能还没被复用，读到的是旧数据——表现为「大部分时候正确」的幽灵 bug。

### 3.4 完整操作：头部 / 中间 / 尾部插入删除

```c
/* 单链表：头部 / 中间 / 尾部插入删除，以及整链释放 */
#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    int value;
    struct Node *next;
} Node;

/* ---------- 头部插入：O(1)，但头指针本身要改 ⇒ 传二级指针 ---------- */
static int push_front(Node **head, int value) {
    Node *n = malloc(sizeof *n);
    if (!n) return -1;
    n->value = value;
    n->next = *head;              /* 先接后继 */
    *head = n;                    /* 再改头指针 */
    return 0;
}

/* ---------- 尾部插入：没有尾指针时是 O(n) ---------- */
static int push_back(Node **head, int value) {
    Node *n = malloc(sizeof *n);
    if (!n) return -1;
    n->value = value;
    n->next = NULL;
    if (*head == NULL) {          /* 空表是特例：头指针没有前驱可改 */
        *head = n;
        return 0;
    }
    Node *cur = *head;
    while (cur->next) cur = cur->next;
    cur->next = n;
    return 0;
}

/* ---------- 在 prev 之后插入：链表真正的 O(1) 插入 ---------- */
static int insert_after(Node *prev, int value) {
    Node *n = malloc(sizeof *n);
    if (!n) return -1;
    n->value = value;
    n->next = prev->next;         /* 先接后断，两句的顺序不能反 */
    prev->next = n;
    return 0;
}

/* ---------- 删除第一个值等于 value 的节点：两级指针消掉「删头」特例 ---------- */
static int remove_value(Node **head, int value) {
    Node **pp = head;                     /* pp 指向「指向节点的指针」 */
    while (*pp && (*pp)->value != value)
        pp = &(*pp)->next;                /* 把 pp 挪到「下一个指针」的地址上 */
    if (!*pp) return 0;                   /* 走到底也没找到 */
    Node *victim = *pp;
    *pp = victim->next;                   /* 一条赋值覆盖头、中间、尾三种位置 */
    free(victim);
    return 1;
}

/* ---------- 整链释放：先保存 next，再 free ---------- */
static void free_list(Node **head) {
    Node *cur = *head;
    while (cur) {
        Node *next = cur->next;           /* 关键：free 之前先把 next 取出来 */
        free(cur);
        cur = next;
    }
    *head = NULL;
}

int main(void) {
    Node *head = NULL;
    if (push_back(&head, 2) != 0) return 1;           /* 尾部插入 */
    if (push_back(&head, 3) != 0) return 1;
    if (push_front(&head, 1) != 0) return 1;          /* 头部插入 */
    if (insert_after(head->next, 99) != 0) return 1;  /* 中间插入 */
    for (const Node *p = head; p; p = p->next) printf("%d ", p->value);   /* 1 2 99 3 */

    if (!remove_value(&head, 1)) return 1;            /* 删头 */
    if (!remove_value(&head, 99)) return 1;           /* 删中间 */
    if (!remove_value(&head, 3)) return 1;            /* 删尾 */
    if (remove_value(&head, 42)) return 1;            /* 不存在的值：返回 0 */
    printf("\n只剩 = ");
    for (const Node *p = head; p; p = p->next) printf("%d ", p->value);   /* 只剩 2 */

    free_list(&head);
    if (head != NULL) return 1;                       /* 释放后调用者的指针被置空 */
    printf("\nc_list ok\n");
    return 0;
}
```

三个工程要点：**`push_front` 必须传二级指针**（它要修改调用者手里的 `head` 变量），而 `insert_after` 只传节点地址就够——链表接口的复杂度往往就在于「这个函数要不要改 head」，这正是哨兵节点要解决的问题。**`remove_value` 里的两级指针 `Node **pp`** 是本节精华：`pp` 指向「存放节点地址的那个变量」，删除时就地用 `*pp = victim->next` 覆盖，于是头、中间、尾共享同一条赋值——它是「哨兵」的指针版本，把特例变成同一条路径。**`free_list` 先存 `next` 再 `free`**，顺序反了就是 use-after-free（第 9 节展开）。

## 4. 哨兵节点：消除边界判断

### 4.1 同一段删除代码的两个版本

链表实现里最烦的不是逻辑而是特例：删的若是第一个节点就得改 head，空表又是另一种情况。哨兵节点（sentinel，也叫哑节点 dummy head）的办法是：**让「第一个节点的前驱」永远存在**——它是空的、不装数据的那个头节点。

```python
# 无哨兵版：删第一个值等于 target 的节点，返回新的头
def remove_no_dummy(head, target):
    if head is None:                        # 特例 1：空表
        return None
    if head.value == target:                # 特例 2：要删的就是第一个节点
        return head.next                    # 只能把新头「交还」给调用者
    prev = head
    while prev.next is not None:
        if prev.next.value == target:
            prev.next = prev.next.next
            return head                         # 删中间 / 删尾也要把 head 返回去
        prev = prev.next
    return head                                 # 没找到也要返回 head
```

```python
# 有哨兵版：dummy 永远是第一个节点的前驱，删第一个不再特殊
def remove_with_dummy(dummy, target):
    prev = dummy
    while prev.next is not None:
        if prev.next.value == target:
            prev.next = prev.next.next          # 与删除中间节点完全同一段代码
            return True
        prev = prev.next
    return False
```

差别不止是少了三行：

| <br /> | 无哨兵                               | 有哨兵                           |
| ------ | --------------------------------- | ----------------------------- |
| 空表     | 要特判                               | 循环条件自然处理（`dummy.next` 是 None） |
| 删首节点   | 要改 head 并把它返回                     | 与删中间节点同一行代码                   |
| 调用者    | `head = remove(head, x)`，容易忘记接返回值 | `remove(dummy, x)`，调用者的变量从不改变 |
| 分支数    | 每次比较都要想「会不会是第一个」                  | 只有一条路径，写错的空间小一个数量级            |

> [!IMPORTANT]
> 哨兵消除的是**结构性特例**（空表、首节点），不是「维护元数据」这件事。真实实现里还有 `size`、`tail` 要跟着更新——但它们不再是「第一种情况」，而是「每次插删都要做的一件事」。判断一段链表代码是否工程化，就看它有没有把特例变成常态。

附赠的三个好处：**头指针永不变**，所有函数都不需要「返回新头」这种约定；**尾插 O(1)**（多存一个 `tail`，有哨兵时初始化为哨兵本身，空表不必特判，[第 05 篇](05-queue-deque.md) 的双端队列就靠这个）；**合并、拆分、反转都更干净**（第 5 节的多个套路要用）。代价是一个节点的内存和一个必须靠纪律维持的约定：**哨兵不是数据节点**——遍历从 `dummy.next` 开始、长度不含哨兵、反转不要把它算进去，否则结果里会多出一个莫名其妙的 0。

### 4.2 完整的带头链表

```python
class Node:
    __slots__ = ("value", "next")

    def __init__(self, value=None, next=None):
        self.value = value
        self.next = next


class SinglyList:
    """带头哨兵（dummy head）的单链表：dummy 永远存在、永远不装数据。"""

    def __init__(self):
        self.dummy = Node()            # 哨兵：让「空表」和「表头」拥有同一个形状
        self.tail = self.dummy         # 尾指针：让尾插也是 O(1)
        self.size = 0

    def _prev_of(self, index):
        """返回第 index 个节点的前驱；index == size 时返回尾节点。"""
        if not 0 <= index <= self.size:
            raise IndexError(index)
        prev = self.dummy
        for _ in range(index):
            prev = prev.next
        return prev

    def insert(self, index, value):
        prev = self._prev_of(index)
        prev.next = Node(value, prev.next)
        if prev is self.tail:                 # 插在链尾 ⇒ 尾指针跟上
            self.tail = prev.next
        self.size += 1

    def append(self, value):
        self.tail.next = Node(value)
        self.tail = self.tail.next
        self.size += 1

    def erase(self, index):
        if not 0 <= index < self.size:
            raise IndexError(index)
        prev = self._prev_of(index)
        victim = prev.next
        prev.next = victim.next
        if victim is self.tail:               # 删的是尾节点 ⇒ 尾指针回退
            self.tail = prev
        victim.next = None
        self.size -= 1
        return victim.value

    def __iter__(self):
        cur = self.dummy.next
        while cur is not None:
            yield cur.value
            cur = cur.next

    def __len__(self):
        return self.size


if __name__ == "__main__":
    lst = SinglyList()
    for x in (1, 2, 3):
        lst.append(x)
    lst.insert(0, 0)                  # 头部 → [0, 1, 2, 3]
    lst.insert(2, 99)                 # 中间 → [0, 1, 99, 2, 3]
    lst.insert(len(lst), 4)           # 尾部 → [0, 1, 99, 2, 3, 4]
    assert list(lst) == [0, 1, 99, 2, 3, 4]
    assert lst.erase(0) == 0          # 删头 → [1, 99, 2, 3, 4]
    assert lst.erase(2) == 2          # 删中间 → [1, 99, 3, 4]
    assert lst.erase(len(lst) - 1) == 4   # 删尾 → [1, 99, 3]
    assert list(lst) == [1, 99, 3] and lst.tail.value == 3
    print("SinglyList ok:", list(lst))
```

`head`（哨兵）、`tail`、`size` 三者最容易失配：任何结构改动都要同步维护它们，否则 bug 会在很久之后以「`append` 之后链突然断了」的形式出现。`size` 是可选优化——不维护它就是 O(n) 的 `len()`，维护它就多两处要更新的地方，典型的「用常数时间换一处出错点」。

## 5. 经典套路

本节所有代码共用第 4.2 节的 `Node`。每个套路给代码也给正确性依据。

### 5.1 迭代反转

```python
def reverse_iter(head):
    """迭代反转。不变式：prev 是已反转部分的头，cur 是未反转部分的头。"""
    prev, cur = None, head
    while cur is not None:
        nxt = cur.next        # 1. 先记住后继，断链后就找不回来了
        cur.next = prev       # 2. 掉头
        prev = cur            # 3. 已反转部分扩大一格
        cur = nxt             # 4. 未反转部分缩小一格
    return prev               # 退出时 cur 为空，prev 是原来的尾 = 新头
```

**不变式与终止性**：每轮循环开始时，`prev` 是原链前 k 个节点反转后的头，`cur` 是第 k+1 个节点，两者之间已经断开。循环体四步做完后 k 加一，不变式保持；`cur` 每轮前进一个节点，n 轮后为 None，此时全部节点都已反转，`prev` 是新头。时间 O(n)、额外空间 O(1)。**必须先存 `nxt`**：第 2 步之后 `cur.next` 已指向 `prev`，原后继的地址只剩 `nxt` 这一份拷贝。

### 5.2 递归反转

```python
def reverse_rec(head):
    """递归反转，返回反转后的新头。递归深度 = 链表长度。"""
    if head is None or head.next is None:
        return head
    new_head = reverse_rec(head.next)   # 先把后面的 n-1 个节点反转好
    head.next.next = head               # 让原来的后继反过来指向自己
    head.next = None                    # 自己成为新的尾
    return new_head
```

**为什么是 O(n) 栈空间**：第 n 个节点返回之后，第 n−1 层的 `new_head = ...` 才拿得到值，所以每一层都必须挂在栈上等——递归深度等于链表长度，每层至少一个栈帧。迭代版把这份「等待」换成了一个变量 `prev`，所以是 O(1)。

> [!WARNING]
> 这不是「常数大一点」的问题：Python 默认递归上限 1000，实测 1000 个节点的链表调用 `reverse_rec` 直接抛 `RecursionError`（996 个节点还能过）；C 里 8 MB 栈在几十万节点时也会段错误。**输入规模由外部决定时，链表反转一律用迭代写。**

### 5.3 快慢指针找中点

```python
def middle_node(head):
    """返回中间节点；偶数个节点时返回「后半的第一个」（LeetCode 876 口径）。"""
    slow = fast = head
    while fast is not None and fast.next is not None:
        slow = slow.next
        fast = fast.next.next
    return slow


def middle_node_left(head):
    """返回「前半的最后一个」；保证 n ≥ 2 时前半非空，可直接用来切两半。"""
    slow = fast = head
    while fast.next is not None and fast.next.next is not None:
        slow = slow.next
        fast = fast.next.next
    return slow
```

**偶数个节点时的边界选择**是这里唯一要动脑的地方，两种口径都对，用错地方就是 bug：

| 口径  | 循环条件                           | 偶数（1 2 3 4）停在哪         | 适用                    |
| --- | ------------------------------ | ---------------------- | --------------------- |
| 右中点 | `fast and fast.next`           | 下标 ⌊n/2⌋ = 2，即节点 3     | 判回文、找中间值、LeetCode 876 |
| 左中点 | `fast.next and fast.next.next` | 下标 ⌊(n−1)/2⌋ = 1，即节点 2 | 切两半做归并排序              |

依据：每轮 `slow` 走 1、`fast` 走 2。右中点版循环 ⌊n/2⌋ 轮后 `fast` 无法再走两步，`slow` 停在下标 ⌊n/2⌋；左中点版循环 ⌊(n−1)/2⌋ 轮，`slow` 停在下标 ⌊(n−1)/2⌋。两式只在 n 为偶数时不同，差一格。**做归并排序时若选右中点，n = 2 会把「前半」切成空**，递归不终止——这类 bug 就是边界口径选错。

### 5.4 Floyd 判环与入环点

```python
def cycle_entry(head):
    """返回入环的第一个节点；无环返回 None（顺带解决了「有没有环」）。"""
    slow = fast = head
    while fast is not None and fast.next is not None:
        slow = slow.next
        fast = fast.next.next
        if slow is fast:                  # 相遇了
            p = head                      # 一个指针回到头
            while p is not slow:          # 两者同速前进，再次相遇必在入环点
                p = p.next
                slow = slow.next
            return p
    return None
```

**为什么一定会相遇**：两个指针都进入环之后，`fast` 相对于 `slow` 每轮前进 1 步（2 − 1），相当于在长度 L 的环上以相对速度 1 追赶，最多 L 轮必然追上。这里用的是**相对速度 1**：若让 `fast` 一次走 3 步（相对速度 2），当 L 为偶数时它可能恰好从 `slow` 头上跳过而永远追不上——Floyd 的标准形式必须是 2 步。

**入环点的代数推导**：

```text
记：
  x = 从头节点走到环入口所需的步数
  y = 从环入口走到相遇点所需的步数
  L = 环的长度（节点数）
  z = 从相遇点继续往前走到环入口所需的步数，于是 y + z = L

相遇时：
  慢指针走了   x + y
  快指针走了   x + y + n·L           （n ≥ 1：快指针至少多绕了整整 n 圈）
  快指针步数是慢指针的两倍：
      2(x + y) = x + y + n·L
   ⇒ x + y = n·L
   ⇒ x = n·L − y = (n − 1)·L + (L − y) = (n − 1)·L + z

于是 x ≡ z (mod L)：
  让一个指针回到头节点、另一个留在相遇点，两者同速（每次 1 步）前进。
  从头出发的指针走 x 步到入口；
  从相遇点出发的指针走 x 步也会到入口 —— 它先走 z 步到入口，再沿环绕 (n−1) 圈回到入口。
  所以两者第一次相遇的位置就是入环点，第二趟仍然是 O(L)。
```

总复杂度 O(n) 时间、O(1) 空间。替代方案是用哈希集合记录访问过的节点（O(n) 空间、实现更直白），Floyd 的价值就在空间是常数。顺带一个推论：相遇后「绕环一圈回到相遇点」的步数就是 L，这是求环长的标准做法。

### 5.5 合并两条有序链表

```python
def merge_sorted(a, b):
    """合并两条升序链表，复用原节点。返回新头。"""
    dummy = Node()            # 哨兵：新链表的「头是怎么来的」不再需要特判
    tail = dummy              # 尾指针：每次挂接 O(1)，而不是回头找尾
    while a is not None and b is not None:
        if a.value <= b.value:        # <= 保证稳定：相等时取 a 的节点
            tail.next = a
            a = a.next
        else:
            tail.next = b
            b = b.next
        tail = tail.next
    tail.next = a if a is not None else b   # 剩下的一整段直接接上
    return dummy.next
```

**正确性**：每轮取出 `a`、`b` 当前头里较小的那个挂到结果末尾，剩下的两条链各自仍有序，归纳可证结果有序且不重不漏。**关键工程点是最后一行**：一条链耗尽后，另一条的剩余部分整段接上即可——这正是链表相对数组的 O(1) 拼接优势。**没有哨兵时**第一个节点得特判（结果的头是 `a` 还是 `b` 取决于第一次比较），哨兵把这一支消掉了。合并 k 条时用 [第 09 篇](09-heap-priority-queue.md) 的堆挑最小头，总代价 O(N log k)。

### 5.6 删除倒数第 k 个节点

```python
def remove_nth_from_end(head, n):
    """删除倒数第 n 个节点（n ≥ 1），一趟走完。"""
    dummy = Node(None, head)
    fast = slow = dummy
    for _ in range(n + 1):        # fast 先走 n+1 步 ⇒ 两者间距恒为 n+1 个节点
        fast = fast.next
    while fast is not None:
        fast = fast.next
        slow = slow.next
    slow.next = slow.next.next    # slow 恰好停在待删节点的前驱上
    return dummy.next
```

**间距不变量**：`fast` 先走 n+1 步后，它与 `slow` 之间恒为 n+1 条边。`fast` 走到 None 时比最后一个节点多走了 1 步，所以 `slow` 正好停在倒数第 n 个节点的**前驱**上。为什么是 n+1 而不是 n？因为删除需要前驱，而「倒数第 k 个的前驱」= 正数第 len−k 个，间距要多一格。哨兵再一次免掉了「删的正好是第一个节点」的特判。

### 5.7 有序链表去重：两个变体

```python
def dedupe_sorted(head):
    """有序链表去重：重复的只保留一个。O(n) 时间、O(1) 额外空间。"""
    cur = head
    while cur is not None and cur.next is not None:
        if cur.value == cur.next.value:
            cur.next = cur.next.next     # 删掉后继，cur 不动（后面可能还有重复）
        else:
            cur = cur.next               # 确认不重复才前进
    return head


def remove_duplicates_all(head):
    """有序链表去重：出现过重复的值一个都不留。"""
    dummy = Node(None, head)
    prev, cur = dummy, head
    while cur is not None:
        if cur.next is not None and cur.next.value == cur.value:
            val = cur.value
            while cur is not None and cur.value == val:
                cur = cur.next           # 跳过整段相等的节点
            prev.next = cur              # 一次断链删掉一整段
        else:
            prev = cur
            cur = cur.next
    return dummy.next
```

分野在「`cur` 什么时候前进」：保留一个的版本里，删除后继后 `cur` **不能动**（新后继可能还是同一个值，得再比一次）；全删的版本里用内层循环跳过整段相等的节点，再用 `prev.next = cur` 一次断链，其中 `prev` 的语义是「最后一个确认保留的节点」，所以必须用哨兵初始化——否则第一个节点就是重复值时无从下手。两者都是 O(n) 时间、O(1) 额外空间，一遍扫描。

### 5.8 串起来验证

```python
if __name__ == "__main__":
    def build(values):
        head = None
        for v in reversed(values):
            head = Node(v, head)
        return head

    def dump(head):
        out = []
        while head is not None:
            out.append(head.value)
            head = head.next
        return out

    # 接线顺序（第 3 节）
    a = build([1, 2])
    insert_after(a, 9)
    assert dump(a) == [1, 9, 2] and remove_after(a) == 9 and dump(a) == [1, 2]
    # 哨兵消掉的特例：删首节点（第 4 节）
    d = Node(None, build([1, 2, 3]))
    assert dump(remove_no_dummy(build([1, 2, 3]), 1)) == [2, 3]
    assert remove_with_dummy(d, 1) and dump(d.next) == [2, 3]
    # 反转：迭代 O(1) 空间、递归 O(n) 栈
    assert dump(reverse_iter(build([1, 2, 3, 4]))) == [4, 3, 2, 1]
    assert dump(reverse_rec(build([1, 2, 3, 4]))) == [4, 3, 2, 1]
    assert reverse_iter(None) is None and reverse_rec(None) is None
    # 中点：两种口径在偶数个节点上差一格
    assert middle_node(build([1, 2, 3, 4])).value == 3
    assert middle_node_left(build([1, 2, 3, 4])).value == 2
    assert middle_node_left(build([1, 2])).value == 1
    # 判环与入环点（环长 L = 3，入环点是值 4 的节点）
    assert cycle_entry(build([1, 2, 3])) is None
    cyc = build([1, 2, 3, 4, 5, 6])
    entry_node = cyc.next.next.next
    tail = cyc
    while tail.next is not None:
        tail = tail.next
    tail.next = entry_node
    assert cycle_entry(cyc) is entry_node
    # 合并、倒数第 n 个、去重两个变体
    assert dump(merge_sorted(build([1, 3, 5]), build([2, 4, 6]))) == [1, 2, 3, 4, 5, 6]
    assert dump(merge_sorted(build([1, 2]), build([1, 1]))) == [1, 1, 1, 2]
    assert dump(remove_nth_from_end(build([1, 2, 3, 4, 5]), 2)) == [1, 2, 3, 5]
    assert dump(remove_nth_from_end(build([1, 2, 3]), 3)) == [2, 3]
    assert dump(dedupe_sorted(build([1, 1, 1, 2, 3, 3]))) == [1, 2, 3]
    assert dump(remove_duplicates_all(build([1, 1, 1, 2, 3, 3, 4]))) == [2, 4]
    assert dump(remove_duplicates_all(build([1, 1, 2, 2]))) == []
    print("§3 §4 §5 全部片段验证通过")
```

## 6. 复杂度对照表

| 操作              | 动态数组              | 单链表                 | 双链表（带尾指针）        | 说明                       |
| --------------- | ----------------- | ------------------- | ---------------- | ------------------------ |
| 按下标访问 `a[i]`    | O(1)              | O(n)                | O(n)             | 链表每跳一次都可能是一次缓存未命中        |
| 按值查找            | O(n)，有序时 O(log n) | O(n)                | O(n)             | 链表无法二分：二分依赖 O(1) 随机访问    |
| 头部插入/删除         | O(n)              | O(1)                | O(1)             | 数组要整体后移/前移               |
| 尾部插入/删除         | 摊还 O(1)，最坏 O(n)   | O(n)，有尾指针则 O(1)     | O(1)             | 链表没有扩容这件事                |
| 中间插删（已知前驱或节点引用） | O(n)（memmove 尾巴）  | O(1)                | O(1)             | 链表唯一的高光时刻                |
| 中间插删（只给下标）      | O(n)              | O(n) + O(1)         | O(n) + O(1)      | 「找位置」这一步链表永远是 O(n)       |
| 长度              | O(1)              | O(n)，另存 size 则 O(1) | 同左               | 链表缓存长度要用「每次增删都维护」来换      |
| 每元素内存开销         | 元素本身 + 最多一倍冗余     | 元素 + 1 指针 + 分配器头    | 元素 + 2 指针 + 分配器头 | 存 4 字节 int 时密度差 4\~8 倍   |
| 缓存友好度           | 极好（顺序预取、可向量化）     | 差（指针追逐）             | 差                | 第 7 节实测：随机布局约 300 倍      |
| 元素地址稳定性         | 扩容后全部搬走，引用/迭代器失效  | 插删不影响其他节点地址         | 同左               | C++ 里 `std::list` 唯一的硬优势 |

三种复杂度语义在这里的分界很清楚：数组尾部插入是**摊还** O(1)（单次可能 O(n) 拷贝）、查找是**平均** O(1)（哈希，最坏 O(n)）；而链表的插删是**最坏**也 O(1)（只要持有引用），代价是查找在任何情况下都是 O(n)、且遍历的常数是数组的几十到几百倍。

## 7. 为什么数组几乎总是赢

### 7.1 三笔账

**第一笔：指针追逐 vs 顺序预取。** CPU 一次取一整条缓存行（通常 64 字节）。数组遍历走线性地址，硬件预取器能提前把后面的行拉进来，编译器还能自动向量化；链表遍历的下一步地址要等上一步加载完成才知道，形成**依赖加载链**，既不能预取也不能并行，每个节点都可能在等主存（约 100 纳秒，够 CPU 执行几百条指令）。64 字节的缓存行装得下 16 个 int（数组），或 4 个 16 字节的节点（链表），差距进一步放大。

**第二笔：每节点一次 malloc。** 分配不止是浪费几个字节的头部：每次分配要查分配器的空闲链（可能加锁）、要写元数据、要让内存变零碎。碎片化的后果就是上面那条依赖加载链的每一跳都跳到不同的内存页，TLB 也跟着遭殃。

**第三笔：所有权机制的附加成本。** C++ 用 `shared_ptr` 串链表，每个节点多一个约 16 字节的控制块，每次增删都要做原子引用计数（跨核缓存行争用 + 阻止编译器优化）；GC 语言里每个节点都是带对象头的堆对象（Java 至少 32 字节，而它装的只是一个引用），遍历还要过写屏障。数组是一整块连续内存，什么都不用额外管。

### 7.2 一次实测：同一份数据，只有布局不同

```c
/* 实测：10^6 个 int，数组 vs 两种内存布局的链表遍历（每趟重复 REPS 次取平均） */
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

typedef struct Node { int value; struct Node *next; } Node;

#define N 1000000
#define REPS 50

static long us_per_pass(clock_t t) {     /* 微秒/趟；用 64 位中间量避免溢出 */
    return (long)((long long)t * 1000000 / CLOCKS_PER_SEC / REPS);
}

int main(void) {
    int *arr = malloc(sizeof(int) * (size_t)N);
    Node **pool = malloc(sizeof(Node *) * (size_t)N);
    if (!arr || !pool) return 1;
    for (int i = 0; i < N; i++) {
        arr[i] = i;
        pool[i] = malloc(sizeof(Node));   /* 顺序 malloc：节点地址基本相邻 */
        if (!pool[i]) return 1;
        pool[i]->value = i;
    }
    Node *head_seq = NULL;                /* 变体 A：按分配顺序串起来 */
    for (int i = N - 1; i >= 0; i--) { pool[i]->next = head_seq; head_seq = pool[i]; }

    for (int i = N - 1; i > 0; i--) {     /* 洗牌：模拟被碎片切碎的堆 */
        int j = rand() % (i + 1);
        Node *t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    Node *head_rand = NULL;               /* 变体 B：按打乱后的顺序串起来 */
    for (int i = N - 1; i >= 0; i--) { pool[i]->next = head_rand; head_rand = pool[i]; }

    long long s = 0;
    clock_t t0 = clock();
    for (int r = 0; r < REPS; r++) for (int i = 0; i < N; i++) s += arr[i];
    clock_t t1 = clock();
    for (int r = 0; r < REPS; r++) for (Node *p = head_seq; p; p = p->next) s += p->value;
    clock_t t2 = clock();
    for (int r = 0; r < REPS; r++) for (Node *p = head_rand; p; p = p->next) s += p->value;
    clock_t t3 = clock();

    printf("array  : %7ld us/趟\n", us_per_pass(t1 - t0));
    printf("list A : %7ld us/趟  = 数组的 %ld 倍\n",
           us_per_pass(t2 - t1), (long)((t2 - t1) / (t1 - t0)));
    printf("list B : %7ld us/趟  = 数组的 %ld 倍\n",
           us_per_pass(t3 - t2), (long)((t3 - t2) / (t1 - t0)));
    printf("(校验和低 32 位 = %ld，防止循环被优化掉)\n", (long)s);
    return 0;
}
```

同一台机器上 `gcc -O2` 的实测（10⁶ 个 int，每趟 50 次取平均，共跑 10 次）：

| 遍历方式                    | 每趟耗时                           | 相对数组         |
| ----------------------- | ------------------------------ | ------------ |
| 数组顺序遍历                  | 约 0.30\~0.50 ms                | 1 倍          |
| 链表，节点地址大体相邻（刚 malloc 完） | 0.32\~4.0 ms，**同一份二进制每次运行都不同** | 1\~9 倍       |
| 链表，节点地址随机（碎片化的堆）        | 约 109\~158 ms                  | 约 270\~380 倍 |

三个可以直接拿去用的结论：

1. **量级对得上理论**：10⁶ 次随机访存 × 约 100 纳秒 = 100 毫秒，与实测吻合。链表慢在「每一步都在等内存」，不是「多做了几次运算」。
2. **链表的性能取决于分配器，不取决于你的代码**。第二行是链表的最好情况（刚分配、地址相邻），可它仍在 0.32\~4.0 ms 间波动——同一份二进制、同样的数据，只因为这次运行的堆布局不同就能差 10 倍以上。数组不会：地址是算出来的，布局没有悬念。这一条对延迟敏感的系统比「平均快慢」重要得多。
3. **编译器优化几乎全部回馈给数组**。同一份代码的数组那趟，`-O0` 下约 1.0 ms、`-O2` 下约 0.38 ms（向量化 + 循环展开，快约 2.6 倍）；链表那两趟在两个优化级别下没有稳定改善——依赖加载链既不能向量化也不能重排，剩下的波动全来自堆布局。换句话说，**你以为在优化链表代码时，真正在起作用的是分配器。**

> [!WARNING]
> 「链表插入是 O(1)」在真实系统里经常是错的。一次插入可能触发 `malloc`，而 `malloc` 在碎片化的堆上要遍历空闲链、甚至向内核申请新页；删除时的 `free` 也可能触发合并与页回收。链表把「搬家的成本」换成了「分配的方差」，而方差在延迟敏感场景比均值更致命。要用链表做热路径，正确做法是配一个池化分配器（一次申请一批节点，自建空闲链——也就是第 2.2 节的静态链表）。

### 7.3 链表真正赢的场景

1. **已持有节点引用时的中间插删。** LRU 缓存是标准例子：哈希表给出节点，双向链表在 O(1) 内把节点挪到表头。数组做不到——挪一个元素要搬整条尾巴，而且哈希表里存的「下标」会在任何一次插入后失效。
2. **元素极大，搬迁成本高。** 每个元素 1 KB、10 万个元素时，数组中间插入一次要 memmove 约 100 MB，链表只改两个指针。注意区分「数组存指针」的方案：那样插入也只改指针，却多一层间接跳转和一次独立分配；链表把指针直接编进了元素（节点的地址就是元素的地址），省掉这一层。
3. **频繁拼接与拆分。** 归并排序的 merge 是 O(1)（接一条链），数组版是 O(n)（复制）；拼接、按位置切分都是常数时间。这是 [第 14 篇](14-sorting.md) 里链表归并排序 O(1) 额外空间的来源。
4. **地址必须稳定。** 遍历时别的代码往容器里插入元素，数组的引用/迭代器会全部失效，链表不受影响。C++ 里 `std::list` 与 `std::vector` 的选择，经常由这一条而不是性能决定。
5. **没有连续内存可用。** 内存严重碎片化、或进程要几 GB 连续地址空间而系统给不出时，链表是唯一能把散落小块串起来的结构；嵌入式里连「小块」都要预先划好，就是静态链表。

判断标准是**「我手里有没有节点的引用」**，而不是「插入是不是 O(1)」——没有引用的链表插入，和数组一样是 O(n)，而且常数更大。

## 8. 链表在真实系统里的样子

### 8.1 Linux 内核：侵入式链表

内核里有成千上万种要串成链表的结构体（进程、inode、定时器、网络包）。它没有为每种类型写一套链表，也没让节点去装 `void *`，而是把**链表指针嵌进业务结构体**：

```c
/* 侵入式链表：链表节点嵌在业务结构体里（Linux 内核 list_head 的思路） */
#include <stddef.h>
#include <stdio.h>

struct list_head {
    struct list_head *next;
    struct list_head *prev;
};

/* 由「成员的地址」反推「宿主结构体的地址」：把成员偏移减掉 */
#define container_of(ptr, type, member) \
    ((type *)((char *)(ptr) - offsetof(type, member)))

struct task {
    int pid;
    struct list_head link;      /* 侵入式：task 自己带着挂链用的挂钩 */
};

static void list_add_tail(struct list_head *n, struct list_head *head) {
    n->prev = head->prev;       /* 四步都要改对，漏一步就断链 */
    n->next = head;
    head->prev->next = n;
    head->prev = n;
}

static void list_del(struct list_head *n) {
    n->prev->next = n->next;
    n->next->prev = n->prev;
}

static void list_print(const char *tag, struct list_head *head) {
    printf("%s: ", tag);
    for (struct list_head *p = head->next; p != head; p = p->next)
        printf("pid=%d ", container_of(p, struct task, link)->pid);   /* 回到宿主 */
    printf("\n");
}

int main(void) {
    static struct list_head head = { &head, &head };  /* 哨兵：空表就是「自己指自己」 */
    struct task tasks[3] = { {101, {0, 0}}, {202, {0, 0}}, {303, {0, 0}} };
    for (int i = 0; i < 3; i++) list_add_tail(&tasks[i].link, &head);
    list_print("挂上后", &head);                 /* pid=101 pid=202 pid=303 */

    list_del(&tasks[1].link);                    /* 删除：只需要成员自己的地址 */
    list_print("删掉 202 后", &head);            /* pid=101 pid=303 */
    return 0;
}
```

三个设计后果值得抄进自己的代码：**一种链表代码服务所有类型**（`list_add`、`list_del`、`list_for_each` 只认 `list_head *`，不需要泛型、不需要 `void *` 中转、不必为每种类型生成代码）；**没有额外的节点分配**（节点内存由业务对象自己提供，插入不会失败、不必处理分配错误，数据与链接还在同一处，局部性更好）；**一个对象可以同时在多条链表上**（多挂一个 `list_head` 字段就是一维新的关系，进程同时挂在运行队列、父子链、定时器链上）。

代价是**侵入性**：业务结构体必须知道链表的存在，一个对象只能属于同一种链表一次（除非加多个字段），还要用 `container_of` 这样的指针算术——写错了就是内存踩踏。另外内核的链表是**带头哨兵的循环双链表**：空链表就是「自己指自己」，遍历的终止条件是回到哨兵，因而没有一处 NULL 检查。

> [!TIP]
> 内核为不同的权衡准备了不同变体：`hlist`（表头只存一个指针，为哈希桶省内存，见 [第 06 篇](06-hash-table.md)）、`rbtree`（有序、最坏 O(log n)）、`lru` 链表。它们全都用哨兵和侵入式设计——这不是巧合，是被 bug 率与内存占用反复筛选出来的结果。

### 8.2 Redis：adlist 与 quicklist

Redis 旧版的 `list` 类型用 `adlist`：双向链表，节点里存 `void *value`，链表本身带 `head`、`tail`、`len` 和 `dup`/`free`/`match` 三个函数指针（用函数指针实现多态，代价是每次取值一次指针跳转、每个元素一次独立分配）。

元素一多，指针开销和随机访存就把内存和性能吃掉了。3.2 之后的主力结构 `quicklist` 是一个折中：**外层是双向链表，每个节点不是单个元素，而是一个紧凑的连续数组（`ziplist`，7.0 起换成 `listpack`）**，一个节点装几十个元素。于是大结构上仍是链表——头尾插入 O(1)、可以在 O(1) 内拼接拆开，避免了「整块连续数组要重新分配」；局部则是数组——节点内部顺序访问、缓存友好，还省掉了每元素的指针与分配开销。

这是回答「纯链表什么时候该让位」最好的工程答案：**链表管大结构的可拼接性，数组管局部性能。**

### 8.3 跳表：链表当骨架

Redis 的 `zset` 用跳表（skiplist）而不是平衡树。跳表每一层都是一条有序链表，上层是下层的快速通道，查找从上层往下走，期望 O(log n)。选链表而非树的理由很实在：插入只需改局部指针（树要旋转、要维护平衡），区间查询就是顺着底层链表扫，实现和无锁并发都容易得多。代价是**概率平衡**：O(log n) 是期望值，随机性不好时会退化（实践中用随机层数加最大层数上限兜住）。细节见 [第 16 篇](16-advanced-structures.md)。

### 8.4 哈希桶的链

链地址法（[第 06 篇](06-hash-table.md)）就是「桶数组 + 每桶一条链表」：冲突的键挂在链上，查找退化成遍历这条链。它简单、删除方便、能容忍负载因子大于 1，代价是每元素一次独立分配与遍历时的指针追逐——这正是开放寻址（Python dict、Rust 的 SwissTable）要消灭的东西。Java 8 在链长 ≥ 8 时把链转成红黑树，作为「出了事别崩」的兜底。

## 9. 内存管理与所有权

### 9.1 谁分配谁释放

链表是所有数据结构里所有权问题最尖锐的一个，因为它由**一堆离散的分配**组成，每个分配都要有人释放。三条纪律：**谁分配谁释放，并在接口上写清楚**——`remove` 是「摘链并返回节点」（调用者负责释放）还是「摘链并释放」（调用者不能再用），两种契约都行，但必须明确；**所有权转移要显式**——把节点从 A 链移到 B 链不涉及分配和释放，可调用者很容易顺手 free 掉它，于是 B 链里全是悬空指针；**释放整条链的循环顺序不能反**。

```c
/* 释放链表：顺序错了就是 use-after-free */
#include <stdio.h>
#include <stdlib.h>

typedef struct Node { int value; struct Node *next; } Node;

/* 错：free 之后再读 cur->next —— 那块内存已经还给分配器了 */
void free_list_buggy(Node *head) {
    for (Node *cur = head; cur; cur = cur->next)
        free(cur);
}

/* 对：先保存后继，再释放当前节点 */
void free_list_ok(Node *head) {
    while (head) {
        Node *next = head->next;
        free(head);
        head = next;
    }
}

int main(void) {
    Node *head = malloc(sizeof(Node));
    Node *second = malloc(sizeof(Node));
    if (!head || !second) return 1;
    head->value = 1; head->next = second;      /* 手工串两个 malloc 出来的节点 */
    second->value = 2; second->next = NULL;
    free_list_ok(head);
    printf("free order ok\n");
    (void)free_list_buggy;      /* 只展示，不调用 */
    return 0;
}
```

### 9.2 环导致的泄漏

成环的链表若用引用计数管理（C++ 的 `shared_ptr`、Python 的引用计数部分），每个节点的计数永远不归零，整环永久泄漏。Python 的分代 GC 能回收「没有 `__del__` 的」循环垃圾，所以双向链表里 `prev`/`next` 互相引用不会泄漏，但会**延迟**到 GC 跑起来为止，且对象带 `__del__` 时可能永远不被回收；C++ 的 `shared_ptr` 没有 GC 兜底，只能靠 `weak_ptr` 打破环，或干脆不用共享所有权。链表实现里容易成环的地方：删除节点时忘了断开它自己的指针（第 3.2 节的第 ③ 步）、双向链表的 head/tail 更新不对称、以及第 10 节的「迭代中删除」错误。

### 9.3 Rust：递归 drop 会在超长链表上爆栈

Rust 的链表通常写作 `Option<Box<Node>>`。它没有内存泄漏问题，但有一个 C 里不存在的坑：**编译器生成的析构是递归的**。

```rust
struct Node {
    value: i32,
    next: Option<Box<Node>>,
}

struct List {
    head: Option<Box<Node>>,
}

/* 不写这个 Drop，List 离开作用域时编译器生成的 drop glue 会递归下降：
   drop(Node) → drop(Node.next) → … 每个节点一层栈帧。
   节点上百万时直接栈溢出 —— 不是内存不够，是栈不够。 */
impl Drop for List {
    fn drop(&mut self) {
        let mut cur = self.head.take();   /* 把整条链「偷」出来 */
        while let Some(mut node) = cur {
            cur = node.next.take();       /* 先摘下后继，再让这个节点落地 */
        }                                 /* node 在此析构，此时 next 已是 None，递归深度为 1 */
    }
}
```

两条解法，代价不同：**手动实现 `Drop` 用循环拆链**（上面这段）改动最小，但要为每个链表类型写一遍；**不用指针链表**——`Vec<Node>` 存所有节点、节点之间用 `u32` 下标相连（第 2.2 节的静态链表），内存连续、drop 一次完成、还省掉每节点一次分配，代价是删除要维护空闲链、下标越界要靠代码保证。Rust 社区「用安全的 Rust 写链表」的结论长期就是这一条：**多数场景别写链表，要写就用 Vec + 索引**。

## 10. 工程陷阱

> [!CAUTION]
> 下面几条是链表 bug 的高频来源，共同特征是**在小数据量的测试里表现正常**，在生产规模上偶发崩溃。链表代码写完必须做三件事：打印整条链验证不变式（长度、终止、无环）、在删除路径上跑压力测试、用 valgrind 或 ASan 跑一遍。

- **迭代中删除当前节点**。`for p in list: remove(p); p = p.next` 里，`p.next` 在删除之后已不可靠。三种正确写法：先存 `next = p.next` 再删；用「前驱」做迭代变量（即 `remove_value` 的两级指针技巧）；或先收集要删的节点再统一删。
- **浅拷贝导致 double free**。`Node copy = *node;` 拷的是 next 指针而不是新节点，两个副本析构时都去 free 同一块内存。C 的结构体赋值、C++ 默认拷贝构造都是浅拷贝——类里只要有裸指针持有资源，就必须写深拷贝或禁用拷贝（`= delete`，或改用 `unique_ptr`）。
- **野指针**。`free(p)` 后没把 `p` 置空，之后 `if (p)` 这类「非空即有效」的判断全部失效。规矩很简单：`free(p); p = NULL;`，并且不要让同一个节点同时挂在两个容器里可用。
- **把栈上的节点又 free**。`Node n = {1, NULL}; free(&n);`——栈变量、数组元素、结构体成员都不是 malloc 来的，free 它们是堆破坏，通常要到很久以后才崩。反过来，返回栈上节点的地址也是同一类错误。
- **双链表删除时漏改一个方向**。`x.prev.next = x.next; x.next.prev = x.prev;` 少一句，链就会在某个方向上断掉：只改前者，反向遍历会走进已删除的节点；只改后者，正向遍历走错。还要按情况更新 head/tail，并把 `x.prev`、`x.next` 置空——否则被删节点会「看起来还在链上」，被误当活节点使用。

还有一条语言特有的：**Python 里没有野指针，但有「忘记更新元数据」**。`tail` 没跟上、`size` 与真实长度不一致，这类 bug 不会崩，只会让后面的逻辑慢慢错——所以像 `SinglyList` 那样把 `tail`/`size` 与结构改动写在同一个方法里，比散落在调用方安全得多。

## 11. 小结

- 链表用「可计算的地址」换「可任意改写的链接」：节点级 O(1) 插删、元素不搬迁、O(1) 拼接；代价是每节点一次分配、指针开销与随机访存。
- 所有链表代码的正确性都归结为同一个不变式：从 head 出发沿 next 恰好走完全部节点一次。改链的铁律是「先接后断」，删除的铁律是「先保存 next 再断链」——都来自「不要提前丢掉唯一的访问路径」。
- 哨兵节点把「空表」「首节点」这两个结构性特例变成常态：删除代码从两条路径变成一条，调用者的头变量永不改变。这是链表工程化的第一课。
- 静态链表用下标代替指针（`next[i]` 存下标），换来无堆环境下的确定性延迟、可预算容量、可序列化与更窄的索引宽度，代价是容量固定与额外的空闲链维护；它也是「Vec + 索引」这一现代写法（Rust 推荐）的原型。
- 七个套路的不变式比代码重要：反转的 prev/cur 划分、快慢指针的 2 倍速、倒数删除的恒定间距、环上相对速度 1 的相遇、哨兵加尾指针的合并、去重时 cur 何时前进。Floyd 的入环点结论来自 `x = (n−1)L + z`，即 `x ≡ z (mod L)`。
- 实践里数组几乎总是赢：指针追逐的依赖加载链、每节点一次 malloc、引用计数与 GC 的附加成本。实测同样 10⁶ 个 int，地址随机的链表比数组慢约 300 倍，连「刚分配、地址相邻」的链表也会因堆布局在 1\~9 倍之间波动。
- 链表真正赢的场景只有五类：已持有节点引用时的中间插删（LRU）、元素极大避免搬迁、频繁拼接拆分（链表归并排序）、地址必须稳定、没有连续内存可用。判断标准是「手里有没有节点引用」，不是「插入是不是 O(1)」。
- 真实系统里的链表几乎都是侵入式 + 哨兵 + 循环（Linux `list_head`），或者与数组混合（Redis quicklist）；所有权是它最容易出人命的地方：谁分配谁释放要写进接口契约，环会让引用计数泄漏，C 里先存 next 再 free，Rust 里 `Option<Box<Node>>` 的递归 drop 会在超长链表上爆栈。

## 12. 练习

**1.** 只给一个单链表节点 `p` 的引用（不给头节点、不给前驱），如何「删除」它？说明这个手法的两个前提，以及为什么 LRU 缓存和内核链表不能这么干。

> [!TIP]
> 思路把后继的值复制到 `p` 再删掉后继：`p.value = p.next.value; p.next = p.next.next`。前提一：`p` 不是尾节点；前提二：节点的**值**可以搬动、且外部不是靠「节点身份」识别元素（否则别处持有的 `p` 会突然变成另一个元素）。LRU 与内核链表恰恰违反前提二：它们存的是节点地址、节点里嵌着业务数据（内核不可能复制整个 `task_struct`），所以要 O(1) 删除只能上双链表——`prev` 指针就是这条限制的解法；而 `p` 是尾节点这种情形，双链表也不需要它。

**2.** 判断链表是否回文，要求 O(n) 时间、O(1) 额外空间。给出步骤和每步复杂度。

> [!TIP]
> 思路①用「右中点」口径的 `middle_node` 找中间；②迭代反转后半段（O(n/2)、O(1) 空间）；③两个指针从头和从中间同步比较，不等即返回 False；④比完把后半段再反转回去，恢复现场（调用者还持有原链表时这是好习惯）。总时间 O(n)、额外空间 O(1)。用栈或数组做是 O(n) 空间——那就不再满足「O(1) 额外空间」，这一点是主要区分点。

**3.** 设计一个 O(1) 的 LRU 缓存。为什么必须是双向链表？为什么建议用哨兵？哈希表里存值还是节点引用？

> [!TIP]
> 思路哈希表 `key → 链表节点引用`（存引用不存值：淘汰时要靠它直接摘链）；链表按新鲜度排序，表头最新、表尾最旧。`get` 命中：用哈希表拿到节点，移到表头（O(1)）；`put` 超容量：删表尾并删哈希键（O(1)）。必须双向：淘汰要摘链，只有 next 就找不到前驱（也不可能从哈希表反查前驱）。哨兵让「表头/表尾」两个特例消失，`move_to_front` 与 `evict` 都不需要判空或判首。哈希表存的是节点引用，所以任何插入删除都不能让节点地址失效——数组做不到。

**4.** 对比链表归并排序与数组归并排序：为什么链表版能做到 O(1) 额外空间，实践中却常输给数组版？

> [!TIP]
> 思路空间：数组版必须开 O(n) 临时数组来合并（否则合并要原地移位，退化成 O(n²)）；链表版合并只改指针，只是要用「左中点」切分（第 5.3 节，保证 n = 2 时前半非空），额外空间 O(1)。仍输的原因：①切分要 O(n) 走中点，而不是数组的 O(1) 下标；②合并是随机指针跳转，每步可能缓存未命中，数组版合并是顺序读写、还能向量化；③链表每节点一次分配，分配与碎片成本先付掉了。理论上的「O(1) 空间」换不回被缓存吃掉的常数。

**5.** 嵌入式项目要在 MCU 上维护 200 条待发送消息（消息体 64 字节，RAM 只有几 KB，禁用动态分配）。给出结构设计，并说明为什么不用指针链表。

> [!TIP]
> 思路静态链表：`value[200]` 存消息体、`next[200]` 用 `uint8_t`/`uint16_t` 存下标、`head` 与 `free_head` 各一个下标（第 2.2 节的结构）。理由：①无堆 ⇒ 无分配延迟、无碎片，所有操作是定长指令序列，实时可验证；②容量硬上限 200，超出时返回明确错误（业务上要限流）而不是崩溃；③下标 1\~2 字节而指针 4/8 字节，200 条省下几百字节 RAM；④纯数据，可整体放入非易失存储或做镜像校验。别忘设计「表满时怎么办」（丢最旧/丢最新/返回错误）——静态链表绕不过这个决定。

**6.** 「遍历中删除当前节点」有哪三种正确写法？为什么 `p = p.next` 在删除之后是错的？

> [!TIP]
> 思路①先存 `nxt = p.next`，删完 `p = nxt`；②用前驱做迭代变量（`prev` / `prev.next` 模式，即两级指针技巧），删完 `prev` 不动、下次看新的 `prev.next`；③先收集要删的节点再统一删（多 O(k) 空间，语义最清晰）。`p = p.next` 错在：删除破坏的是 `p` 的**前驱**对它的引用，`p.next` 本身可能还指着下一个节点——读它只是「侥幸正确」。一旦节点被释放，这次读就是 use-after-free；即使没释放，若删除动作顺手清了被删节点的指针（第 3.2 节第 ③ 步），`p.next` 就是 None，迭代提前结束、剩下的元素全部漏判。

**7.** 写出双向链表删除节点 `x` 的完整代码（带头尾哨兵），并列出每种遗漏的后果。

> [!TIP]
> 思路四条赋值加两处清理：`x.prev.next = x.next; x.next.prev = x.prev;` 然后 `x.prev = x.next = None;`，再按需更新 head/tail（有哨兵时不用，这是哨兵的额外收益）与 `size -= 1`。遗漏后果：只改 `x.prev.next` ⇒ 反向遍历还会走到已删除的 `x`（表里出现幽灵节点）；只改 `x.next.prev` ⇒ 正向遍历走错，链在某一侧断裂；不更新 head/tail ⇒ 该方向的操作从错误位置开始，表现为「表长大了但遍历少了元素」；不置空 `x` 自己的两个指针 ⇒ `x` 若还被别处引用，会「看起来仍在链上」被误用。头尾各一个哨兵能一次消掉 head/tail 的两处特判。

**8.** 一个 Rust 服务用 `Option<Box<Node>>` 维护平均 50 万节点的链表，压测时偶发崩溃且崩溃点随机。给出两个可能原因与对应解法。

> [!TIP]
> 思路①**递归 drop 爆栈**：链表离开作用域时 drop glue 逐层递归，50 万层栈帧超过线程栈（默认 2 MB，主线程 8 MB），表现为「释放链表时随机段错误」。解法：为容器实现手动 `Drop`，用 `while` 循环逐节点摘链释放（第 9.3 节）。②**每节点一次分配带来的延迟尖刺与缓存惩罚**（若表现是超时而非段错误，怀疑这条）：50 万次独立分配、遍历全是缓存未命中。解法：改用 `Vec<Node>` + `u32` 索引（静态链表思想），一次分配、连续内存、drop 一次完成。另外别忘了检查 `Rc`/`Arc` 造成的引用环（计数永不归零 = 泄漏），以及递归写的遍历函数本身也可能爆栈。
