# 正则脚本编写指南

## 正则脚本的基本结构

SillyTavern 角色卡的 `extensions.regex_scripts` 数组中每条记录包含：

```json
{
  "id": "uuid-v4",
  "scriptName": "脚本名称（用于在UI中显示）",
  "findRegex": "/正则表达式/标志",
  "replaceString": "替换内容（支持 $1 $2 引用捕获组）",
  "trimStrings": [],
  "placement": [1, 2],
  "disabled": false,
  "markdownOnly": false,
  "promptOnly": false
}
```

### placement 取值

| 值 | 含义 |
|----|------|
| `[1]` | 仅在角色回复（display）时执行 |
| `[2]` | 仅在用户输入发送前执行 |
| `[1, 2]` | 两者都执行 |

大多数轻前端脚本使用 `[1, 2]`。

### findRegex 格式

必须是 `/pattern/flags` 格式的字符串：

```
findRegex: "/<status_panel>([\\s\\S]*?)<\\/status_panel>/g"
```

注意：字符串中的 `\` 需要双写（`\\s` `\\S` `\\/`）。

### replaceString 格式

替换内容放在 markdown 代码块中让 ST 渲染为 HTML：

```
```html
<!DOCTYPE html>
<div class="panel-wrapper">
  <style>/* CSS */</style>
  <div class="content">$1</div>
</div>
```
```

`$1` `$2` 引用正则捕获组的内容。

## 三种替换模式

### 模式1：完全替换（标记符 → HTML 面板）

将整个标记符替换为预设计的 HTML：

```
findRegex: "/<status_panel>([\\s\\S]*?)<\\/status_panel>/g"
replaceString: "完整的HTML面板代码"
```

适用：状态面板、开场页面、交互表单

### 模式2：内联样式（匹配 → 包装span）

匹配特定文本模式，包裹内联样式标签：

```
findRegex: "/(25时|ln|ws|mmj|vbs)の/g"
replaceString: "<span style=\"font-size:0.8em; opacity:0.7; font-style:italic;\">$1の</span>"
```

适用：文字装饰、命名美化、关键词高亮

### 模式3：内容提取（标记符 → 提取数据）

用标记符包裹数据，正则提取后放入 HTML 模板：

原文本：
```
<message>来自粉丝的信: 加油！</message>
```

正则：
```
findRegex: "/<message>(.*?)<\\/message>/g"
replaceString: "<div class=\"message-box\">$1</div>"
```

适用：内嵌数据展示、格式化输出

## 大型替换内容（>50KB）的注意事项

pjsk 的状态栏替换内容达 170KB。编写大型替换时注意：

1. **CSS 变量集中管理**
```css
:root {
  --panel-bg: rgba(20, 15, 30, 0.7);
  --accent-color: #b48cff;
  --text-primary: #c8d8ec;
  --border-color: rgba(200, 216, 236, 0.35);
}
```

2. **使用 CSS Grid 做响应式布局**
```css
.panel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}
```

3. **图片使用稳定的 CDN 链接**
```
/* 推荐：GitHub raw */
https://raw.githubusercontent.com/user/repo/main/images/bg.png
/* 不推荐：临时上传链接（会过期） */
```

4. **CSS 动画只使用 GPU 加速属性**
```css
/* 推荐 */
.fade-in { animation: fadeIn 0.3s ease-out; }
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 避免 */
.bad-anim { animation: growWidth 1s; }
@keyframes growWidth {
  from { width: 0; }  /* 触发 layout，性能差 */
  to { width: 100%; }
}
```

5. **避免使用外部JS库和Web字体**

## 常见陷阱

### 1. 正则贪婪匹配

错误：
```
findRegex: "/<status_panel>.*<\\/status_panel>/g"
```
会匹配从第一个 `<status_panel>` 到最后一个 `</status_panel>`。

正确：
```
findRegex: "/<status_panel>([\\s\\S]*?)<\\/status_panel>/g"
```
使用非贪婪 `*?` 和 `[\\s\\S]`（跨行匹配）。

### 2. 转义不足

错误：
```
findRegex: "/<tag>(.*?)<\/tag>/g"
```

正确：
```
findRegex: "/<tag>(.*?)<\\/tag>/g"
```

### 3. 特殊字符未转义

标记符中包含正则元字符时需要转义：

```
【开场白】 → 不需要转义（中文标点不是元字符）
<style> → 需要转义：<style>
$1 → 需要用 \\$1 表示字面 $1
```

### 4. 替换内容中的换行

`replaceString` 字段是 JSON 字符串，换行需要使用 `\n` 或直接在 JSON 中保留换行。

### 5. HTML 中的闭合标签

确保所有 HTML 标签正确闭合，否则会破坏 ST 的 DOM 结构。

## 调试技巧

1. **分步测试**：先测试 findRegex 能否匹配到目标文本（使用 regex101.com）
2. **最小替换**：先用简单替换验证流程，再逐步丰富 HTML
3. **检查 DOM**：在 ST 中按 F12 打开开发者工具，检查替换后的 HTML 是否正确插入
4. **OCR 验证**：截图后用 OCR 工具检查渲染内容是否与预期一致
