# CDN 同步插件需求文档

## 项目概述

基于 initx 框架开发的 CDN 文件同步插件，用于将本地文件上传到腾讯云 COS，并提供交互式的文件选择和覆盖确认功能。

当前版本仅支持腾讯云 COS，不包含 OSS 等其他 CDN 实现。

## 技术栈

- **框架**: initx-plugin
- **配置加载**: unplugin (用于读取 cdn.config.ts)
- **云服务**: 腾讯云 COS SDK
- **交互界面**: 待选择的 CLI 交互库（支持多选、树形展示）
- **Git 集成**: simple-git 或原生 git 命令

## 配置文件结构

### 配置文件位置
- 文件名: `cdn.config.ts`
- 位置: 执行命令的项目根目录

### 配置结构

```typescript
interface CDNConfig {
  cos: {
    // Bucket 名称
    bucket: string
    // 所属地域
    region: string
    // COS 上传基础路径（不包含 localBasePath 的映射部分）
    basePath: string
    // 本地文件基础路径（相对于项目根目录）
    localBasePath: string
    // CDN 基础地址（只包含域名，不含路径）
    cdnUrl: string
  }
}
```

**重要**: SecretId 和 SecretKey 在运行时通过 enquirer 交互式输入，配置文件中不允许包含任何密钥信息。

### 配置示例

```typescript
export default {
  cos: {
    bucket: 'table-1301872750',
    region: 'ap-guangzhou',
    basePath: '/cos_coach',
    localBasePath: 'src',
    cdnUrl: 'https://table-cos.xironiot.com'
  }
}
```

**重要**: SecretId 和 SecretKey 在运行时通过 enquirer 交互式输入（使用 `type: 'password'` 隐藏输入），配置文件中不包含任何密钥信息。

### 路径映射逻辑

本地文件路径 → COS 路径的映射规则：

```
本地文件: /Users/imba97/Projects/uiron-education-mp/src/static/user-side/images/xxx.png
项目根目录: /Users/imba97/Projects/uiron-education-mp
localBasePath: src
相对路径: static/user-side/images/xxx.png
COS 路径: /cos_coach/static/user-side/images/xxx.png
完整 CDN URL: https://table-cos.xironiot.com/cos_coach/static/user-side/images/xxx.png
```

## 命令模式

### 模式 1: 上传单个文件

**命令格式**: `ix cdn <文件路径>`

**示例**:
```bash
ix cdn ./static/user-side/images/xxx.png
ix cdn /absolute/path/to/file.png
```

**执行流程**:
1. 解析文件路径（支持相对路径和绝对路径）
2. 验证本地文件是否存在
3. 根据配置计算 COS 目标路径
4. 调用 COS API 检查线上文件是否存在
5. 如果线上文件存在，提示用户是否覆盖
   - 提示信息应包含：文件路径、文件大小、最后修改时间等
   - 用户选择：覆盖 / 跳过 / 取消
6. 执行上传
7. 显示上传结果和 CDN URL

**错误处理**:
- 文件不存在：提示错误并退出
- 路径不在 localBasePath 范围内：提示错误并退出
- COS API 调用失败：显示错误信息

### 模式 2: 上传目录

**命令格式**: `ix cdn <目录路径>`

**示例**:
```bash
ix cdn ./static/user-side
ix cdn /absolute/path/to/directory
```

**执行流程**:
1. 解析目录路径（支持相对路径和绝对路径）
2. 验证本地目录是否存在
3. 递归扫描目录，获取所有文件列表
4. 批量调用 COS API，检查哪些文件在线上已存在
5. 显示交互式文件选择界面（详见下方"交互界面设计"）
6. 用户确认后，批量上传选中的文件
7. 显示上传进度和结果

**文件过滤**:
- 默认忽略: `.DS_Store`, `Thumbs.db`, `.git` 等系统文件
- 可配置忽略规则（后续扩展）

### 模式 3: 上传 Git 变更文件

**命令格式**: `ix cdn`（无参数）

**示例**:
```bash
ix cdn
```

**执行流程**:
1. 执行 `git status` 获取变更文件列表
2. 筛选出以下状态的文件：
   - Untracked files（未跟踪）
   - Modified files（已修改）
   - Staged files（已暂存）
3. 过滤出在 `localBasePath` 范围内的文件
4. 检查线上文件是否存在
5. 显示交互式文件选择界面
6. 用户确认后上传
7. 显示上传结果

**特殊情况**:
- 如果不在 git 仓库中：提示错误
- 如果没有变更文件：提示"没有需要上传的文件"
- 如果变更文件不在 localBasePath 范围内：自动过滤掉

## 交互界面设计

### 文件选择界面

**界面布局**:
```
选择要上传的文件 (共 5 个文件)

✓ src/static/
  ✓ user-side/
  │ ✓ images/
  │   ✓ avatar.png          (新文件)
  │   ☐ banner.jpg          (已存在，将覆盖)
  ✓ common/
    ✓ icons/
      ✓ logo.svg            (新文件)
```

**注**: 文件路径展示基于 `localBasePath` 配置，例如 `localBasePath: 'src'` 时，显示为 `src/static/...`

