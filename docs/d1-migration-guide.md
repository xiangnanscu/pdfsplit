# D1 数据库迁移指南

## 问题描述

当上传ZIP文件时，如果文件的题目ID（如"Q1"）在D1数据库中已经存在于**其他考试**中，会导致 PRIMARY KEY 冲突错误。

## 解决方案

修改 `questions` 表的主键，从单一的 `id` 改为复合主键 `(exam_id, id)`。这样允许不同的考试拥有相同的题目ID。

## 迁移步骤

### 方法一：使用 wrangler CLI（推荐）

```bash
# 1. 导航到项目目录
cd /root/pdfsplit

# 2. 执行迁移脚本
wrangler d1 execute DB --file=./migrations/001_questions_composite_pk.sql

# 如果你有本地开发数据库
wrangler d1 execute DB --local --file=./migrations/001_questions_composite_pk.sql
```

### 方法二：通过 Cloudflare Dashboard

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **D1**
3. 选择你的数据库（通常叫 `DB`）
4. 点击 **Console** 标签
5. 复制 `/root/pdfsplit/migrations/001_questions_composite_pk.sql` 的内容
6. 粘贴到控制台并执行

### 方法三：全新部署（如果数据可以丢弃）

如果你的D1数据库中没有重要数据，可以直接重新创建：

```bash
# 1. 删除并重新创建 D1 数据库（会丢失所有数据！）
wrangler d1 delete DB
wrangler d1 create DB

# 2. 更新 wrangler.toml 中的 database_id（如果ID变了）

# 3. 运行schema初始化
wrangler d1 execute DB --file=./schema.sql

# 4. 部署Worker
pnpm run deploy
```

## 验证迁移成功

迁移完成后，在D1控制台运行以下查询验证：

```sql
-- 查看新的表结构
PRAGMA table_info(questions);

-- 应该看到 PRIMARY KEY 包含 exam_id 和 id
```

## 代码修改

Worker代码已更新，使用 `INSERT OR REPLACE` 来处理UPSERT操作：

- ✅ `/root/pdfsplit/src/worker.mjs` - 所有questions插入都改为 `INSERT OR REPLACE`
- ✅ `/root/pdfsplit/schema.sql` - questions表改为复合主键

## 测试

迁移完成后，测试上传ZIP：

1. 下载一个已有的考试ZIP文件
2. 清空本地数据
3. 重新上传该ZIP文件
4. **不应该**再出现 PRIMARY KEY 冲突错误
5. 数据应该正常更新到D1数据库

## 注意事项

- ⚠️ 在生产环境执行迁移前，建议先备份D1数据
- ⚠️ 迁移过程中可能需要短暂停机
- ✅ 迁移是幂等的，可以安全重复执行（如果中途失败）
- ✅ 本地开发环境也需要运行相同的迁移

## 回滚（如果需要）

如果迁移出现问题，可以回滚：

```sql
-- 重新创建原来的表结构
CREATE TABLE questions_old (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    data_url TEXT NOT NULL,
    original_data_url TEXT,
    analysis TEXT,
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

-- 复制数据
INSERT INTO questions_old SELECT * FROM questions;

-- 替换表
DROP TABLE questions;
ALTER TABLE questions_old RENAME TO questions;
```

## 相关文件

- `/root/pdfsplit/schema.sql` - 数据库schema定义
- `/root/pdfsplit/src/worker.mjs` - Worker API代码
- `/root/pdfsplit/migrations/001_questions_composite_pk.sql` - 迁移脚本