**交互规则**:
- **默认选中状态**:
  - 线上不存在的文件：默认 ✓ (checked)
  - 线上已存在的文件：默认 ☐ (unchecked)
- **键盘操作**:
  - `↑` / `↓`: 上下移动光标
  - `Space`: 切换当前文件的选中状态
  - `a`: 全选所有文件
  - `ESC`: 取消操作，退出
  - `Enter`: 确认并开始上传
- **目录树展示**:
  - 使用等宽字符构建树形结构
  - 树形符号: `├─`, `└─`, `│`, `  `
  - 文件状态标识: `✓` (选中), `☐` (未选中)
  - 文件状态说明: `(新文件)`, `(已存在，将覆盖)`

### 上传进度界面

**界面布局**:
```
正在上传文件...

[████████████████████░░░░░░░░] 3/5 (60%)

✓ static/user-side/images/avatar.png
✓ static/common/icons/logo.svg
⏳ static/user-side/images/banner.jpg (上传中...)
  static/common/icons/close.svg
  static/common/icons/menu.svg
```

**上传完成界面**:
```
上传完成！

成功: 4 个文件
失败: 1 个文件

✓ static/user-side/images/avatar.png
  → https://table-cos.xironiot.com/cos_coach/static/user-side/images/avatar.png

✓ static/common/icons/logo.svg
  → https://table-cos.xironiot.com/cos_coach/static/common/icons/logo.svg

✗ static/user-side/images/banner.jpg
  → 错误: 网络超时
```

## 技术实现要点

### 1. 配置加载

使用 unplugin 或类似工具加载 TypeScript 配置文件：
- 支持 TypeScript 语法
- 支持环境变量引用
- 提供配置验证

### 2. COS SDK 集成

- 使用官方 `cos-nodejs-sdk-v5`
- 实现文件上传、检查文件是否存在
- 密钥处理：运行时通过 enquirer 交互式输入
  - SecretId: 使用 `type: 'input'`
  - SecretKey: 使用 `type: 'password'` 隐藏输入
  - 参考 build-font 项目的 `collectCOSConfig` 实现

### 3. 交互界面库选择

使用 `enquirer` 的 MultiSelect 功能实现多选：
- 使用 `enquirer.MultiSelect` 提供文件多选功能
- 包体积更小，性能更好
- 树形结构通过格式化文件名实现：
  - 计算每个文件的层级深度
  - 根据层级和位置添加树形前缀（`├─`, `└─`, `│`, `  `）
  - 示例：`├─ static/user-side/images/avatar.png (新文件)`
- 文件状态说明直接拼接在文件名后面

### 4. Git 集成

- 使用 `simple-git` 库或直接调用 `git status --porcelain`
- 解析 git 状态输出，提取文件列表

### 5. 路径处理

- 使用 `path` 模块处理路径解析和拼接
- 支持相对路径转绝对路径
- 验证路径是否在 localBasePath 范围内

## 依赖包清单

```json
{
  "dependencies": {
    "cos-nodejs-sdk-v5": "^2.x.x",
    "simple-git": "^3.x.x",
    "enquirer": "^2.x.x",
    "ora": "^8.x.x"
  },
  "devDependencies": {
    "unplugin": "^1.x.x"
  }
}
```

**注**: 使用 Node.js 内置的 `node:util` 的 `styleText` 进行文本着色，无需额外依赖。

## 错误处理

### 配置错误
- 配置文件不存在：提示创建配置文件
- 配置格式错误：显示具体错误位置
- 缺少必需字段：列出缺少的字段

### 认证错误
- 用户未输入密钥：通过 enquirer 的 validate 函数验证输入不为空
- 认证失败：显示错误信息和解决方案

### 文件操作错误
- 文件不存在：显示文件路径
- 权限不足：提示权限问题
- 网络错误：提示重试或检查网络

### Git 错误
- 不在 git 仓库中：提示错误
- git 命令执行失败：显示错误信息

## 后续扩展

1. **多 CDN 支持**: 支持阿里云 OSS、七牛云等
2. **文件压缩**: 上传前自动压缩图片
3. **缓存控制**: 设置 CDN 缓存策略
4. **版本管理**: 支持 `{version}` 占位符
5. **批量操作**: 支持通配符匹配
6. **配置模板**: 提供配置文件生成命令
7. **上传历史**: 记录上传历史，支持回滚
8. **文件对比**: 对比本地和线上文件差异

## 开发计划

### Phase 1: 基础功能
- [ ] 项目重命名和基础代码清理
- [ ] 配置文件加载和验证
- [ ] COS SDK 集成
- [ ] 单文件上传功能（模式 1）

### Phase 2: 交互界面
- [ ] 交互界面库选择和集成
- [ ] 目录上传功能（模式 2）
- [ ] 文件选择界面实现

### Phase 3: Git 集成
- [ ] Git 状态解析
- [ ] Git 变更文件上传（模式 3）

### Phase 4: 优化和测试
- [ ] 错误处理完善
- [ ] 上传进度显示
- [ ] 单元测试
- [ ] 文档完善
